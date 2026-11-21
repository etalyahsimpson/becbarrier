"""Bounded, defensive MIME parsing for untrusted .eml content.

Hard limits (max part count, nesting depth, header count and sizes) keep the
parser deterministic on adversarial input. Attachments are NEVER extracted or
executed; HTML parts are never rendered — a conservative tag-strip yields a
text excerpt only, and remote image references are counted, never fetched.
"""

from __future__ import annotations

import base64
import hashlib
import html as html_module
import re
from dataclasses import dataclass, field
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser

from .normalization import split_address
from .schemas import AuthStatus, NormalizedEmail, ParseStatus

MAX_PARTS = 50
MAX_NESTING_DEPTH = 10
MAX_HEADERS = 200
MAX_HEADER_VALUE = 8_000
MAX_BODY_EXCERPT = 2_000
MAX_ATTACHMENTS = 25

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_BLOCK_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_IMG_SRC_RE = re.compile(r"<img\b[^>]*\bsrc=[\"']?([^\"' >]+)", re.IGNORECASE)
_DIGIT_RUN_RE = re.compile(r"\d{4,}")
_ATTACHMENT_FILENAME = "attachment"


@dataclass
class ParseResult:
    status: ParseStatus
    digest: str
    normalized: NormalizedEmail | None = None
    error: str | None = None
    parsed_headers: dict[str, object] = field(default_factory=dict)


def redact_digits(text: str) -> str:
    """Mask long digit runs so bank/account numbers never appear in evidence."""
    return _DIGIT_RUN_RE.sub("••••", text)


def strip_html(html: str) -> str:
    text = _SCRIPT_BLOCK_RE.sub(" ", html)
    text = _IMG_SRC_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    text = html_module.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_eml(raw: bytes, provenance: str = "RAW_UPLOAD") -> ParseResult:
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) == 0:
        return ParseResult(status=ParseStatus.MALFORMED, digest=digest, error="empty payload")
    if len(raw) > UPLOAD_LIMIT():
        return ParseResult(status=ParseStatus.REJECTED_OVERSIZE, digest=digest, error="payload exceeds limit")

    try:
        message = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception as exc:  # noqa: BLE001 — parser adversarial input
        return ParseResult(status=ParseStatus.MALFORMED, digest=digest, error=f"parse error: {type(exc).__name__}")

    try:
        return _extract(message, digest, provenance)
    except Exception as exc:  # noqa: BLE001 — never crash on adversarial MIME
        return ParseResult(status=ParseStatus.MALFORMED, digest=digest, error=f"extraction error: {type(exc).__name__}")


def UPLOAD_LIMIT() -> int:
    import os

    return int(os.environ.get("UPLOAD_MAX_BYTES", 2 * 1024 * 1024))


def _header(message: EmailMessage, name: str) -> str | None:
    try:
        value = message.get(name)
    except Exception:  # noqa: BLE001
        return None
    if value is None:
        return None
    text = str(value)
    if len(text) > MAX_HEADER_VALUE:
        text = text[:MAX_HEADER_VALUE]
    return text


def _extract(message: EmailMessage, digest: str, provenance: str) -> ParseResult:
    headers: dict[str, object] = {}
    header_count = 0
    for name, value in message.items():
        header_count += 1
        if header_count > MAX_HEADERS:
            break
        text = str(value)[:MAX_HEADER_VALUE]
        if name in headers:
            existing = headers[name]
            if isinstance(existing, list):
                existing.append(text)
            else:
                headers[name] = [existing, text]
        else:
            headers[name] = text

    from_raw = _header(message, "From")
    reply_to_raw = _header(message, "Reply-To")
    sender_raw = _header(message, "Sender")
    to_raw = _header(message, "To")
    subject = _header(message, "Subject")
    message_id = _header(message, "Message-ID")
    date_raw = _header(message, "Date")
    auth_results_raw = _header(message, "Authentication-Results")
    dkim_present = _header(message, "DKIM-Signature") is not None

    received_count = 0
    for name, _ in message.items():
        if name.lower() == "received":
            received_count += 1
        if received_count > 50:
            received_count = 50
            break

    # Walk parts with bounded depth/count.
    part_count = 0
    body_text: list[str] = []
    html_present = False
    remote_images = 0
    attachments: list[str] = []

    def walk(part: EmailMessage, depth: int) -> None:
        nonlocal part_count, html_present, remote_images
        if depth > MAX_NESTING_DEPTH or part_count >= MAX_PARTS:
            return
        part_count += 1
        try:
            if part.is_multipart():
                for sub in part.iter_parts():
                    walk(sub, depth + 1)  # type: ignore[arg-type]
                return
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", "")).lower()
            filename = part.get_filename()
            if filename or "attachment" in disposition:
                if filename and len(attachments) < MAX_ATTACHMENTS:
                    attachments.append(str(filename)[:120])
                else:
                    attachments.append(_ATTACHMENT_FILENAME)
                return
            if content_type == "text/plain":
                try:
                    text = part.get_content()
                except Exception:  # noqa: BLE001
                    text = ""
                if isinstance(text, str):
                    body_text.append(text[:MAX_BODY_EXCERPT])
            elif content_type == "text/html":
                html_present = True
                try:
                    html = part.get_content()
                except Exception:  # noqa: BLE001
                    html = ""
                if isinstance(html, str):
                    remote_images += len(_IMG_SRC_RE.findall(html))
                    stripped = strip_html(html[:MAX_BODY_EXCERPT * 2])
                    if stripped:
                        body_text.append(stripped[:MAX_BODY_EXCERPT])
        except Exception:  # noqa: BLE001
            return

    walk(message, 0)  # type: ignore[arg-type]

    body_excerpt: str | None = None
    if body_text:
        joined = "\n".join(body_text)[:MAX_BODY_EXCERPT]
        body_excerpt = redact_digits(joined)

    auth_status = AuthStatus(
        spf="UNKNOWN",
        dkim="PRESENT_UNVERIFIED" if dkim_present else "NOT_PRESENT",
        dmarc="NOT_EVALUATED",
        authenticationResultsPresent=auth_results_raw is not None,
        claimedResults=auth_results_raw[:300] if auth_results_raw else None,
        claimTrust="UNTRUSTED_CLAIM" if auth_results_raw else "NONE",
    )

    to_list: list[dict[str, object]] = []
    if to_raw:
        for chunk in to_raw.split(",")[:20]:
            parsed = split_address(chunk.strip())
            if parsed and parsed.get("email"):
                to_list.append(parsed)

    normalized = NormalizedEmail(
        digest=digest,
        parsedHeaders={k: v for k, v in list(headers.items())[:40]},
        fromAddress=split_address(from_raw),
        replyTo=split_address(reply_to_raw),
        sender=split_address(sender_raw),
        to=to_list,  # type: ignore[arg-type]
        subject=subject[:300] if subject else None,
        messageId=message_id[:300] if message_id else None,
        date=date_raw[:120] if date_raw else None,
        receivedCount=received_count,
        mimePartCount=part_count,
        attachmentNames=attachments,
        bodyTextExcerpt=body_excerpt,
        htmlPresent=html_present,
        remoteImageReferences=remote_images,
        authStatus=auth_status,
    )

    return ParseResult(
        status=ParseStatus.OK,
        digest=digest,
        normalized=normalized,
        parsed_headers=headers,
    )


def decode_base64(content_base64: str) -> bytes:
    return base64.b64decode(content_base64, validate=True)
