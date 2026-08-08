import { Skeleton } from "@/components/ui/Card";

export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="در حال بارگذاری تراکنش‌ها">
      <div className="space-y-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-72" />
      </div>
      <Skeleton className="h-11 w-full rounded-[var(--r-lg)]" />
      <div className="card divide-y overflow-hidden">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-8 w-14" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-2.5 w-56" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
