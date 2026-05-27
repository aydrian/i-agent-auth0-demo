"use client";

import { useEffect, useState } from "react";
import type { ShopProduct } from "@/lib/shop-api-client";

type SaleEntry = { salePrice: number; expiresAt: string };

export function AdminClient({ products }: { products: ShopProduct[] }) {
  const [sales, setSales] = useState<Record<string, SaleEntry>>({});
  const [draft, setDraft] = useState<
    Record<string, { price: string; minutes: string }>
  >({});
  const [tickResult, setTickResult] = useState<unknown>(null);
  const [isRunningCron, setIsRunningCron] = useState(false);

  async function refreshSales() {
    const res = await fetch("/api/admin/sale", { cache: "no-store" });
    if (res.ok) {
      setSales((await res.json()) as Record<string, SaleEntry>);
    }
  }

  // Load sales once on mount. Must be in useEffect — calling it from the
  // render body executes during SSR, where fetch() rejects relative URLs.
  useEffect(() => {
    refreshSales();
  }, []);

  async function setSale(productId: string) {
    const d = draft[productId] ?? { price: "", minutes: "" };
    const salePrice = Number.parseFloat(d.price);
    const durationMinutes = Number.parseInt(d.minutes, 10);
    if (!Number.isFinite(salePrice) || !Number.isFinite(durationMinutes)) {
      return;
    }
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
      const res = await fetch("/api/admin/run-cron", { method: "POST" });
      setTickResult(await res.json());
    } finally {
      setIsRunningCron(false);
    }
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
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={isRunningCron}
          onClick={runCron}
          type="button"
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
                <tr className="border-b align-top" key={p.id}>
                  <td className="py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground text-xs">{p.id}</div>
                  </td>
                  <td>${p.pricePerUnit.toFixed(2)}</td>
                  <td>{sale ? `$${sale.salePrice.toFixed(2)}` : "—"}</td>
                  <td>
                    {sale ? new Date(sale.expiresAt).toLocaleString() : "—"}
                  </td>
                  <td className="flex flex-wrap items-center gap-2">
                    <span>$</span>
                    <input
                      aria-label="Sale price"
                      className="w-24 rounded border px-2 py-1"
                      onChange={(e) =>
                        setDraft((s) => ({
                          ...s,
                          [p.id]: { ...d, price: e.target.value },
                        }))
                      }
                      placeholder="999.00"
                      step="0.01"
                      type="number"
                      value={d.price}
                    />
                    <span>for</span>
                    <input
                      aria-label="Sale duration in minutes"
                      className="w-16 rounded border px-2 py-1"
                      onChange={(e) =>
                        setDraft((s) => ({
                          ...s,
                          [p.id]: { ...d, minutes: e.target.value },
                        }))
                      }
                      placeholder="60"
                      title="Sale duration in minutes"
                      type="number"
                      value={d.minutes}
                    />
                    <span>mins</span>
                    <button
                      className="rounded bg-blue-600 px-2 py-1 text-white"
                      onClick={() => setSale(p.id)}
                      type="button"
                    >
                      Put on sale
                    </button>
                    {sale && (
                      <button
                        className="rounded bg-gray-200 px-2 py-1"
                        onClick={() => clearSale(p.id)}
                        type="button"
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
