#!/usr/bin/env python3
"""Offline fixture evaluation with pandas/numpy.

Deterministic coverage summary of the 32 email fixtures and recorded BEC-01..07
outcomes: counts by category/parse status, per-rule MATCH/NO_MATCH/UNKNOWN
distribution, and an honest note that this is fixture agreement — NOT a
real-world detection-accuracy claim. Emits JSON + CSV artifacts for
docs/EMAIL_EVALUATION.md.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = ROOT / "fixtures" / "emails" / "expected.json"
OUT_DIR = ROOT / "artifacts"
RULES = ["BEC-01", "BEC-02", "BEC-03", "BEC-04", "BEC-05", "BEC-06", "BEC-07"]


def main() -> int:
    manifest = json.loads(EXPECTED.read_text())
    rows = []
    for fixture in manifest["fixtures"]:
        exp = fixture["expected"]
        row = {
            "fixture": fixture["id"],
            "category": fixture["category"],
            "parse_status": exp["parseStatus"],
            "score": exp["score"],
            "priority": exp["priority"] or "NONE",
        }
        matched = set(exp["matchedRules"])
        unknown = set(exp["unknownRules"])
        for rule in RULES:
            row[rule] = "MATCH" if rule in matched else ("UNKNOWN" if rule in unknown else "NO_MATCH")
        rows.append(row)
    df = pd.DataFrame(rows)

    OUT_DIR.mkdir(exist_ok=True)
    by_category = df.groupby("category").size().rename("fixtures").to_frame()
    by_parse = df.groupby("parse_status").size().rename("fixtures").to_frame()
    rule_matrix = df[RULES].apply(lambda s: s.value_counts()).fillna(0).astype(int)
    score_stats = df.groupby("category")["score"].agg(["mean", "max", "count"]).round(1)

    # Coverage of suspicious fixtures with at least one MATCH (fixture agreement only)
    suspicious = df[df.category == "suspicious"]
    suspicious_flagged = int((suspicious[RULES] == "MATCH").any(axis=1).sum())
    normal = df[df.category == "normal"]

    summary = {
        "run_metadata": {
            "command": "python3 scripts/summarize-fixtures.py",
            "ruleset_version": manifest.get("rulesetVersion", "bec-rules-v1"),
            "provenance_for_expectations": "RAW_UPLOAD",
            "fixtures_total": int(len(df)),
            "note": "Fixture-set agreement only; not a real-world detection-accuracy measurement.",
        },
        "counts_by_category": by_category["fixtures"].to_dict(),
        "counts_by_parse_status": by_parse["fixtures"].to_dict(),
        "rule_outcome_distribution": {rule: rule_matrix[rule].to_dict() for rule in RULES},
        "score_stats_by_category": {k: v for k, v in score_stats.to_dict(orient="index").items()},
        "fixture_flags": {
            "suspicious_with_match": suspicious_flagged,
            "suspicious_total": int(len(suspicious)),
            "normal_with_zero_match_and_zero_score": int(((normal["score"] == 0) & (normal[RULES] == "MATCH").any(axis=1) == False).sum()),
        },
        "unknown_count_total": int((df[RULES] == "UNKNOWN").sum().sum()),
    }
    (OUT_DIR / "fixture-evaluation.json").write_text(json.dumps(summary, indent=2))
    df.to_csv(OUT_DIR / "fixture-outcomes.csv", index=False)
    rule_matrix.to_csv(OUT_DIR / "rule-distribution.csv")

    print(f"fixtures analyzed: {len(df)}")
    print(by_category.to_string())
    print(rule_matrix.to_string())
    print(json.dumps(summary["fixture_flags"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
