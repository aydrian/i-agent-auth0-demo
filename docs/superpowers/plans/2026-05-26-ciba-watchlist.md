# CIBA Price-Drop Watchlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demonstrate Auth0 CIBA + Guardian as out-of-session human-in-the-loop. The agent watches user-defined products, asks for approval via push when prices drop, then auto-purchases on approval and surfaces the order confirmation in chat next session.

**Architecture:** A FastAPI shop-api (copied from assistant0-vercel-arize, extended with sale + admin endpoints) serves the catalog over docker-compose. Next.js side: a Drizzle-backed `Watchlist` table managed by three chat tools, a Vercel cron route that polls prices and initiates CIBA via direct `@auth0/ai`/Auth0 endpoints, an admin page that triggers sales and runs the cron on demand, and an extension to `agent-identity.ts` that prompts the agent to surface unacknowledged purchases on the user's next chat turn.

**Tech Stack:** Next.js 16 + Vercel AI SDK 6, Drizzle ORM + Postgres, `@auth0/nextjs-auth0` 4.x, `@auth0/ai-vercel` 5.x, `@auth0/ai` 6.x, FastAPI + uvicorn (shop-api), docker-compose for local dev, Vercel Cron for production scheduling.

**Reference spec:** `docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md`

---

## File Structure (units, with one clear responsibility each)

| Path | Responsibility |
|---|---|
| `shop-api/` (copied) | FastAPI server with catalog read endpoints |
| `shop-api/data/sales.json` | Mutable sale state (single JSON file) |
| `shop-api/routers/shop.py` | Catalog reads merge sale prices |
| `shop-api/routers/admin.py` | Admin sale set/clear + product list, gated by `X-Admin-Key` |
| `shop-api/models.py` | Pydantic models, `salePrice` field added |
| `lib/db/schema.ts` | Adds `watchlist` table |
| `lib/db/queries/watchlist.ts` | All watchlist DB ops in one focused file (new file alongside `queries.ts`) |
| `lib/ai/tools/watchlist-add.ts` | Chat tool: add product to watchlist |
| `lib/ai/tools/watchlist-list.ts` | Chat tool: list active + atomically acknowledge purchases |
| `lib/ai/tools/watchlist-remove.ts` | Chat tool: remove a watch entry |
| `lib/ai/agent-capabilities.ts` | Registry: append three watchlist capability entries |
| `lib/ai/agent-identity.ts` | Extended to count unacknowledged purchases |
| `lib/ai/prompts.ts` | Extended to render the unacknowledged-purchases hint into the system prompt |
| `lib/shop-api-client.ts` | Server-side typed client for shop-api (search, products, place order) |
| `lib/auth0-ciba.ts` | `requestCibaApproval()`: direct CIBA initiate + poll |
| `app/(chat)/api/chat/route.ts` | Register the three new tools + add to active-tools list |
| `app/api/cron/check-watchlists/route.ts` | Vercel cron handler: scan watches, push CIBA, purchase on approval |
| `app/api/admin/sale/route.ts` | Next.js proxy to shop-api admin endpoints (gated by session+ADMIN_EMAIL) |
| `app/admin/page.tsx` | Server component admin page (gated by ADMIN_EMAIL) |
| `app/admin/admin-client.tsx` | Client component for the admin page UI |
| `vercel.json` | Cron schedule declaration |
| `docker-compose.yml` | Adds `shop-api` service |
| `.env.example` | Adds new env vars |
| `README.md` | Adds CIBA demo section + Auth0 prerequisites |

---

## Auth0 prerequisites (manual, one-time)

This plan assumes the following are configured in the Auth0 dashboard before Task 5 onward. The plan does not script Auth0 setup.

1. **API created** in Auth0 with:
   - Identifier (audience): `https://api.shop-online-demo.com` (or any URL — must match `SHOP_API_AUDIENCE`)
   - Permission/scope: `product:buy`
2. **CIBA enabled** on the application:
   - Application Settings → Advanced → Grant Types → enable "Client-Initiated Backchannel Authentication (CIBA)"
   - Tenant Settings → Authentication Profile → ensure CIBA is on
3. **Guardian enrolled** for the demo user:
   - User must have completed Guardian enrollment on a phone via Auth0 dashboard or self-service
4. Existing env vars `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL` remain in use.

---

## Task 1: Commit the approved spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md` (already on disk, untracked)

- [ ] **Step 1: Verify branch and pending file**

```bash
git branch --show-current
git status
```

Expected: branch `feat/ciba-watchlist`; untracked `docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md`.

- [ ] **Step 2: Stage and commit just the spec**

```bash
git add docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md
git commit -m "docs: spec for CIBA price-drop watchlist feature"
```

Expected: one file committed, no other staged files.

---

## Task 2: Copy shop-api skeleton from assistant0

**Files:**
- Create: `shop-api/` (directory, files copied verbatim)

- [ ] **Step 1: Copy the directory**

```bash
cp -R /Users/aydrian.howard/Developer/assistant0-vercel-arize/shop-api ./shop-api
rm -rf ./shop-api/__pycache__ ./shop-api/routers/__pycache__
```

Expected: `shop-api/main.py`, `shop-api/models.py`, `shop-api/routers/shop.py`, `shop-api/data/catalog.json`, `shop-api/Dockerfile`, `shop-api/pyproject.toml`, `shop-api/uv.lock`, `shop-api/static/` exist locally.

- [ ] **Step 2: Verify catalog has the demo products**

```bash
python3 -c "import json; print([p['name'] for p in json.load(open('shop-api/data/catalog.json'))])"
```

Expected: list including "iPhone 15 Pro" and 7 others.

- [ ] **Step 3: Sanity-build shop-api in place (no docker yet)**

```bash
cd shop-api && uv sync --frozen --no-dev && cd ..
```

Expected: `shop-api/.venv/` created, no errors.

- [ ] **Step 4: Smoke-run the server and curl it**

```bash
cd shop-api && uv run uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 2
curl -s "http://localhost:8000/api/shop/search?product=iphone" | python3 -m json.tool
kill %1
cd ..
```

Expected: JSON with `product.name = "iPhone 15 Pro"`, `pricePerUnit: 1199.0`, `subtotal/tax/total`, `estimatedDelivery`.

- [ ] **Step 5: Commit the unmodified copy**

```bash
git add shop-api
git commit -m "feat(shop-api): import FastAPI skeleton from assistant0-vercel-arize"
```

---

## Task 3: Add `sales.json` + sale-merge logic to shop-api

**Files:**
- Create: `shop-api/data/sales.json`
- Create: `shop-api/sales.py` (sale-state helper, single responsibility)
- Modify: `shop-api/models.py` (add `salePrice` field)
- Modify: `shop-api/routers/shop.py` (apply sale price)

- [ ] **Step 1: Create empty sales file**

Create `shop-api/data/sales.json` with content:

```json
{}
```

- [ ] **Step 2: Create the sales helper**

Create `shop-api/sales.py`:

```python
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
```

- [ ] **Step 3: Add `salePrice` to ProductInfo and SearchResponse**

Edit `shop-api/models.py`. Replace the file with:

```python
from pydantic import BaseModel, Field


class ProductInfo(BaseModel):
    id: str
    name: str
    category: str
    pricePerUnit: float
    salePrice: float | None = None
    imageUrl: str


class OrderRequest(BaseModel):
    productId: str | None = Field(None, min_length=1)
    product: str | None = Field(None, min_length=1)
    qty: int = Field(..., gt=0)


class OrderResponse(BaseModel):
    orderId: str
    product: ProductInfo
    qty: int
    subtotal: float
    tax: float
    total: float
    estimatedDelivery: str
    status: str


class SearchResponse(BaseModel):
    product: ProductInfo
    qty: int
    subtotal: float
    tax: float
    total: float
    estimatedDelivery: str
```

- [ ] **Step 4: Apply sales in shop.py reads**

Edit `shop-api/routers/shop.py`. Replace `build_product_info` and `calculate_pricing` and `create_order`/`search_product` so they consult the sale price. The full updated file:

