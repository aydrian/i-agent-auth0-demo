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
  if (denied) {
    return denied;
  }
  const sales = await adminListSales();
  return NextResponse.json(sales);
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) {
    return denied;
  }
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
  if (denied) {
    return denied;
  }
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "missing productId" }, { status: 400 });
  }
  await adminClearSale(productId);
  return NextResponse.json({ productId, removed: true });
}
