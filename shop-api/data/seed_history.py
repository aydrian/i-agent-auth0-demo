"""Deterministic synthetic price history for seeding `history.py`.

Strategy: for each product, generate the last 14 days of prices via a
random walk around `price_per_unit`. The seed is a hash of the product
id so the same product always produces the same history — important for
demo reproducibility.
"""

import hashlib
import random
from datetime import date, timedelta


def seed_history_for(product_id: str, price_per_unit: float, days: int = 14) -> list[dict]:
    """Generate `days` of synthetic daily prices ending today (oldest first)."""
    seed = int(hashlib.md5(product_id.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)

    today = date.today()
    entries: list[dict] = []
    # Random walk: each day moves up to +/- 5% from the prior day, biased
    # toward the MSRP so we don't drift far over 14 days.
    price = price_per_unit
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        # Move toward MSRP a bit (mean-reverting), then add noise.
        drift = (price_per_unit - price) * 0.10
        noise = rng.uniform(-0.05, 0.05) * price_per_unit
        price = max(price_per_unit * 0.80, min(price_per_unit * 1.20, price + drift + noise))
        entries.append({"date": d.isoformat(), "price": round(price, 2)})

    return entries
