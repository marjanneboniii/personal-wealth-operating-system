"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Scoped error boundary for one CARD inside a page.
 *
 * `src/app/error.tsx` catches anything that escapes a route and replaces the
 * whole screen with «مشکلی در نمایش این صفحه پیش آمد» — correct as a last
 * resort, but a single broken widget should not take «خودرو», «کالا» and the
 * rest of the workspace down with it. Wrap a section in this boundary and only
 * that section degrades, with the same reassurance the global page gives: the
 * ledger is untouched, nothing was changed.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; title?: string; description?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the diagnostic trail in the console; never surface a stack to the user.
    console.error("[pwos] section render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className="rounded-[var(--r-md)] p-4 text-center"
        style={{ background: "var(--negative-soft)", color: "var(--negative)" }}
        role="alert"
      >
        <p className="text-[13px] font-semibold">{this.props.title ?? "نمایش این بخش ممکن نیست"}</p>
        <p className="muted mt-1 text-[11.5px] leading-6" style={{ color: "var(--text-2)" }}>
          {this.props.description ??
            "داده‌های مالی شما در دفترکل امن‌اند و این خطا هیچ تغییری در آن‌ها ایجاد نکرده است. بخش‌های دیگر صفحه همچنان کار می‌کنند."}
        </p>
        <button type="button" className="btn mt-3" onClick={() => this.setState({ failed: false })}>
          تلاش دوباره
        </button>
      </div>
    );
  }
}