```python
import json
import random
import string
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from rapidfuzz import fuzz

from models import ProductInfo, OrderRequest, OrderResponse, SearchResponse
from sales import get_sale_price

router = APIRouter()

CATALOG_PATH = Path(__file__).parent.parent / "data" / "catalog.json"
with open(CATALOG_PATH, "r") as f:
    CATALOG = json.load(f)

CATALOG_INDEX = {item["id"]: item for item in CATALOG}

TAX_RATE = 0.08


def fuzzy_match_product(query: str, threshold: int = 60) -> dict | None:
    best_match = None
    best_score = threshold

    for product in CATALOG:
        name_score = fuzz.token_set_ratio(query.lower(), product["name"].lower())
        id_score = fuzz.token_set_ratio(query.lower(), product["id"].lower())
        tag_score = max(
            (fuzz.token_set_ratio(query.lower(), tag.lower()) for tag in product.get("tags", [])),
            default=0,
        )
        max_score = max(name_score, id_score, tag_score)

        if max_score > best_score:
            best_score = max_score
            best_match = product

    return best_match


def effective_price(product: dict) -> tuple[float, float | None]:
    """Return (effective_price, sale_price_or_none)."""
    sale = get_sale_price(product["id"])
    if sale is not None and sale < product["pricePerUnit"]:
        return sale, sale
    return float(product["pricePerUnit"]), None


def build_product_info(product: dict) -> ProductInfo:
    _, sale = effective_price(product)
    return ProductInfo(
        id=product["id"],
        name=product["name"],
        category=product["category"],
        pricePerUnit=float(product["pricePerUnit"]),
        salePrice=sale,
        imageUrl=f"/static/images/{product['imageUrl']}",
    )


def calculate_pricing(price: float, qty: int) -> tuple[float, float, float]:
    subtotal = price * qty
    tax = subtotal * TAX_RATE
    total = subtotal + tax
    return round(subtotal, 2), round(tax, 2), round(total, 2)


def generate_order_id() -> str:
    date_str = datetime.now().strftime("%Y%m%d")
    random_str = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"ORD-{date_str}-{random_str}"


def resolve_product(request: OrderRequest) -> dict | None:
    if request.productId:
        product = CATALOG_INDEX.get(request.productId)
        if product:
            return product
    if request.product:
        product = fuzzy_match_product(request.product)
        if product:
            return product
    return None


@router.get("/shop/search", response_model=SearchResponse)
async def search_product(
    product: str = Query(..., min_length=1),
    qty: int = Query(1, gt=0),
):
    matched = fuzzy_match_product(product)
    if not matched:
        suggestions = [p["name"] for p in CATALOG[:3]]
        raise HTTPException(
            status_code=404,
            detail={"error": "Product not found", "query": product, "suggestion": suggestions},
        )

    product_info = build_product_info(matched)
    price, _ = effective_price(matched)
    subtotal, tax, total = calculate_pricing(price, qty)
    estimated_delivery = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")

    return SearchResponse(
        product=product_info,
        qty=qty,
        subtotal=subtotal,
        tax=tax,
        total=total,
        estimatedDelivery=estimated_delivery,
    )


@router.post("/shop", response_model=OrderResponse)
async def create_order(request: OrderRequest):
    product = resolve_product(request)
    if not product:
        suggestions = [p["name"] for p in CATALOG[:3]]
        raise HTTPException(
            status_code=404,
            detail={
                "error": "Product not found",
                "query": request.product or request.productId,
                "suggestion": suggestions,
            },
        )

    product_info = build_product_info(product)
    price, _ = effective_price(product)
    subtotal, tax, total = calculate_pricing(price, request.qty)
    estimated_delivery = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")

    return OrderResponse(
        orderId=generate_order_id(),
        product=product_info,
        qty=request.qty,
        subtotal=subtotal,
        tax=tax,
        total=total,
        estimatedDelivery=estimated_delivery,
        status="confirmed",
    )
```

- [ ] **Step 5: Verify with a manual sale write + curl**

```bash
cd shop-api
echo '{"iphone-15-pro": {"salePrice": 999, "expiresAt": "2099-01-01T00:00:00+00:00"}}' > data/sales.json
uv run uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 2
curl -s "http://localhost:8000/api/shop/search?product=iphone" | python3 -m json.tool
kill %1
echo '{}' > data/sales.json
cd ..
```

Expected: response contains `"salePrice": 999.0` and `"subtotal": 999.0` (was 1199 before).

- [ ] **Step 6: Commit**

```bash
git add shop-api
git commit -m "feat(shop-api): add sale state and sale-aware catalog reads"
```

---

## Task 4: Admin endpoints on shop-api

**Files:**
- Create: `shop-api/routers/admin.py`
- Modify: `shop-api/main.py` (mount the admin router)

- [ ] **Step 1: Create the admin router**

Create `shop-api/routers/admin.py`:

```python
import os
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from models import ProductInfo
from sales import set_sale, clear_sale, list_sales
from routers.shop import CATALOG, build_product_info

router = APIRouter()


class SaleRequest(BaseModel):
    productId: str = Field(..., min_length=1)
    salePrice: float = Field(..., gt=0)
    durationMinutes: int = Field(..., gt=0, le=24 * 60)


def _check_admin_key(x_admin_key: str | None) -> None:
    expected = os.environ.get("ADMIN_API_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="Admin not configured")
    if x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid admin key")


@router.post("/admin/sale")
async def post_sale(req: SaleRequest, x_admin_key: str | None = Header(None)):
    _check_admin_key(x_admin_key)
    if req.productId not in {p["id"] for p in CATALOG}:
        raise HTTPException(status_code=404, detail="Unknown productId")
    entry = set_sale(req.productId, req.salePrice, req.durationMinutes)
    return {"productId": req.productId, **entry}


@router.delete("/admin/sale/{product_id}")
async def delete_sale(product_id: str, x_admin_key: str | None = Header(None)):
    _check_admin_key(x_admin_key)
    removed = clear_sale(product_id)
    return {"productId": product_id, "removed": removed}


@router.get("/products", response_model=list[ProductInfo])
async def get_products():
    return [build_product_info(p) for p in CATALOG]


@router.get("/admin/sales")
async def get_sales(x_admin_key: str | None = Header(None)):
    _check_admin_key(x_admin_key)
    return list_sales()
```

- [ ] **Step 2: Mount the admin router**

Edit `shop-api/main.py`. Replace lines 28-29 (`app.include_router(shop_router, prefix="/api")`) with both routers:

```python
from routers.shop import router as shop_router
from routers.admin import router as admin_router

# ... (rest unchanged) ...

app.include_router(shop_router, prefix="/api")
app.include_router(admin_router, prefix="/api/shop")
```

- [ ] **Step 3: Run the server and curl admin endpoints**

```bash
cd shop-api
ADMIN_API_KEY=test-key uv run uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 2
# 401 without key
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/api/shop/admin/sale -H 'Content-Type: application/json' -d '{"productId":"iphone-15-pro","salePrice":999,"durationMinutes":60}'
# 200 with key
curl -s -X POST http://localhost:8000/api/shop/admin/sale -H 'Content-Type: application/json' -H 'X-Admin-Key: test-key' -d '{"productId":"iphone-15-pro","salePrice":999,"durationMinutes":60}'
# Search reflects sale
curl -s "http://localhost:8000/api/shop/search?product=iphone" | python3 -m json.tool
# Products list
curl -s "http://localhost:8000/api/shop/products" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d), d[0]['name'])"
# Clear sale
curl -s -X DELETE -H 'X-Admin-Key: test-key' "http://localhost:8000/api/shop/admin/sale/iphone-15-pro"
kill %1
echo '{}' > data/sales.json
cd ..
```

Expected: `401`, then a JSON entry, then search shows `salePrice: 999.0`, then product count `8` and first name, then `"removed": true`.

- [ ] **Step 4: Commit**

```bash
git add shop-api
git commit -m "feat(shop-api): admin endpoints for sale set/clear and product list"
```

---

## Task 5: Wire shop-api into docker-compose + add env vars

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add the shop-api service**

Edit `docker-compose.yml`. Add after the existing `minio-init` service (before the `volumes:` block):

