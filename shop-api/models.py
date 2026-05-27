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
