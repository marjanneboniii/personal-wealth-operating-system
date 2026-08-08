import { Skeleton } from "@/components/ui/Card";

/** Root loading — shell stays, content streams in progressively. */
export default function Loading() {
  return (
    <div className="space-y-8" aria-label="در حال بارگذاری" role="status">
      {/* Hero skeleton */}
      <div className="space-y-3 pt-1">
        <Skeleton className="h-3.5 w-28" />
        <div className="flex items-end gap-4">
          <Skeleton className="h-12 w-64 rounded-[10px]" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-3 w-48" />
        <div className="grid grid-cols-3 gap-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-44 w-full rounded-[var(--r-lg)]" />
      </div>
      {/* Rows skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-2.5 w-28" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <span className="sr-only">در حال بارگذاری اطلاعات مالی…</span>
    </div>
  );
}