```yaml
  shop-api:
    build: ./shop-api
    container_name: chatbot-shop-api
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      ADMIN_API_KEY: ${ADMIN_API_KEY}
    volumes:
      - ./shop-api/data:/app/data
    healthcheck:
      test: ["CMD-SHELL", "python -c 'import urllib.request; urllib.request.urlopen(\"http://localhost:8000/\")'"]
      interval: 5s
      timeout: 5s
      retries: 10
```

The `volumes` mount keeps `sales.json` writable and persistent across container restarts.

- [ ] **Step 2: Add new env vars to `.env.example`**

Read the existing `.env.example` first to know where to slot these in. Append to the file:

```
# Shop API (FastAPI service in docker-compose)
SHOP_API_URL=http://localhost:8000/api/shop
SHOP_API_AUDIENCE=https://api.shop-online-demo.com

# CIBA cron + admin
CRON_SECRET=replace-with-random-string
ADMIN_API_KEY=replace-with-random-string
ADMIN_EMAIL=your-demo-user@example.com
```

- [ ] **Step 3: Build and bring up shop-api**

```bash
docker compose build shop-api
docker compose up -d shop-api
sleep 3
curl -s "http://localhost:8000/api/shop/search?product=iphone" | python3 -c "import sys, json; print(json.load(sys.stdin)['product']['name'])"
docker compose logs shop-api --tail 5
```

Expected: prints `iPhone 15 Pro`; logs show uvicorn listening on `0.0.0.0:8000`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(infra): wire shop-api into docker-compose, document env vars"
```

---

## Task 6: Add `watchlist` table to Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0002_<auto-name>.sql` (generated)

- [ ] **Step 1: Append the schema definition**

Edit `lib/db/schema.ts`. Add to the imports (line 1-12) so `numeric` is imported:

```ts
import {
  boolean,
  foreignKey,
  json,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
```

Append at the end of the file (after the `stream` block):

```ts
export const watchlist = pgTable("Watchlist", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: varchar("userId", { length: 255 }).notNull(),
  productId: varchar("productId", { length: 64 }).notNull(),
  productName: text("productName").notNull(),
  targetPrice: numeric("targetPrice", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", {
    enum: ["active", "notified", "purchased", "denied", "error"],
  })
    .notNull()
    .default("active"),
  createdAt: timestamp("createdAt").notNull(),
  notifiedAt: timestamp("notifiedAt"),
  lastSeenPrice: numeric("lastSeenPrice", { precision: 10, scale: 2 }),
  purchasedPrice: numeric("purchasedPrice", { precision: 10, scale: 2 }),
  purchaseDetails: json("purchaseDetails"),
  orderId: text("orderId"),
  acknowledgedAt: timestamp("acknowledgedAt"),
});

export type Watchlist = InferSelectModel<typeof watchlist>;
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new file under `lib/db/migrations/0002_*.sql` plus an updated `_journal.json`. Inspect the SQL — it should be a single `CREATE TABLE "Watchlist" (...)` with no destructive DDL.

- [ ] **Step 3: Apply the migration to the running Postgres**

```bash
docker compose up -d postgres
pnpm db:migrate
```

Expected: completes without error.

- [ ] **Step 4: Verify the table exists**

```bash
docker compose exec postgres psql -U postgres -d chatbot -c '\d "Watchlist"'
```

Expected: column listing matching the schema, including `acknowledgedAt`, `purchaseDetails`, `status` with the enum constraint.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations
git commit -m "feat(db): add Watchlist table"
```

---

## Task 7: Watchlist queries

**Files:**
- Create: `lib/db/queries/watchlist.ts`

- [ ] **Step 1: Create the file**

```ts
import "server-only";

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ChatbotError } from "@/lib/errors";
import { watchlist, type Watchlist } from "../schema";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export type WatchlistStatus = Watchlist["status"];

export async function createWatch(input: {
  userId: string;
  productId: string;
  productName: string;
  targetPrice: number;
}): Promise<Watchlist> {
  try {
    const [row] = await db
      .insert(watchlist)
      .values({
        userId: input.userId,
        productId: input.productId,
        productName: input.productName,
        targetPrice: input.targetPrice.toFixed(2),
        status: "active",
        createdAt: new Date(),
      })
      .returning();
    return row;
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to create watch");
  }
}

export async function listWatchesForUser(userId: string): Promise<Watchlist[]> {
  try {
    return await db.select().from(watchlist).where(eq(watchlist.userId, userId));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to list watches");
  }
}

export async function listActiveWatches(): Promise<Watchlist[]> {
  try {
    return await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.status, "active"));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to list active watches");
  }
}

export async function listUnacknowledgedPurchases(userId: string): Promise<Watchlist[]> {
  try {
    return await db
      .select()
      .from(watchlist)
      .where(
        and(
          eq(watchlist.userId, userId),
          eq(watchlist.status, "purchased"),
          isNull(watchlist.acknowledgedAt)
        )
      );
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to list unacknowledged purchases");
  }
}

export async function countUnacknowledgedPurchases(userId: string): Promise<number> {
  const rows = await listUnacknowledgedPurchases(userId);
  return rows.length;
}

export async function markPurchasesAcknowledged(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db
      .update(watchlist)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          isNull(watchlist.acknowledgedAt),
          eq(watchlist.status, "purchased"),
          inArray(watchlist.id, ids)
        )
      );
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to acknowledge purchases");
  }
}

export async function setWatchNotified(id: string, lastSeenPrice: number): Promise<void> {
  try {
    await db
      .update(watchlist)
      .set({
        status: "notified",
        notifiedAt: new Date(),
        lastSeenPrice: lastSeenPrice.toFixed(2),
      })
      .where(eq(watchlist.id, id));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to mark watch notified");
  }
}

export async function setWatchPurchased(input: {
  id: string;
  orderId: string;
  purchasedPrice: number;
  purchaseDetails: unknown;
}): Promise<void> {
  try {
    await db
      .update(watchlist)
      .set({
        status: "purchased",
        orderId: input.orderId,
        purchasedPrice: input.purchasedPrice.toFixed(2),
        purchaseDetails: input.purchaseDetails as Record<string, unknown>,
        acknowledgedAt: null,
      })
      .where(eq(watchlist.id, input.id));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to mark watch purchased");
  }
}

export async function setWatchStatus(
  id: string,
  status: Exclude<WatchlistStatus, "active" | "notified" | "purchased">
): Promise<void> {
  try {
    await db.update(watchlist).set({ status }).where(eq(watchlist.id, id));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to set watch status");
  }
}

export async function resetStalledNotifiedWatches(olderThanMs: number): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - olderThanMs);
    await db
      .update(watchlist)
      .set({ status: "active" })
      .where(and(eq(watchlist.status, "notified"), lt(watchlist.notifiedAt, cutoff)));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to reset stalled watches");
  }
}

export async function resetAgedDeniedAndErrorWatches(olderThanMs: number): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - olderThanMs);
    await db.execute(sql`
      UPDATE "Watchlist"
      SET status = 'active'
      WHERE status IN ('denied', 'error')
        AND "notifiedAt" IS NOT NULL
        AND "notifiedAt" < ${cutoff}
    `);
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to reset aged watches");
  }
}

export async function deleteWatch(input: { id: string; userId: string }): Promise<boolean> {
  try {
    const deleted = await db
      .delete(watchlist)
      .where(and(eq(watchlist.id, input.id), eq(watchlist.userId, input.userId)))
      .returning({ id: watchlist.id });
    return deleted.length > 0;
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to delete watch");
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. If `Watchlist` type isn't exported from schema, fix in Task 6.

- [ ] **Step 3: Commit**

```bash
git add lib/db/queries
git commit -m "feat(db): watchlist queries module"
```

---

## Task 8: Server-side shop-api client

**Files:**
- Create: `lib/shop-api-client.ts`

- [ ] **Step 1: Create the typed client**

```ts
import "server-only";

export type ShopProduct = {
  id: string;
  name: string;
  category: string;
  pricePerUnit: number;
  salePrice: number | null;
  imageUrl: string;
};

export type ShopSearchResult = {
  product: ShopProduct;
  qty: number;
  subtotal: number;
  tax: number;
  total: number;
  estimatedDelivery: string;
};

