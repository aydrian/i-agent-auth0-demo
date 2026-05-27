import os
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from models import ProductInfo
from sales import set_sale, clear_sale, list_sales
from history import record_price
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
    # Also record the sale price in the history so the agent's
    # getProductHistory tool sees today's drop immediately.
    product = next((p for p in CATALOG if p["id"] == req.productId), None)
    if product:
        record_price(req.productId, req.salePrice, float(product["pricePerUnit"]))
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
