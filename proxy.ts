import { type NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  // Auth0 mounts its own routes at /auth/* (login, logout, callback, profile)
  // and refreshes the session cookie on every request. For /auth/* it returns
  // a real response; for other paths it returns NextResponse.next() with the
  // refreshed cookie attached.
  const authRes = await auth0.middleware(request);

  if (pathname.startsWith("/auth")) {
    return authRes;
  }

  const session = await auth0.getSession(request);

  if (!session) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const returnTo = encodeURIComponent(
      pathname + (request.nextUrl.search ?? "")
    );
    return NextResponse.redirect(
      new URL(`${base}/auth/login?returnTo=${returnTo}`, request.url)
    );
  }

  return authRes;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