export type ShopOrderResponse = {
  orderId: string;
  product: ShopProduct;
  qty: number;
  subtotal: number;
  tax: number;
  total: number;
  estimatedDelivery: string;
  status: string;
};

function baseUrl(): string {
  const url = process.env.SHOP_API_URL;
  if (!url) {
    throw new Error("SHOP_API_URL is not set");
  }
  return url.replace(/\/$/, "");
}

export async function searchProduct(query: string, qty = 1): Promise<ShopSearchResult> {
  const u = new URL(`${baseUrl()}/search`);
  u.searchParams.set("product", query);
  u.searchParams.set("qty", String(qty));
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Shop search failed: ${res.status}`);
  }
  return (await res.json()) as ShopSearchResult;
}

export async function listProducts(): Promise<ShopProduct[]> {
  const res = await fetch(`${baseUrl()}/products`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Shop products list failed: ${res.status}`);
  }
  return (await res.json()) as ShopProduct[];
}

export async function placeOrderWithToken(
  productId: string,
  qty: number,
  accessToken: string
): Promise<ShopOrderResponse> {
  const res = await fetch(`${baseUrl()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ productId, qty }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Shop order failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ShopOrderResponse;
}

export async function adminSetSale(input: {
  productId: string;
  salePrice: number;
  durationMinutes: number;
}): Promise<{ productId: string; salePrice: number; expiresAt: string }> {
  const adminBase = baseUrl();
  const res = await fetch(`${adminBase}/admin/sale`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": requireAdminKey(),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`adminSetSale failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { productId: string; salePrice: number; expiresAt: string };
}

export async function adminClearSale(productId: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/admin/sale/${productId}`, {
    method: "DELETE",
    headers: { "X-Admin-Key": requireAdminKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`adminClearSale failed: ${res.status}`);
  }
}

export async function adminListSales(): Promise<Record<string, { salePrice: number; expiresAt: string }>> {
  const res = await fetch(`${baseUrl()}/admin/sales`, {
    headers: { "X-Admin-Key": requireAdminKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`adminListSales failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, { salePrice: number; expiresAt: string }>;
}

function requireAdminKey(): string {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    throw new Error("ADMIN_API_KEY is not set");
  }
  return key;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/shop-api-client.ts
git commit -m "feat(lib): typed server-side shop-api client"
```

---

## Task 9: `watchlistAdd` tool

**Files:**
- Create: `lib/ai/tools/watchlist-add.ts`

- [ ] **Step 1: Create the tool**

```ts
import { tool } from "ai";
import { z } from "zod";
import { createWatch } from "@/lib/db/queries/watchlist";
import { searchProduct } from "@/lib/shop-api-client";

export const watchlistAdd = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Add a product to the user's price-drop watchlist. Pass a natural product query (e.g. 'iPhone 15 Pro') and a target price. The agent will be notified via Auth0 Guardian push when the product reaches or falls below the target, and on approval the order will be placed automatically.",
    inputSchema: z.object({
      productQuery: z.string().min(1).describe("Product name or keyword (fuzzy match)."),
      targetPrice: z
        .number()
        .positive()
        .describe("Notify when the price is at or below this value (USD)."),
    }),
    execute: async ({ productQuery, targetPrice }) => {
      const result = await searchProduct(productQuery, 1);
      const watch = await createWatch({
        userId,
        productId: result.product.id,
        productName: result.product.name,
        targetPrice,
      });

      return {
        watchId: watch.id,
        product: result.product,
        targetPrice,
        currentPrice: result.product.salePrice ?? result.product.pricePerUnit,
        message: `Watching ${result.product.name}. You'll get a Guardian push if it hits $${targetPrice.toFixed(2)} or below.`,
      };
    },
  });
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

---

## Task 10: `watchlistList` tool

**Files:**
- Create: `lib/ai/tools/watchlist-list.ts`

- [ ] **Step 1: Create the tool**

```ts
import { tool } from "ai";
import { z } from "zod";
import {
  listUnacknowledgedPurchases,
  listWatchesForUser,
  markPurchasesAcknowledged,
} from "@/lib/db/queries/watchlist";

export const watchlistList = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Return the user's watchlist state: active watches, unacknowledged auto-purchases (call this to surface them), and recently denied entries. Calling this MARKS unacknowledged purchases as acknowledged — only call when the user is asking about the watchlist or when proactively surfacing prior auto-purchases.",
    inputSchema: z.object({}),
    execute: async () => {
      const all = await listWatchesForUser(userId);

      const active = all
        .filter((w) => w.status === "active" || w.status === "notified")
        .map((w) => ({
          id: w.id,
          productId: w.productId,
          productName: w.productName,
          targetPrice: Number(w.targetPrice),
          status: w.status,
          lastSeenPrice: w.lastSeenPrice ? Number(w.lastSeenPrice) : null,
        }));

      const recentlyDenied = all
        .filter((w) => w.status === "denied" || w.status === "error")
        .map((w) => ({
          id: w.id,
          productName: w.productName,
          status: w.status,
          notifiedAt: w.notifiedAt,
        }));

      const purchases = await listUnacknowledgedPurchases(userId);
      const unacknowledgedPurchases = purchases.map((w) => {
        const details = (w.purchaseDetails ?? {}) as {
          orderId?: string;
          product?: { id: string; name: string; pricePerUnit?: number };
          qty?: number;
          subtotal?: number;
          tax?: number;
          total?: number;
          estimatedDelivery?: string;
        };
        return {
          watchId: w.id,
          orderId: w.orderId ?? details.orderId ?? "",
          product: {
            id: details.product?.id ?? w.productId,
            name: details.product?.name ?? w.productName,
          },
          qty: details.qty ?? 1,
          originalPrice: details.product?.pricePerUnit ?? null,
          purchasedPrice: w.purchasedPrice ? Number(w.purchasedPrice) : null,
          subtotal: details.subtotal ?? null,
          tax: details.tax ?? null,
          total: details.total ?? null,
          estimatedDelivery: details.estimatedDelivery ?? null,
        };
      });

      if (purchases.length > 0) {
        await markPurchasesAcknowledged(purchases.map((p) => p.id));
      }

      return { active, unacknowledgedPurchases, recentlyDenied };
    },
  });
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

---

## Task 11: `watchlistRemove` tool

**Files:**
- Create: `lib/ai/tools/watchlist-remove.ts`

- [ ] **Step 1: Create the tool**

```ts
import { tool } from "ai";
import { z } from "zod";
import { deleteWatch } from "@/lib/db/queries/watchlist";

export const watchlistRemove = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Remove a watchlist entry by its id. Use after calling watchlistList to find the id when the user asks to stop watching a product.",
    inputSchema: z.object({
      watchId: z.string().min(1).describe("The watch entry id (uuid) returned by watchlistList."),
    }),
    execute: async ({ watchId }) => {
      const removed = await deleteWatch({ id: watchId, userId });
      return { watchId, removed };
    },
  });
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

---

## Task 12: Register tools in chat route + capabilities + prompt

**Files:**
- Modify: `app/(chat)/api/chat/route.ts`
- Modify: `lib/ai/agent-capabilities.ts`
- Modify: `lib/ai/prompts.ts`

- [ ] **Step 1: Add capability registry entries**

Edit `lib/ai/agent-capabilities.ts`. Add three entries to the `AGENT_CAPABILITIES` array (before the trailing `]`):

```ts
  {
    id: "watchlistAdd",
    displayName: "Watch a product for price drops",
    description:
      "Add a product to a price-drop watchlist with a target price. The agent will request a Guardian push when the price drops to or below the target and auto-buy on approval.",
    auth: { kind: "always" },
    status: "registered",
  },
  {
    id: "watchlistList",
    displayName: "List watchlist + recent auto-purchases",
    description:
      "Return active watches, unacknowledged auto-purchases (with order details), and recently denied entries.",
    auth: { kind: "always" },
    status: "registered",
  },
  {
    id: "watchlistRemove",
    displayName: "Stop watching a product",
    description: "Remove a watchlist entry by id.",
    auth: { kind: "always" },
    status: "registered",
  },
```

- [ ] **Step 2: Add a prompt section for the watchlist**

