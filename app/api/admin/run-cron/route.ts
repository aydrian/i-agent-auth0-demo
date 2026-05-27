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
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const url = new URL("/api/cron/check-watchlists", baseUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    cache: "no-store",
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
