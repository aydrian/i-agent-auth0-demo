import json
import random
import string
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from rapidfuzz import fuzz

from models import ProductInfo, OrderRequest, OrderResponse, SearchResponse
from sales import get_sale_price
from history import get_history, record_price

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


@router.get("/shop/products/{product_id}/history")
async def get_product_history(product_id: str, days: int = Query(14, ge=1, le=30)):
    """Return the last `days` daily price snapshots for a product."""
    if product_id not in CATALOG_INDEX:
        raise HTTPException(status_code=404, detail={"error": "Unknown productId", "productId": product_id})
    product = CATALOG_INDEX[product_id]
    return get_history(product_id, float(product["pricePerUnit"]), days)
