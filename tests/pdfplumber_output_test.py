"""
Dump pdfplumber's structured text (markdown-style tables + page text) to a file and to the terminal.
Run from repo root: python tests/pdfplumber_output_test.py [path/to/statement.pdf]
If no path is given, uses tests/test_data/statement.pdf if it exists.
"""
import sys
from pathlib import Path

# Allow running from repo root or from tests/
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from api.parsers.pdfplumber_parser import pdf_to_structured_text


def main() -> None:
    if len(sys.argv) >= 2:
        pdf_path = Path(sys.argv[1])
    else:
        pdf_path = repo_root / "tests" / "test_data" / "statement.pdf"

    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        print("Usage: python tests/pdfplumber_output_test.py [path/to/statement.pdf]", file=sys.stderr)
        sys.exit(1)

    text = pdf_to_structured_text(pdf_path)
    if not text.strip():
        print("pdfplumber extracted no text.", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(__file__).resolve().parent / "pdfplumber_mds"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "pdfplumber_output.md"
    out_file.write_text(text, encoding="utf-8")
    print(f"Wrote {out_file}")

    print("\n--- Markdown output (terminal) ---\n")
    print(text)


if __name__ == "__main__":
    main()
