/** Neutral root loading — must not look like the private dashboard. */
export default function Loading() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3" aria-label="در حال بارگذاری" role="status">
      <div className="skeleton h-10 w-10 rounded-[10px]" />
      <div className="skeleton h-3 w-28" />
      <span className="sr-only">در حال بارگذاری…</span>
    </div>
  );
}
