# BECBarrier email-intelligence service (internal, non-authoritative).
# Slim Python image; the service never handles bank data and never exposes
# a public port in the compose network.
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock

COPY app ./app

# Non-root runtime user.
RUN useradd --system --uid 10001 --no-create-home emailintel
USER emailintel

EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/internal/v1/health', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
