"""
Entry point for bank statement parsing. Delegates to template-based parsers.
"""
from .parsers.registry import parse_statement

__all__ = ["parse_statement"]
