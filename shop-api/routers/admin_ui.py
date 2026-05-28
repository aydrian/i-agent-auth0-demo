"""Server-rendered admin UI for the shop.

Cookie-gated: the user logs in once with the ADMIN_API_KEY value, which is
stored in an httpOnly `admin_session` cookie. All admin pages require the
cookie to match the env value. The JSON API (routers/admin.py, mounted under
/api/shop) keeps using the X-Admin-Key header for programmatic callers.
"""

from pathlib import Path
import os

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from sales import set_sale, clear_sale, list_sales
from history import record_price
from routers.shop import CATALOG, CATALOG_INDEX, build_product_info

router = APIRouter()

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

COOKIE_NAME = "admin_session"


def _admin_key() -> str:
    key = os.environ.get("ADMIN_API_KEY")
    if not key:
        # Fail fast — admin pages are useless without the env var.
        raise RuntimeError("ADMIN_API_KEY is not set")
    return key


def _is_logged_in(request: Request) -> bool:
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return False
    return cookie == _admin_key()


@router.get("/admin")
async def admin_root(request: Request):
    if _is_logged_in(request):
        return RedirectResponse(url="/admin/products", status_code=303)
    error = request.query_params.get("error") == "1"
    return templates.TemplateResponse(
        request,
        "admin/login.html",
        {"logged_in": False, "error": error},
    )


@router.post("/admin/login")
async def admin_login(admin_key: str = Form(...)):
    if admin_key != _admin_key():
        return RedirectResponse(url="/admin?error=1", status_code=303)
    response = RedirectResponse(url="/admin/products", status_code=303)
    response.set_cookie(
        key=COOKIE_NAME,
        value=admin_key,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=24 * 60 * 60,  # 1 day
    )
    return response


@router.post("/admin/logout")
async def admin_logout():
    response = RedirectResponse(url="/admin", status_code=303)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.get("/admin/products")
async def admin_products(request: Request):
    if not _is_logged_in(request):
        return RedirectResponse(url="/admin", status_code=303)
    products = [build_product_info(p) for p in CATALOG]
    sales = list_sales()
    return templates.TemplateResponse(
        request,
        "admin/products.html",
        {"logged_in": True, "products": products, "sales": sales},
    )


@router.post("/admin/sale")
async def admin_set_sale(
    request: Request,
    productId: str = Form(...),
    salePrice: float = Form(..., gt=0),
    durationMinutes: int = Form(..., gt=0, le=1440),
):
    if not _is_logged_in(request):
        return RedirectResponse(url="/admin", status_code=303)
    if productId not in CATALOG_INDEX:
        # Render products page with an inline note; simpler: just redirect.
        return RedirectResponse(url="/admin/products", status_code=303)
    set_sale(productId, salePrice, durationMinutes)
    product = CATALOG_INDEX[productId]
    record_price(productId, salePrice, float(product["pricePerUnit"]))
    return RedirectResponse(url="/admin/products", status_code=303)


@router.post("/admin/sale/{product_id}/clear")
async def admin_clear_sale(request: Request, product_id: str):
    if not _is_logged_in(request):
        return RedirectResponse(url="/admin", status_code=303)
    clear_sale(product_id)
    return RedirectResponse(url="/admin/products", status_code=303)
