"""Pydantic schemas matching the event-driven ledger DB structure."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class Account(BaseModel):
    """Account metadata only (no balance fields)."""

    id: UUID
    user_id: UUID
    name: str
    account_number: str | None = None
    account_type: str       # Plaid top-level: depository, investment, credit, loan
    account_subtype: str    # Canadian product name: TFSA, RRSP, Chequing, etc.
    provider: str | None = None
    created_at: datetime | None = None


class Statement(BaseModel):
    """Statement metadata only (no opening/closing balance or currency)."""

    id: UUID
    user_id: UUID
    account_id: UUID | None = None
    filename: str
    storage_path: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    provider: str | None = None
    created_at: datetime | None = None


class Balance(BaseModel):
    """Point-in-time account value (event-driven ledger)."""

    id: UUID
    user_id: UUID
    account_id: UUID
    statement_id: UUID | None = None
    amount: float
    currency: str
    date: date
    created_at: datetime | None = None


class Holding(BaseModel):
    """Itemized asset (including cash) at a point in time."""

    id: UUID
    user_id: UUID
    account_id: UUID
    statement_id: UUID | None = None
    asset_symbol: str | None = Field(default="CASH", description="Symbol; null/empty becomes CASH")
    asset_name: str | None = None
    quantity: float
    unit_price: float
    total_value: float
    currency: str
    date: date
    is_cash_equivalent: bool = False
    created_at: datetime | None = None

    @field_validator("asset_symbol", mode="before")
    @classmethod
    def default_asset_symbol_to_cash(cls, v: str | None) -> str:
        if v is None or (isinstance(v, str) and v.strip() == ""):
            return "CASH"
        return v
