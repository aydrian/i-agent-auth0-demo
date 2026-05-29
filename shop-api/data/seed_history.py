"""Deterministic synthetic price history for seeding `history.py`.

Strategy: most days hover within a small band around MSRP with random
noise. One day in the window has a deliberate "dip" — a notable deal
price 75-82% of MSRP — with a smooth recovery on adjacent days. This
gives the watchlist agent a meaningful "recent low" reference when
reasoning about current prices: it can say "was $X just N days ago" with
real numbers behind it instead of a flat random walk.

The dip's position and depth are derived from a hash of the product id
so each product has its own consistent shape across restarts, and
products are visibly distinct from each other.
"""

import hashlib
import random
from datetime import date, timedelta


def seed_history_for(
    product_id: str, price_per_unit: float, days: int = 14
) -> list[dict]:
    """Generate `days` of synthetic daily prices ending today (oldest first).

    Curve shape:
      * Days outside the dip shoulder: MSRP +/- 4% noise.
      * Dip day (somewhere 5-9 days ago, depending on product): 75-82% of MSRP.
      * Shoulder days (adjacent to the dip): smoothly between dip and MSRP.

    The price is hard-bounded to [70% MSRP, 110% MSRP] so noise can't push
    history above MSRP much -- prices in the wild fluctuate up too, but for
    a deal-watching demo it's clearer if the only sub-MSRP prices are the
    dip itself.
    """
    seed = int(hashlib.md5(product_id.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)

    today = date.today()

    dip_offset = 5 + (seed % 5)  # 5-9 days ago, deterministic per product
    dip_factor = 0.75 + rng.uniform(0.0, 0.07)  # 75-82% of MSRP
    dip_price = price_per_unit * dip_factor

    entries: list[dict] = []
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        distance = abs(offset - dip_offset)

        if distance == 0:
            price = dip_price
        elif distance <= 2:
            # Smooth shoulder: 50% recovered at distance 1, fully MSRP at 2.
            weight = distance / 2
            price = dip_price + (price_per_unit - dip_price) * weight
            price += rng.uniform(-0.02, 0.02) * price_per_unit
        else:
            # Hover near MSRP with light noise.
            noise = rng.uniform(-0.04, 0.04) * price_per_unit
            price = price_per_unit + noise

        # Hard bounds: never above MSRP * 1.10, never below MSRP * 0.70.
        price = max(price_per_unit * 0.70, min(price_per_unit * 1.10, price))
        entries.append({"date": d.isoformat(), "price": round(price, 2)})

    return entries
