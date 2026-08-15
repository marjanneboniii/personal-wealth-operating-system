import { redirect } from "next/navigation";

/**
 * دارایی‌ها → دارایی‌های واقعی
 *
 * The real-asset workspace (املاک / خودرو / طلا / کالا) already exists as a
 * complete feature at `/asset-registry`. Product grouping must not duplicate
 * it, so this route simply forwards to the canonical page — no second RWA
 * view, no second asset truth.
 */
export default function RealAssetsRedirect() {
  redirect("/asset-registry");
}
