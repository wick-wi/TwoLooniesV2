"""
Bank statement parsers. Template-by-template support with generic fallback.
"""
from .registry import parse_statement

__all__ = ["parse_statement"]