Edit `lib/ai/prompts.ts`. After the `userDataToolsPrompt` export (around line 22) add a new export:

```ts
export const watchlistToolsPrompt = `
**Watchlist tools** — \`watchlistAdd\`, \`watchlistList\`, \`watchlistRemove\`.

Use these whenever the user wants to track a product for price drops, asks "what's on my watchlist", or wants to stop watching something.

- \`watchlistAdd({ productQuery, targetPrice })\` — fuzzy-resolves the product against the catalog and stores a watch entry.
- \`watchlistList({})\` — returns active watches, unacknowledged auto-purchases (with order details), and recently denied entries. Calling this acknowledges any unacknowledged purchases, so do NOT call it speculatively.
- \`watchlistRemove({ watchId })\` — needs the id from a prior \`watchlistList\` call.

When \`watchlistList\` returns \`unacknowledgedPurchases\` with one or more entries, surface them clearly at the start of your reply as an order confirmation: product name, qty, was-price → bought-price, subtotal/tax/total, order id, estimated delivery. Do NOT repeat them on later turns.
`;
```

Then update the `systemPrompt` function (around line 132-149) to include `watchlistToolsPrompt` when tools are active. The final return becomes:

```ts
  return `${identityPrompt}\n\n${regularPrompt}\n\n${requestPrompt}\n\n${userDataToolsPrompt}\n\n${watchlistToolsPrompt}\n\n${artifactsPrompt}`;
```

- [ ] **Step 3: Register tools in the chat route**

Edit `app/(chat)/api/chat/route.ts`:

1. Add three imports near the existing tool imports (around lines 26-31):

```ts
import { watchlistAdd } from "@/lib/ai/tools/watchlist-add";
import { watchlistList } from "@/lib/ai/tools/watchlist-list";
import { watchlistRemove } from "@/lib/ai/tools/watchlist-remove";
```

2. Extend the `tools` object (currently lines 215-234) by adding three entries that pass `userId`:

```ts
        const tools = {
          getWeather,
          gmailSearch,
          watchlistAdd: watchlistAdd({ userId: session.user.sub }),
          watchlistList: watchlistList({ userId: session.user.sub }),
          watchlistRemove: watchlistRemove({ userId: session.user.sub }),
          createDocument: createDocument({
            session,
            dataStream,
            modelId: chatModel,
          }),
          editDocument: editDocument({ dataStream, session }),
          updateDocument: updateDocument({
            session,
            dataStream,
            modelId: chatModel,
          }),
          requestSuggestions: requestSuggestions({
            session,
            dataStream,
            modelId: chatModel,
          }),
        };
```

3. Add three entries to the `experimental_activeTools` array (currently lines 289-296). The full updated array:

```ts
          experimental_activeTools: toolsActive
            ? [
                "getWeather",
                "gmailSearch",
                "watchlistAdd",
                "watchlistList",
                "watchlistRemove",
                "createDocument",
                "editDocument",
                "updateDocument",
                "requestSuggestions",
              ]
            : [],
```

- [ ] **Step 4: Type-check and lint**

```bash
pnpm exec tsc --noEmit
pnpm check
```

Expected: no errors. If `pnpm check` flags style issues introduced by edits, run `pnpm fix` and commit the cleanup with the same change.

- [ ] **Step 5: Manual smoke test in chat**

```bash
docker compose up -d
pnpm dev
```

Open the app, sign in. In a fresh chat:

1. Send: *"Watch the iPhone 15 Pro and let me know if it hits $1000."*
2. Confirm the agent calls `watchlistAdd`, replies with a confirmation message including the product name and target.
3. Verify the row was inserted: `docker compose exec postgres psql -U postgres -d chatbot -c 'SELECT id, "productName", "targetPrice", status FROM "Watchlist";'`

Expected: one row, status `active`.

4. Send: *"What's on my watchlist?"* — agent should call `watchlistList` and report 1 active watch (no purchases yet).
5. Send: *"Stop watching the iPhone."* — agent should call `watchlistList` then `watchlistRemove`, row gone from DB.

Re-add the watch for the iPhone (you'll need it for the cron tests later).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/tools lib/ai/agent-capabilities.ts lib/ai/prompts.ts app/\(chat\)/api/chat/route.ts
git commit -m "feat(chat): watchlist tools (add/list/remove) and registry/prompt wiring"
```

---

## Task 13: Direct CIBA helper

**Files:**
- Create: `lib/auth0-ciba.ts`

- [ ] **Step 1: Create the helper**

```ts
import "server-only";

export class CibaApprovalError extends Error {
  constructor(
    public reason:
      | "access_denied"
      | "expired_token"
      | "slow_down"
      | "transaction_failed"
      | "timeout"
      | "configuration"
      | "network",
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "CibaApprovalError";
  }
}

type AuthorizeResponse = {
  auth_req_id: string;
  expires_in: number;
  interval?: number;
};

type TokenSuccess = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type TokenError = {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | "invalid_request"
    | "invalid_grant"
    | "unauthorized_client";
  error_description?: string;
};

export type RequestCibaApprovalArgs = {
  userId: string; // Auth0 sub
  bindingMessage: string;
  scopes: string[]; // e.g. ["openid", "product:buy"]
  audience: string;
  timeoutMs?: number; // default 90_000
};

export async function requestCibaApproval({
  userId,
  bindingMessage,
  scopes,
  audience,
  timeoutMs = 90_000,
}: RequestCibaApprovalArgs): Promise<{ accessToken: string }> {
  const domain = requireEnv("AUTH0_DOMAIN");
  const clientId = requireEnv("AUTH0_CLIENT_ID");
  const clientSecret = requireEnv("AUTH0_CLIENT_SECRET");

  const baseUrl = domain.startsWith("http") ? domain.replace(/\/$/, "") : `https://${domain}`;
  const authorizeUrl = `${baseUrl}/bc-authorize`;
  const tokenUrl = `${baseUrl}/oauth/token`;
  const issuer = `${baseUrl}/`;

  const loginHint = JSON.stringify({
    format: "iss_sub",
    iss: issuer,
    sub: userId,
  });

  const authorizeBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: scopes.join(" "),
    audience,
    binding_message: bindingMessage,
    login_hint: loginHint,
  });

  let authorize: AuthorizeResponse;
  try {
    const res = await fetch(authorizeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authorizeBody.toString(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new CibaApprovalError(
        "configuration",
        `bc-authorize ${res.status}: ${await res.text()}`
      );
    }
    authorize = (await res.json()) as AuthorizeResponse;
  } catch (err) {
    if (err instanceof CibaApprovalError) throw err;
    throw new CibaApprovalError("network", "bc-authorize failed", err);
  }

  const start = Date.now();
  let intervalSec = Math.max(1, authorize.interval ?? 5);

  while (Date.now() - start < timeoutMs) {
    await sleep(intervalSec * 1000);
    const tokenBody = new URLSearchParams({
      grant_type: "urn:openid:params:grant-type:ciba",
      auth_req_id: authorize.auth_req_id,
      client_id: clientId,
      client_secret: clientSecret,
    });

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
        cache: "no-store",
      });
    } catch (err) {
      throw new CibaApprovalError("network", "/oauth/token failed", err);
    }

    if (res.ok) {
      const success = (await res.json()) as TokenSuccess;
      return { accessToken: success.access_token };
    }

    let payload: TokenError;
    try {
      payload = (await res.json()) as TokenError;
    } catch {
      throw new CibaApprovalError("transaction_failed", `Unexpected token response ${res.status}`);
    }

    switch (payload.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        intervalSec += 5;
        continue;
      case "expired_token":
        throw new CibaApprovalError("expired_token", payload.error_description ?? "Push expired");
      case "access_denied":
        throw new CibaApprovalError("access_denied", payload.error_description ?? "User denied");
      default:
        throw new CibaApprovalError(
          "transaction_failed",
          `${payload.error}: ${payload.error_description ?? ""}`
        );
    }
  }

  throw new CibaApprovalError("timeout", "CIBA approval timed out");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new CibaApprovalError("configuration", `Missing ${name}`);
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual end-to-end CIBA round-trip script**

