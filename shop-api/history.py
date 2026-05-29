"""In-memory price history per product, seeded with synthetic data at import.

A history entry is { "date": "YYYY-MM-DD", "price": 999.0 }. Lists are
ordered chronologically (oldest first). Writes dedupe by date — calling
record_price(product_id, p) twice on the same date overwrites.

Persistence: none. Resets on container restart. The seed function gives
us ~14 days of plausible-looking data on first import so demos always
have a chart to show.
"""

from datetime import date, datetime, timezone
from threading import Lock
from typing import Optional

from data.seed_history import seed_history_for

_HISTORY: dict[str, list[dict]] = {}
_LOCK = Lock()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _ensure_seeded(product_id: str, price_per_unit: float) -> None:
    """Lazy-seed a product's history on first access."""
    if product_id not in _HISTORY:
        _HISTORY[product_id] = seed_history_for(product_id, price_per_unit)


def get_history(product_id: str, price_per_unit: float, days: int = 14) -> list[dict]:
    """Return up to `days` most-recent entries (oldest → newest)."""
    with _LOCK:
        _ensure_seeded(product_id, price_per_unit)
        entries = _HISTORY[product_id]
        # entries are already sorted oldest first; slice the tail
        return entries[-days:]


def record_price(product_id: str, price: float, price_per_unit: float) -> None:
    """Record a price observation for today. Dedupes by date."""
    with _LOCK:
        _ensure_seeded(product_id, price_per_unit)
        today = _today()
        entries = _HISTORY[product_id]
        if entries and entries[-1]["date"] == today:
            entries[-1] = {"date": today, "price": float(price)}
        else:
            entries.append({"date": today, "price": float(price)})


def reset(product_id: Optional[str] = None) -> None:
    """Test/dev helper. Clear all or one product's history."""
    with _LOCK:
        if product_id is None:
            _HISTORY.clear()
        else:
            _HISTORY.pop(product_id, None)
