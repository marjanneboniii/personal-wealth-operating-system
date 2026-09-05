"use client";

import { useEffect } from "react";
import Icon from "@/components/ui/Icon";

/**
 * Route-level boundary for «ردیاب تورم شخصی».
 *
 * The page is fail-soft by construction (every read degrades on its own), so
 * this only catches truly unexpected failures. It exists because a thrown
 * error used to bubble up and leave the module showing nothing at all — a
 * blank page is never an acceptable answer in financial software.
 */
export default function InflationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[inflation] route error:", error);
  }, [error]);

  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--negative-soft)", color: "var(--negative)" }}
      >
        <Icon name="alert" size={22} />
      </span>
      <h2 className="text-[15px] font-bold tracking-tight">ردیاب تورم شخصی بارگذاری نشد</h2>
      <p className="muted max-w-md text-[12px] leading-6">
        هیچ داده‌ای از بین نرفته است. این ماژول کاملاً مستقل است و هیچ اثری بر ثروت خالص، سبد دارایی یا
        سوابق مالی شما ندارد. لطفاً دوباره تلاش کنید.
      </p>
      <button onClick={reset} className="btn btn-primary">
        <Icon name="refresh" size={15} />
        تلاش دوباره
      </button>
    </div>
  );
}