Create a temporary script `scripts/ciba-smoke.ts` that imports the helper and runs one approval request. This file is **not** committed.

```ts
import "dotenv/config";
import { requestCibaApproval } from "../lib/auth0-ciba";

const userSub = process.argv[2];
if (!userSub) {
  console.error("Usage: tsx scripts/ciba-smoke.ts <auth0-sub>");
  process.exit(1);
}

(async () => {
  const result = await requestCibaApproval({
    userId: userSub,
    bindingMessage: "Smoke test: approve to confirm CIBA wiring.",
    scopes: ["openid", "product:buy"],
    audience: process.env.SHOP_API_AUDIENCE!,
    timeoutMs: 60_000,
  });
  console.log("Got access token (truncated):", result.accessToken.slice(0, 24), "...");
})().catch((err) => {
  console.error("CIBA smoke failed:", err);
  process.exit(1);
});
```

Run it (replace the sub with your demo user's `auth0|...` value, found in `auth0.getSession()` or the Auth0 dashboard):

```bash
pnpm exec tsx scripts/ciba-smoke.ts 'auth0|REPLACE_ME'
```

Expected: a Guardian push lands on your phone within ~1s. Approve. The script prints `Got access token (truncated): ...`.

If you get `access_denied`, `expired_token`, or `configuration`, fix the underlying Auth0 setup before continuing — the cron route depends on this working.

- [ ] **Step 4: Delete the smoke script and commit the helper**

```bash
rm scripts/ciba-smoke.ts
git add lib/auth0-ciba.ts
git commit -m "feat(auth0): direct CIBA approval helper for cron use"
```

---

## Task 14: Cron route + vercel.json

**Files:**
- Create: `app/api/cron/check-watchlists/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Create the cron route**

```ts
import { type NextRequest, NextResponse } from "next/server";
import {
  CibaApprovalError,
  requestCibaApproval,
} from "@/lib/auth0-ciba";
import {
  listActiveWatches,
  resetAgedDeniedAndErrorWatches,
  resetStalledNotifiedWatches,
  setWatchNotified,
  setWatchPurchased,
  setWatchStatus,
} from "@/lib/db/queries/watchlist";
import {
  placeOrderWithToken,
  searchProduct,
  type ShopSearchResult,
} from "@/lib/shop-api-client";

export const maxDuration = 60;

const STALL_RESET_MS = 90_000;
const COOLDOWN_RESET_MS = 24 * 60 * 60 * 1000;

type TickSummary = {
  checked: number;
  triggered: number;
  purchased: number;
  denied: number;
  errors: number;
  details: Array<{
    watchId: string;
    productId: string;
    outcome: "no-drop" | "purchased" | "denied" | "error";
    note?: string;
  }>;
};

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await resetStalledNotifiedWatches(STALL_RESET_MS);
  await resetAgedDeniedAndErrorWatches(COOLDOWN_RESET_MS);

  const watches = await listActiveWatches();
  const summary: TickSummary = {
    checked: watches.length,
    triggered: 0,
    purchased: 0,
    denied: 0,
    errors: 0,
    details: [],
  };

  const audience = process.env.SHOP_API_AUDIENCE;
  if (!audience) {
    return NextResponse.json({ error: "SHOP_API_AUDIENCE not set" }, { status: 500 });
  }

  // Cache shop-api results per productId during this tick.
  const priceCache = new Map<string, ShopSearchResult>();

  for (const watch of watches) {
    let priced = priceCache.get(watch.productId);
    if (!priced) {
      try {
        priced = await searchProduct(watch.productId, 1);
        priceCache.set(watch.productId, priced);
      } catch (err) {
        summary.errors += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "error",
          note: `shop search failed: ${(err as Error).message}`,
        });
        continue;
      }
    }

    const currentPrice =
      priced.product.salePrice ?? priced.product.pricePerUnit;
    const target = Number(watch.targetPrice);

    if (currentPrice > target) {
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "no-drop",
      });
      continue;
    }

    summary.triggered += 1;
    await setWatchNotified(watch.id, currentPrice);

    const bindingMessage = `Buy 1x ${priced.product.name} at $${currentPrice.toFixed(2)} (was $${priced.product.pricePerUnit.toFixed(2)})?`;

    let accessToken: string;
    try {
      const approved = await requestCibaApproval({
        userId: watch.userId,
        bindingMessage,
        scopes: ["openid", "product:buy"],
        audience,
      });
      accessToken = approved.accessToken;
    } catch (err) {
      if (err instanceof CibaApprovalError) {
        if (err.reason === "access_denied" || err.reason === "expired_token" || err.reason === "timeout") {
          await setWatchStatus(watch.id, "denied");
          summary.denied += 1;
          summary.details.push({
            watchId: watch.id,
            productId: watch.productId,
            outcome: "denied",
            note: err.reason,
          });
          continue;
        }
      }
      await setWatchStatus(watch.id, "error");
      summary.errors += 1;
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "error",
        note: (err as Error).message,
      });
      continue;
    }

    try {
      const order = await placeOrderWithToken(watch.productId, 1, accessToken);
      await setWatchPurchased({
        id: watch.id,
        orderId: order.orderId,
        purchasedPrice: currentPrice,
        purchaseDetails: order,
      });
      summary.purchased += 1;
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "purchased",
        note: order.orderId,
      });
    } catch (err) {
      await setWatchStatus(watch.id, "error");
      summary.errors += 1;
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "error",
        note: `order failed: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json(summary);
}

export async function GET(request: NextRequest) {
  // Allow GET for Vercel Cron compatibility (Vercel hits cron paths with GET by default).
  return POST(request);
}
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/check-watchlists",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual cron round-trip**

With `pnpm dev` running and `docker compose up shop-api`:

```bash
# Put the iPhone on sale below your target ($1000 from Task 12)
curl -s -X POST http://localhost:8000/api/shop/admin/sale \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"productId":"iphone-15-pro","salePrice":999,"durationMinutes":60}'

# Trigger the cron
curl -s -X POST http://localhost:3000/api/cron/check-watchlists \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -m json.tool
```

Expected: a Guardian push lands. Approve on phone. Response JSON shows `purchased: 1`, `details[0].outcome: "purchased"` with an order id.

Verify DB state:

```bash
docker compose exec postgres psql -U postgres -d chatbot -c 'SELECT status, "orderId", "purchasedPrice", "acknowledgedAt" FROM "Watchlist";'
```

Expected: status `purchased`, `orderId` populated, `acknowledgedAt` NULL.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron vercel.json
git commit -m "feat(cron): watchlist check route with CIBA push and auto-purchase"
```

---

## Task 15: Surface unacknowledged purchases in the system prompt

**Files:**
- Modify: `lib/ai/agent-identity.ts` (extend `AgentIdentity` type + builder)
- Modify: `lib/ai/prompts.ts` (extend `agentIdentityPrompt` to render the hint)
- Modify: `app/(chat)/api/chat/route.ts` already passes `agentIdentity`; no signature change needed since the new field rides on the existing object

- [ ] **Step 1: Extend the agent identity**

Edit `lib/ai/agent-identity.ts`. Update the `AgentIdentity` type and the builder:

```ts
import {
  type ConnectedAccount,
  fetchConnectedAccounts,
} from "@/lib/actions/profile";
import type { AppSession } from "@/lib/auth0-types";
import { countUnacknowledgedPurchases } from "@/lib/db/queries/watchlist";
import {
  AGENT_CAPABILITIES,
  type Capability,
  type CapabilityAuth,
} from "./agent-capabilities";

export type AgentIdentity = {
  userName: string;
  available: Capability[];
  needsAuthorization: Capability[];
  planned: Capability[];
  unacknowledgedPurchaseCount: number;
};

function resolveUserName(session: AppSession): string {
  const user = session.user;
  if (user.name) return user.name;
  if (user.nickname) return user.nickname;
  if (user.email) {
    const [local] = user.email.split("@");
    if (local) return local;
  }
  return "there";
}

function hasRequiredScopes(
  accounts: ConnectedAccount[],
  auth: Extract<CapabilityAuth, { kind: "token-vault" }>
): boolean {
  return accounts.some((account) => {
    if (account.connection !== auth.connection) return false;
    const granted = new Set(account.scopes);
    return auth.scopes.every((scope) => granted.has(scope));
  });
}

export async function buildAgentIdentity({
  session,
}: {
  session: AppSession;
}): Promise<AgentIdentity> {
  const userName = resolveUserName(session);
  const accounts = await fetchConnectedAccounts();

  const available: Capability[] = [];
  const needsAuthorization: Capability[] = [];
  const planned: Capability[] = [];

  for (const capability of AGENT_CAPABILITIES) {
    if (capability.status === "planned") {
      planned.push(capability);
      continue;
    }
    if (capability.auth.kind === "always") {
      available.push(capability);
      continue;
    }
    if (hasRequiredScopes(accounts, capability.auth)) {
      available.push(capability);
    } else {
      needsAuthorization.push(capability);
    }
  }

  const unacknowledgedPurchaseCount = session.user.sub
    ? await countUnacknowledgedPurchases(session.user.sub)
    : 0;

  return {
    userName,
    available,
    needsAuthorization,
    planned,
    unacknowledgedPurchaseCount,
  };
}
```

- [ ] **Step 2: Render the hint in the prompt**

Edit `lib/ai/prompts.ts`. Update `agentIdentityPrompt` (around lines 90-130). Add a section that conditionally appends the unacknowledged-purchases instruction. Replace the function with:

```ts
export const agentIdentityPrompt = (identity: AgentIdentity): string => {
  const availableSection =
    identity.available.length > 0
      ? `Available now:\n${identity.available.map(formatCapabilityLine).join("\n")}`
      : "Available now: (none)";

  const needsAuthSection =
    identity.needsAuthorization.length > 0
      ? `With a connected Google account, also available:\n${identity.needsAuthorization.map(formatCapabilityLine).join("\n")}`
      : "";

  const plannedSection =
    identity.planned.length > 0
      ? `Coming soon (not yet implemented):\n${identity.planned.map(formatCapabilityLine).join("\n")}`
      : "";

  const inventory = [availableSection, needsAuthSection, plannedSection]
    .filter(Boolean)
    .join("\n\n");

  const watchlistAlert =
    identity.unacknowledgedPurchaseCount > 0
      ? `

## Pending watchlist update

While the user was away, ${identity.unacknowledgedPurchaseCount} auto-purchase(s) from their watchlist completed. Before answering anything else, call \`watchlistList\` once and surface the \`unacknowledgedPurchases\` to the user as an order confirmation block (item, qty, was-price → bought-price, subtotal, tax, total, order id, estimated delivery). Calling \`watchlistList\` will mark them acknowledged so you won't repeat them.`
      : "";

  return `# Your identity

You are an instance of Chatbot, working on behalf of ${identity.userName}. Every action you take is on their behalf — never claim to be a generic assistant or to have no user.

## Your tool inventory

${inventory}${watchlistAlert}

## When the user asks who you are or what you can do

This includes "who are you", "what is your name", "what can you do", "what tools do you have", "what are your capabilities", or any similar question. When asked, you MUST:

1. Start with: "I'm an instance of Chatbot, working on behalf of ${identity.userName}."
2. List the **Available now** capabilities as a bulleted list, using each item's **displayName** and a short paraphrase of its description.
3. If there are **with a connected Google account** items, list them as a separate bulleted section introduced with "With a connected Google account I could also:".
4. If there are **Coming soon** items, list them as a separate bulleted section introduced with "Coming soon:".
5. Do NOT collapse these lists into a single sentence. Keep the sections distinct so the user can see the difference between what is available now, what requires authorization, and what is planned.
6. Do NOT invent tools, scopes, or capabilities that are not in the inventory above.

For these identity questions, prefer completeness over brevity — the "be concise" guidance does not apply.`;
};
```

- [ ] **Step 3: Type-check and lint**

```bash
pnpm exec tsc --noEmit
pnpm check
```

Expected: no errors.

- [ ] **Step 4: Manual verification of the surfacing flow**

With the `purchased` row from Task 14 still in DB and `acknowledgedAt` NULL:

1. Open chat in a fresh session, send: *"hi"*.
2. Expect the agent to call `watchlistList` and render an order-confirmation block with the iPhone purchase details (was $1199, bought at $999, total ~$1078.92, order id, est. delivery).
3. Send another message ("anything else?"). Expect no repeat of the confirmation.
4. Verify DB: `acknowledgedAt` is now set:

```bash
docker compose exec postgres psql -U postgres -d chatbot -c 'SELECT status, "acknowledgedAt" FROM "Watchlist";'
```

Expected: `acknowledgedAt` populated for the purchased row.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent-identity.ts lib/ai/prompts.ts
git commit -m "feat(chat): surface unacknowledged auto-purchases on next chat turn"
```

