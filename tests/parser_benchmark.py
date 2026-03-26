"""
Benchmark: Docling+LLM vs Gemini Native vs pdfplumber+LLM parser.

Compares accuracy (against expected JSON baselines) and latency for each
test PDF in tests/test_data/.

Usage:
    python -m tests.parser_benchmark               # run all three
    python -m tests.parser_benchmark --gemini       # only Gemini native
    python -m tests.parser_benchmark --docling      # only Docling+LLM
    python -m tests.parser_benchmark --pdfplumber   # only pdfplumber+LLM
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure repo root is importable
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

from api.parsers.schema import StatementExtraction
from api.parsers.docling_statement import extract_statement_fields
from api.parsers.gemini_native_parser import parse_statement_pdf_native
from api.parsers.pdfplumber_parser import parse_statement_pdfplumber

# ---------------------------------------------------------------------------
# Optional test-case registry: maps PDF filename -> expected-JSON filename
# ---------------------------------------------------------------------------
TEST_CASES: list[dict] = [
    {
        "pdf": "WS TFSA.pdf",
        "expected": "gemini_20260317T130535Z_wealthsimple_investments_inc_.json",
        "label": "Wealthsimple TFSA (Investment)",
    },
    {
        "pdf": "Webull USD TFSA.pdf",
        "expected": "gemini_20260317T130637Z_webull_securities__canada__limited.json",
        "label": "Webull USD TFSA (Investment)",
    },
    {
        "pdf": "WS Chequing Apr.pdf",
        "expected": "gemini_20260317T131226Z_wealthsimple.json",
        "label": "Wealthsimple Chequing (Deposit)",
    },
]

TEST_DATA_DIR = REPO_ROOT / "tests" / "test_data"
JSON_DUMPS_DIR = REPO_ROOT / "tests" / "json_dumps"

PARSER_DUMP_SUBFOLDER = {
    "Gemini Native": "gemini_native",
    "Docling+LLM": "docling_llm",
    "pdfplumber+LLM": "pdfplumber_llm",
}

# Expected baseline lookup by PDF filename for optional accuracy scoring.
EXPECTED_BY_PDF = {tc["pdf"]: tc["expected"] for tc in TEST_CASES}
LABEL_BY_PDF = {tc["pdf"]: tc["label"] for tc in TEST_CASES}


def dump_result(parser_name: str, pdf_name: str, result: dict) -> Path:
    """Save a parser's JSON output into its subfolder under json_dumps/."""
    subfolder = PARSER_DUMP_SUBFOLDER.get(parser_name, "other")
    out_dir = JSON_DUMPS_DIR / subfolder
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(pdf_name).stem.lower())
    out_path = out_dir / f"{ts}_{stem}.json"
    out_path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Accuracy helpers
# ---------------------------------------------------------------------------

METADATA_FIELDS = [
    "provider",
    "account_type",
    "currency",
    "opening_balance",
    "closing_balance",
    "start_date",
    "end_date",
]


def _normalise(val):
    """Lower-case strings, round floats, pass through None."""
    if val is None:
        return None
    if isinstance(val, str):
        return val.strip().lower()
    if isinstance(val, float):
        return round(val, 2)
    return val


def score_metadata(actual: dict, expected: dict) -> dict:
    """Score each metadata field; returns {field: matched (bool)}."""
    results = {}
    for field in METADATA_FIELDS:
        a = _normalise(actual.get(field))
        e = _normalise(expected.get(field))
        if field == "provider":
            # Fuzzy: expected provider contained in actual or vice-versa
            results[field] = (
                a is not None
                and e is not None
                and (a in e or e in a)
            )
        elif field in ("opening_balance", "closing_balance"):
            if a is None and e is None:
                results[field] = True
            elif a is None or e is None:
                results[field] = False
            else:
                results[field] = abs(a - e) < 0.02
        else:
            results[field] = a == e
    return results


def score_transactions(actual_txns: list[dict], expected_txns: list[dict]) -> dict:
    """
    Compare transactions.  Returns dict with:
      count_match, count_actual, count_expected,
      matched_pairs, amount_mae, total_diff
    """
    count_actual = len(actual_txns)
    count_expected = len(expected_txns)

    # Build (date, amount) multiset for matching
    expected_pairs = [(t["date"], round(t["amount"], 2)) for t in expected_txns]
    actual_pairs = [(t["date"], round(t["amount"], 2)) for t in actual_txns]

    remaining = list(expected_pairs)
    matched = 0
    for pair in actual_pairs:
        if pair in remaining:
            remaining.remove(pair)
            matched += 1

    actual_total = sum(t["amount"] for t in actual_txns)
    expected_total = sum(t["amount"] for t in expected_txns)

    return {
        "count_match": count_actual == count_expected,
        "count_actual": count_actual,
        "count_expected": count_expected,
        "matched_pairs": matched,
        "pair_precision": matched / count_actual if count_actual else 0,
        "pair_recall": matched / count_expected if count_expected else 0,
        "total_actual": round(actual_total, 2),
        "total_expected": round(expected_total, 2),
        "total_diff": round(actual_total - expected_total, 2),
    }


