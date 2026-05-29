"""Mutable sale state stored in data/sales.json.

A sale entry: { "salePrice": float, "expiresAt": ISO-8601 UTC string }.
Reads merge expired sales out automatically.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Optional

SALES_PATH = Path(__file__).parent / "data" / "sales.json"
_LOCK = Lock()


def _load() -> dict:
    if not SALES_PATH.exists():
        return {}
    with open(SALES_PATH, "r") as f:
        return json.load(f)


def _save(state: dict) -> None:
    SALES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SALES_PATH, "w") as f:
        json.dump(state, f, indent=2)


def _is_active(entry: dict) -> bool:
    expires = entry.get("expiresAt")
    if not expires:
        return False
    try:
        when = datetime.fromisoformat(expires.replace("Z", "+00:00"))
    except ValueError:
        return False
    return when > datetime.now(timezone.utc)


def get_sale_price(product_id: str) -> Optional[float]:
    """Return the active sale price for product_id, or None."""
    with _LOCK:
        state = _load()
        entry = state.get(product_id)
        if entry and _is_active(entry):
            return float(entry["salePrice"])
        return None


def set_sale(product_id: str, sale_price: float, duration_minutes: int) -> dict:
    """Set or replace a sale entry. Returns the stored entry."""
    expires_at = datetime.now(timezone.utc) + _minutes(duration_minutes)
    entry = {"salePrice": float(sale_price), "expiresAt": expires_at.isoformat()}
    with _LOCK:
        state = _load()
        state[product_id] = entry
        _save(state)
    return entry


def clear_sale(product_id: str) -> bool:
    """Remove the sale for product_id. Returns True if one was removed."""
    with _LOCK:
        state = _load()
        if product_id in state:
            del state[product_id]
            _save(state)
            return True
        return False


def list_sales() -> dict:
    with _LOCK:
        state = _load()
        return {k: v for k, v in state.items() if _is_active(v)}


def _minutes(n: int):
    from datetime import timedelta
    return timedelta(minutes=n)
