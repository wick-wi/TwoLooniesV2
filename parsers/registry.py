"""
Bank detection and parser dispatch.
"""
import logging
from typing import Any

import pdfplumber

from parsers.generic import parse_generic
from parsers.wealthsimple import parse_wealthsimple

logger = logging.getLogger(__name__)

# (bank_id, detection_keywords, parser_func)
# Keywords are checked case-insensitively in PDF text
BANK_TEMPLATES = [
    (
        "wealthsimple",
        ("wealthsimple",),  # Wealthsimple Cash, Invest, etc.
        parse_wealthsimple,
    ),
    # Add more banks here, e.g.:
    # ("td", ("td canada trust", "td bank"), parse_td),
]


def _sample_pdf_text(pdf: pdfplumber.PDF, max_pages: int = 2) -> str:
    """Extract text from first few pages for bank detection."""
    text_parts = []
    for i, page in enumerate(pdf.pages):
        if i >= max_pages:
            break
        t = page.extract_text()
        if t:
            text_parts.append(t)
    return " ".join(text_parts).lower()


def detect_bank(pdf: pdfplumber.PDF) -> str:
    """Return bank_id if detected, else 'generic'."""
    sample = _sample_pdf_text(pdf)
    for bank_id, keywords, _ in BANK_TEMPLATES:
        if any(kw.lower() in sample for kw in keywords):
            return bank_id
    return "generic"


def parse_statement(file_path: str) -> list[dict[str, Any]]:
    """
    Parse a bank statement PDF. Detects bank and uses appropriate template.
    Returns list of { date, description, amount }.
    """
    with pdfplumber.open(file_path) as pdf:
        bank_id = detect_bank(pdf)
        logger.info("Detected bank: %s", bank_id)

        for bid, _, parser_func in BANK_TEMPLATES:
            if bid == bank_id:
                txns = parser_func(pdf)
                logger.info("Extracted %d transactions from %s template", len(txns), bank_id)
                if not txns:
                    logger.warning("%s template returned 0 transactions, falling back to generic", bank_id)
                    txns = parse_generic(pdf)
                return txns

        txns = parse_generic(pdf)
        logger.info("Extracted %d transactions from generic template", len(txns))
        return txns