def score_holdings(actual_h: list[dict], expected_h: list[dict]) -> dict:
    """Compare holdings by asset_symbol."""
    count_actual = len(actual_h)
    count_expected = len(expected_h)

    exp_map = {h["asset_symbol"]: h for h in expected_h}
    matched = 0
    value_errors = []
    for h in actual_h:
        sym = h.get("asset_symbol")
        if sym in exp_map:
            matched += 1
            exp_val = exp_map[sym]["total_value"]
            act_val = h.get("total_value", 0)
            value_errors.append(abs(act_val - exp_val))

    return {
        "count_match": count_actual == count_expected,
        "count_actual": count_actual,
        "count_expected": count_expected,
        "symbols_matched": matched,
        "avg_value_error": round(sum(value_errors) / len(value_errors), 2) if value_errors else 0,
    }


def compute_accuracy(actual: dict, expected: dict) -> dict:
    """Full accuracy report for one parser run vs expected."""
    meta = score_metadata(actual, expected)
    txns = score_transactions(
        actual.get("transactions", []),
        expected.get("transactions", []),
    )
    hold = score_holdings(
        actual.get("holdings", []),
        expected.get("holdings", []),
    )

    meta_score = sum(meta.values()) / len(meta) if meta else 0
    txn_f1 = (
        2 * txns["pair_precision"] * txns["pair_recall"]
        / (txns["pair_precision"] + txns["pair_recall"])
        if (txns["pair_precision"] + txns["pair_recall"]) > 0
        else 0
    )

    return {
        "metadata": meta,
        "metadata_score": round(meta_score * 100, 1),
        "transactions": txns,
        "transaction_f1": round(txn_f1 * 100, 1),
        "holdings": hold,
        "overall": round(
            (meta_score * 30 + txn_f1 * 50 + (hold["symbols_matched"] / max(hold["count_expected"], 1)) * 20)
            , 1
        ),
    }


# ---------------------------------------------------------------------------
# Runner helpers
# ---------------------------------------------------------------------------

def run_docling(pdf_path: Path) -> tuple[dict, float]:
    """Run Docling+LLM parser, return (result_dict, elapsed_seconds)."""
    start = time.perf_counter()
    result_dict, _md = extract_statement_fields(pdf_path, use_llm=True)
    elapsed = time.perf_counter() - start
    return result_dict, elapsed


def run_gemini_native(pdf_path: Path) -> tuple[dict, float]:
    """Run Gemini native PDF parser, return (result_dict, elapsed_seconds)."""
    start = time.perf_counter()
    extraction: StatementExtraction = parse_statement_pdf_native(pdf_path)
    elapsed = time.perf_counter() - start
    return extraction.model_dump(), elapsed


def run_pdfplumber(pdf_path: Path) -> tuple[dict, float]:
    """Run pdfplumber+LLM parser, return (result_dict, elapsed_seconds)."""
    start = time.perf_counter()
    extraction: StatementExtraction = parse_statement_pdfplumber(pdf_path)
    elapsed = time.perf_counter() - start
    return extraction.model_dump(), elapsed


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def print_section(title: str):
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print(f"{'=' * 70}")