---

## Task 16: Admin sale proxy route

**Files:**
- Create: `app/api/admin/sale/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { type NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import {
  adminClearSale,
  adminListSales,
  adminSetSale,
} from "@/lib/shop-api-client";

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await auth0.getSession();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!adminEmail || session.user.email !== adminEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sales = await adminListSales();
  return NextResponse.json(sales);
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = (await request.json()) as {
    productId: string;
    salePrice: number;
    durationMinutes: number;
  };
  const result = await adminSetSale(body);
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "missing productId" }, { status: 400 });
  }
  await adminClearSale(productId);
  return NextResponse.json({ productId, removed: true });
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin
git commit -m "feat(admin): proxy route for shop-api sale set/clear/list"
```

---

## Task 17: Admin page UI

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/admin/admin-client.tsx`

- [ ] **Step 1: Create the server component**

```tsx
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { listProducts } from "@/lib/shop-api-client";
import { AdminClient } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth0.getSession();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email) {
    redirect("/auth/login?returnTo=/admin");
  }
  if (!adminEmail || session.user.email !== adminEmail) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="font-bold text-2xl">Forbidden</h1>
        <p className="mt-2 text-sm">
          Set <code>ADMIN_EMAIL</code> to <code>{session.user.email}</code> to access this page.
        </p>
      </div>
    );
  }

  const products = await listProducts();
  return <AdminClient products={products} />;
}
```

- [ ] **Step 2: Create the client component**

```tsx
"use client";

import { useState } from "react";
import type { ShopProduct } from "@/lib/shop-api-client";

type SaleEntry = { salePrice: number; expiresAt: string };

