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
          Set <code>ADMIN_EMAIL</code> to <code>{session.user.email}</code> to
          access this page.
        </p>
      </div>
    );
  }

  const products = await listProducts();
  return <AdminClient products={products} />;
}
