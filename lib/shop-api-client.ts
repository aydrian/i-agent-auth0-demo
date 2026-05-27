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

export async function searchProduct(
  query: string,
  qty = 1
): Promise<ShopSearchResult> {
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
  return (await res.json()) as {
    productId: string;
    salePrice: number;
    expiresAt: string;
  };
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

export async function adminListSales(): Promise<
  Record<string, { salePrice: number; expiresAt: string }>
> {
  const res = await fetch(`${baseUrl()}/admin/sales`, {
    headers: { "X-Admin-Key": requireAdminKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`adminListSales failed: ${res.status}`);
  }
  return (await res.json()) as Record<
    string,
    { salePrice: number; expiresAt: string }
  >;
}

function requireAdminKey(): string {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    throw new Error("ADMIN_API_KEY is not set");
  }
  return key;
}