def print_accuracy(label: str, acc: dict):
    meta = acc["metadata"]
    txns = acc["transactions"]
    hold = acc["holdings"]

    print(f"\n  [{label}]")
    print(f"    Metadata ({acc['metadata_score']}% match):")
    for field, ok in meta.items():
        print(f"      {'✓' if ok else '✗'} {field}")

    print(f"    Transactions (F1={acc['transaction_f1']}%):")
    print(f"      Count: {txns['count_actual']} actual / {txns['count_expected']} expected")
    print(f"      Matched (date,amount) pairs: {txns['matched_pairs']}")
    print(f"      Precision: {txns['pair_precision']:.1%}  Recall: {txns['pair_recall']:.1%}")
    print(f"      Net cashflow: ${txns['total_actual']:,.2f} actual / ${txns['total_expected']:,.2f} expected  (diff: ${txns['total_diff']:+,.2f})")

    if hold["count_expected"] > 0:
        print(f"    Holdings:")
        print(f"      Count: {hold['count_actual']} actual / {hold['count_expected']} expected")
        print(f"      Symbols matched: {hold['symbols_matched']}")
        print(f"      Avg value error: ${hold['avg_value_error']:,.2f}")

    print(f"    ── Overall Score: {acc['overall']:.1f} / 100")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Benchmark statement parsers")
    parser.add_argument("--docling", action="store_true", help="Only run Docling+LLM parser")
    parser.add_argument("--gemini", action="store_true", help="Only run Gemini native parser")
    parser.add_argument("--pdfplumber", action="store_true", help="Only run pdfplumber+LLM parser")
    args = parser.parse_args()

    any_selected = args.docling or args.gemini or args.pdfplumber
    parsers_to_run = []
    if not any_selected or args.docling:
        parsers_to_run.append(("Docling+LLM", run_docling))
    if not any_selected or args.gemini:
        parsers_to_run.append(("Gemini Native", run_gemini_native))
    if not any_selected or args.pdfplumber:
        parsers_to_run.append(("pdfplumber+LLM", run_pdfplumber))

    summary_rows: list[dict] = []

    pdf_paths = sorted(TEST_DATA_DIR.glob("*.pdf"))
    if not pdf_paths:
        print(f"\n⚠ No PDFs found in {TEST_DATA_DIR}")
        print()
        return

    for pdf_path in pdf_paths:
        pdf_name = pdf_path.name
        label = LABEL_BY_PDF.get(pdf_name, f"{pdf_path.stem} (Auto-discovered)")
        expected_name = EXPECTED_BY_PDF.get(pdf_name)
        expected = None

        if expected_name:
            expected_path = JSON_DUMPS_DIR / expected_name
            if expected_path.exists():
                expected = json.loads(expected_path.read_text())
            else:
                print(f"\n⚠ Expected JSON not found for {pdf_name}: {expected_path}")

        print_section(label)
        print(f"  PDF:      {pdf_name}")
        print(f"  Expected: {expected_name if expected_name else '(none)'}")

        for parser_name, runner in parsers_to_run:
            print(f"\n  ▶ Running {parser_name} …")
            try:
                result, elapsed = runner(pdf_path)
                dump_path = dump_result(parser_name, pdf_name, result)
                print(f"    Latency: {elapsed:.2f}s")
                print(f"    Saved:   {dump_path.relative_to(REPO_ROOT)}")
                if expected is not None:
                    acc = compute_accuracy(result, expected)
                    print_accuracy(parser_name, acc)
                    summary_rows.append({
                        "test": label,
                        "parser": parser_name,
                        "latency": elapsed,
                        "meta_%": acc["metadata_score"],
                        "txn_f1_%": acc["transaction_f1"],
                        "overall": acc["overall"],
                    })
                else:
                    print("    Accuracy: skipped (no expected baseline configured)")
            except Exception as e:
                print(f"    ✗ FAILED: {e}")
                summary_rows.append({
                    "test": label,
                    "parser": parser_name,
                    "latency": None,
                    "meta_%": None,
                    "txn_f1_%": None,
                    "overall": None,
                })

    # ------------------------------------------------------------------
    # Summary table
    # ------------------------------------------------------------------
    if summary_rows:
        print_section("SUMMARY")
        header = f"  {'Test':<38} {'Parser':<16} {'Latency':>8} {'Meta%':>6} {'TxnF1%':>7} {'Score':>6}"
        print(header)
        print(f"  {'─' * 85}")
        for r in summary_rows:
            lat = f"{r['latency']:.1f}s" if r["latency"] is not None else "FAIL"
            meta = f"{r['meta_%']:.0f}%" if r["meta_%"] is not None else "  –"
            txn = f"{r['txn_f1_%']:.0f}%" if r["txn_f1_%"] is not None else "  –"
            score = f"{r['overall']:.0f}" if r["overall"] is not None else "  –"
            print(f"  {r['test']:<38} {r['parser']:<16} {lat:>8} {meta:>6} {txn:>7} {score:>6}")

        # Averages per parser
        print(f"\n  {'─' * 85}")
        for pname in dict.fromkeys(r["parser"] for r in summary_rows):
            rows = [r for r in summary_rows if r["parser"] == pname and r["overall"] is not None]
            if rows:
                avg_lat = sum(r["latency"] for r in rows) / len(rows)
                avg_meta = sum(r["meta_%"] for r in rows) / len(rows)
                avg_txn = sum(r["txn_f1_%"] for r in rows) / len(rows)
                avg_score = sum(r["overall"] for r in rows) / len(rows)
                print(f"  {'AVG':<38} {pname:<16} {avg_lat:>7.1f}s {avg_meta:>5.0f}% {avg_txn:>6.0f}% {avg_score:>6.0f}")

    print()


if __name__ == "__main__":
    main()