export function AdminClient({ products }: { products: ShopProduct[] }) {
  const [sales, setSales] = useState<Record<string, SaleEntry>>({});
  const [draft, setDraft] = useState<Record<string, { price: string; minutes: string }>>({});
  const [tickResult, setTickResult] = useState<unknown>(null);
  const [isRunningCron, setIsRunningCron] = useState(false);

  async function refreshSales() {
    const res = await fetch("/api/admin/sale", { cache: "no-store" });
    if (res.ok) {
      setSales((await res.json()) as Record<string, SaleEntry>);
    }
  }

  async function setSale(productId: string) {
    const d = draft[productId] ?? { price: "", minutes: "" };
    const salePrice = Number.parseFloat(d.price);
    const durationMinutes = Number.parseInt(d.minutes, 10);
    if (!Number.isFinite(salePrice) || !Number.isFinite(durationMinutes)) return;
    await fetch("/api/admin/sale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, salePrice, durationMinutes }),
    });
    await refreshSales();
  }

  async function clearSale(productId: string) {
    await fetch(`/api/admin/sale?productId=${encodeURIComponent(productId)}`, {
      method: "DELETE",
    });
    await refreshSales();
  }

  async function runCron() {
    setIsRunningCron(true);
    try {
      // The /api/admin/run-cron proxy enforces ADMIN_EMAIL gate and forwards
      // to /api/cron/check-watchlists with the server-only CRON_SECRET.
      const res = await fetch("/api/admin/run-cron", { method: "POST" });
      setTickResult(await res.json());
    } finally {
      setIsRunningCron(false);
    }
  }

  // Initial load
  if (Object.keys(sales).length === 0) {
    void refreshSales();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <h1 className="font-bold text-2xl">Watchlist demo admin</h1>
        <p className="text-muted-foreground text-sm">
          Trigger sales and run the cron tick on demand.
        </p>
      </header>

      <section className="space-y-2">
        <button
          type="button"
          onClick={runCron}
          disabled={isRunningCron}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {isRunningCron ? "Running…" : "Run watchlist check now"}
        </button>
        {tickResult !== null && (
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(tickResult, null, 2)}
          </pre>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Products</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Product</th>
              <th>MSRP</th>
              <th>Sale</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const sale = sales[p.id];
              const d = draft[p.id] ?? { price: "", minutes: "60" };
              return (
                <tr key={p.id} className="border-b align-top">
                  <td className="py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground text-xs">{p.id}</div>
                  </td>
                  <td>${p.pricePerUnit.toFixed(2)}</td>
                  <td>{sale ? `$${sale.salePrice.toFixed(2)}` : "—"}</td>
                  <td>{sale ? new Date(sale.expiresAt).toLocaleString() : "—"}</td>
                  <td className="space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Sale $"
                      value={d.price}
                      onChange={(e) =>
                        setDraft((s) => ({ ...s, [p.id]: { ...d, price: e.target.value } }))
                      }
                      className="w-24 rounded border px-2 py-1"
                    />
                    <input
                      type="number"
                      placeholder="min"
                      value={d.minutes}
                      onChange={(e) =>
                        setDraft((s) => ({ ...s, [p.id]: { ...d, minutes: e.target.value } }))
                      }
                      className="w-16 rounded border px-2 py-1"
                    />
                    <button
                      type="button"
                      onClick={() => setSale(p.id)}
                      className="rounded bg-blue-600 px-2 py-1 text-white"
                    >
                      Put on sale
                    </button>
                    {sale && (
                      <button
                        type="button"
                        onClick={() => clearSale(p.id)}
                        className="rounded bg-gray-200 px-2 py-1"
                      >
                        Clear
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Create the run-cron proxy route**

The admin client calls `/api/admin/run-cron` (not the cron route directly) so the `CRON_SECRET` stays server-side. Create `app/api/admin/run-cron/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function POST() {
  const session = await auth0.getSession();
  if (
    !session?.user?.email ||
    !process.env.ADMIN_EMAIL ||
    session.user.email !== process.env.ADMIN_EMAIL
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }
  const url = new URL("/api/cron/check-watchlists", process.env.APP_BASE_URL ?? "http://localhost:3000");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    cache: "no-store",
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual verification**

With dev server running and signed in as the user whose email matches `ADMIN_EMAIL`:

1. Visit `http://localhost:3000/admin`. Verify the product table loads with 8 products.
2. For "iPhone 15 Pro", enter Sale `999`, minutes `60`, click "Put on sale". Verify the row updates with the sale price + expires.
3. Click "Run watchlist check now". A Guardian push should land. Approve.
4. Result panel should show `purchased: 1, denied: 0, errors: 0`.
5. Click "Clear" to remove the sale.

- [ ] **Step 6: Commit**

```bash
git add app/admin app/api/admin/run-cron
git commit -m "feat(admin): demo page for sale trigger and on-demand cron run"
```

---

## Task 18: Wrap-up — README and final smoke

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the demo and Auth0 prerequisites**

Read the current `README.md`. Append a new section near the existing demo/setup content:

````markdown
## CIBA Price-Drop Watchlist demo

This branch demonstrates Auth0 CIBA + Guardian as out-of-session human-in-the-loop.

### Auth0 prerequisites (one-time)

1. Create an API in Auth0 with audience matching `SHOP_API_AUDIENCE` (default `https://api.shop-online-demo.com`) and add the scope `product:buy`.
2. On the Auth0 application, enable the grant type **Client-Initiated Backchannel Authentication (CIBA)** under Advanced → Grant Types.
3. In Tenant Settings → Authentication Profile, ensure CIBA is enabled.
4. Enroll your demo user in Guardian.

### Local run

```bash
docker compose up -d        # postgres, redis, minio, shop-api
pnpm db:migrate
pnpm dev
```

Set the new env vars in `.env.local` (see `.env.example`):

- `SHOP_API_URL=http://localhost:8000/api/shop`
- `SHOP_API_AUDIENCE=https://api.shop-online-demo.com`
- `CRON_SECRET=<random>`
- `ADMIN_API_KEY=<random>` (must match the value passed into the shop-api container)
- `ADMIN_EMAIL=<your demo user's email>`

### Demo flow

1. Sign in. In chat: *"Watch the iPhone 15 Pro and let me know if it drops below $1000."*
2. Open `/admin` (must match `ADMIN_EMAIL`). Put the iPhone on sale at $999.
3. Click "Run watchlist check now". A Guardian push lands. Approve on phone.
4. Sign back into chat (or just send a new message). The agent surfaces the order confirmation.

`/api/cron/check-watchlists` is also wired to Vercel Cron (`vercel.json`) for production use at one-minute cadence.
````

- [ ] **Step 2: End-to-end smoke (one full pass)**

Without docker-compose recreating volumes, run the entire happy path one more time as documented in the spec's verification section to make sure nothing regressed:

1. Add a fresh watchlist entry for "iPad Pro" at $700.
2. Hit `/admin`, put iPad Pro on sale at $699 for 5 minutes.
3. Run cron from the admin page.
4. Approve push.
5. Send "hi" in chat → agent surfaces iPad Pro confirmation.
6. Send "hi" again → no repeat.
7. Add another watchlist for Sony headphones at $300; on `/admin` put them on sale at $250; run cron; this time **deny** the push on the phone. Verify the watchlist row goes to `denied` and no order is placed.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: README section for CIBA watchlist demo + Auth0 prereqs"
git push -u origin feat/ciba-watchlist
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat: CIBA price-drop watchlist demo" --body "$(cat <<'EOF'
## Summary

- Adds an out-of-session CIBA + Guardian demo: agent watches user-defined products, requests approval via push when prices drop, auto-purchases on approval, and surfaces the order confirmation in chat next session.
- New FastAPI shop-api (copied from assistant0-vercel-arize, extended with sale + admin endpoints) running in docker-compose.
- New `Watchlist` Drizzle table; three chat tools (add/list/remove); direct CIBA helper (`lib/auth0-ciba.ts`); cron route at `/api/cron/check-watchlists` plus `vercel.json`; admin page at `/admin` for sale triggering and on-demand cron run.

See `docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md` and `docs/superpowers/plans/2026-05-26-ciba-watchlist.md`.

## Test plan

- [ ] `docker compose up -d` brings up shop-api at :8000
- [ ] `pnpm db:migrate` creates the `Watchlist` table
- [ ] Chat `/watchlistAdd` + `/watchlistList` + `/watchlistRemove` round-trip works
- [ ] `/admin` gates by `ADMIN_EMAIL`, lists 8 products
- [ ] Putting a product on sale below the watch target + clicking "Run watchlist check now" delivers a Guardian push
- [ ] Approving the push results in `purchased: 1` and a new shop-api order
- [ ] Next chat session surfaces the order confirmation; subsequent turns do not repeat it
- [ ] Denying the push results in `denied: 1` and no order placed
- [ ] Vercel Cron entry scheduled at `*/1 * * * *`
EOF
)"
```

Expected: PR URL printed.

---

## Self-review checklist (already run during plan authoring)

- ✅ Spec coverage: every section in `2026-05-26-ciba-price-watchlist-design.md` maps to one or more tasks above (shop-api copy → Task 2; sales → Task 3; admin → Task 4; docker-compose → Task 5; schema → Task 6; queries → Task 7; shop client → Task 8; tools → Tasks 9–12; CIBA helper → Task 13; cron → Task 14; surfacing → Task 15; admin UI → Tasks 16–17; env/README → Tasks 5 + 18).
- ✅ No placeholders: every step contains the file content, command, or verification needed to execute it.
- ✅ Type/name consistency: tool names match across the registry (`agent-capabilities.ts`), the chat-route registration, the prompt section, and the file names. `requestCibaApproval` signature matches the cron call site. `Watchlist` row column names match the queries module and the cron handler. `ShopProduct` / `ShopSearchResult` / `ShopOrderResponse` match the shapes consumed in the tools and cron.
