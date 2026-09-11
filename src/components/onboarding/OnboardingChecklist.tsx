"use client";

/**
 * The asset checklist (بخش ۲، بندهای ۱ و ۳).
 *
 * Every category is a card with a plain بله/خیر, and the page cannot be
 * finished while any card is unanswered. That constraint is the entire design:
 * a form lets a user scroll past their apartment, a checklist makes them say
 * «نه، ملک ندارم» out loud, and only the second one leaves something behind to
 * follow up on later.
 *
 * A «بله» does two things — it records the claim and it links straight into
 * that category's own registration flow, which is where «افزودن مورد دیگر»
 * already lives. This screen deliberately does not embed six different forms:
 * every category already has a working one, and duplicating them here would
 * mean two places to keep correct.
 *
 * The review section is the last gate before the checklist is considered done.
 * It shows the gap — said yes, registered nothing — and asks again, because
 * answering six questions is not the same as having entered everything.
 */
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { faCount } from "@/lib/format";
import {
  fetchChecklistAction,
  recordIntentAction,
  type ChecklistView,
} from "@/app/actions/onboarding";
import {
  ASSET_CATEGORIES,
  CATEGORY_META,
  type AssetCategory,
} from "@/features/onboarding/categories";

export default function OnboardingChecklist() {
  const router = useRouter();
  const [view, setView] = useState<ChecklistView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const load = useCallback(() => {
    fetchChecklistAction()
      .then((next) => {
        if (next.loginRequired) {
          router.replace("/login");
          return;
        }
        setView(next);
      })
      .catch(() => setError("وضعیت چک‌لیست خوانده نشد. صفحه را دوباره باز کنید."));
  }, [router]);

  useEffect(load, [load]);

  const answer = (category: AssetCategory, value: "yes" | "no") => {
    // Optimistic: the answer is the user's own claim, so echoing it back
    // immediately is honest. A failure re-reads the server's truth.
    setView((prev) =>
      prev ? { ...prev, answers: { ...prev.answers, [category]: value } } : prev,
    );
    startSaving(() => {
      recordIntentAction(category, value)
        .then((res) => {
          if (!res.ok) setError(res.message ?? "پاسخ ثبت نشد.");
          load();
        })
        .catch(() => {
          setError("پاسخ ثبت نشد. دوباره تلاش کنید.");
          load();
        });
    });
  };

  const answered = useMemo(
    () => ASSET_CATEGORIES.filter((c) => view?.answers[c] !== undefined).length,
    [view],
  );

  if (!view) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="card p-8 text-center">
          <p className="muted text-[length:var(--fs-sm)]" role="status">در حال بارگذاری…</p>
        </div>
      </div>
    );
  }

  const total = ASSET_CATEGORIES.length;

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <header className="space-y-2">
        <h1 className="text-[length:var(--fs-lg)] font-bold tracking-tight">
          چه دارایی‌هایی دارید؟
        </h1>
        <p className="muted text-[length:var(--fs-sm)] leading-7">
          به هر کارت پاسخ بله یا خیر بدهید. پاسخ «خیر» هم مهم است — بعداً بابت چیزی که ندارید
          سؤال نمی‌شود.
        </p>
        <p className="muted num text-[length:var(--fs-xs)]" dir="rtl">
          {faCount(answered)} از {faCount(total)} پاسخ داده شده
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="card p-3 text-[length:var(--fs-sm)]"
          style={{ borderColor: "var(--negative)", color: "var(--negative)" }}
        >
          {error}
        </div>
      )}

      <ul className="space-y-2.5">
        {ASSET_CATEGORIES.map((category) => {
          const meta = CATEGORY_META[category];
          const value = view.answers[category];
          const count = view.counts[category] ?? 0;
          return (
            <li key={category} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[length:var(--fs-sm)] font-semibold">{meta.question}</h2>
                  <p className="muted mt-1 text-[length:var(--fs-xs)] leading-6">{meta.hint}</p>
                </div>
                <div className="flex shrink-0 gap-2" role="group" aria-label={meta.question}>
                  <button
                    type="button"
                    disabled={saving}
                    aria-pressed={value === "yes"}
                    className={value === "yes" ? "btn btn-primary !min-h-10 !px-4" : "btn btn-ghost !min-h-10 !px-4"}
                    onClick={() => answer(category, "yes")}
                  >
                    بله
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    aria-pressed={value === "no"}
                    className={value === "no" ? "btn btn-primary !min-h-10 !px-4" : "btn btn-ghost !min-h-10 !px-4"}
                    onClick={() => answer(category, "no")}
                  >
                    خیر
                  </button>
                </div>
              </div>

              {value === "yes" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  <Link href={meta.href} className="btn btn-ghost !min-h-10 !px-3 text-[length:var(--fs-xs)]">
                    <Icon name="plus" size={15} />
                    {count > 0 ? `افزودن ${meta.label} دیگر` : `ثبت ${meta.label}`}
                  </Link>
                  <span
                    className="muted num text-[length:var(--fs-xs)]"
                    dir="rtl"
                    style={count === 0 ? { color: "var(--warning)" } : undefined}
                  >
                    {count > 0
                      ? `${faCount(count)} مورد ثبت شده`
                      : "هنوز چیزی ثبت نشده"}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Review gate — answering six questions is not the same as having
          entered everything, so the gap is named before anything is locked. */}
      <section className="card space-y-3 p-4">
        <h2 className="text-[length:var(--fs-sm)] font-semibold">مرور نهایی</h2>

        {!view.complete && (
          <p className="muted text-[length:var(--fs-xs)] leading-6">
            هنوز به {faCount(view.unanswered.length)} دسته پاسخ نداده‌اید:{" "}
            {view.unanswered.map((c) => CATEGORY_META[c].label).join("، ")}
          </p>
        )}

        {view.promisedButEmpty.length > 0 && (
          <div
            className="rounded-xl p-3 text-[length:var(--fs-xs)] leading-6"
            style={{ background: "var(--warning-soft, var(--sunken))", color: "var(--warning)" }}
          >
            گفتید این‌ها را دارید ولی هنوز ثبتشان نکرده‌اید:{" "}
            <strong>{view.promisedButEmpty.map((c) => CATEGORY_META[c].label).join("، ")}</strong>
            . تا وقتی ثبت نشوند در ارزش خالص شما حساب نمی‌شوند.
          </div>
        )}

        {view.complete && view.promisedButEmpty.length === 0 && (
          <p className="text-[length:var(--fs-xs)] leading-6" style={{ color: "var(--positive)" }}>
            به همهٔ دسته‌ها پاسخ داده‌اید و هرچه گفتید دارید ثبت شده است.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/" className="btn btn-primary !min-h-11">رفتن به نمای کلی</Link>
          <Link href="/accounts" className="btn btn-ghost !min-h-11">حساب‌ها و کیف پول‌ها</Link>
        </div>
      </section>
    </div>
  );
}
