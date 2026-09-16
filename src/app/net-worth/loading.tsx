import { Skeleton } from "@/components/ui/Card";

/** Mirrors the page: header, the hero card (figure + range + curve), then the strips. */
export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="در حال بارگذاری ارزش خالص">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-80" />
      </div>

      <div className="card expense-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-64 rounded-[10px]" />
            <Skeleton className="h-3 w-52" />
          </div>
          <Skeleton className="h-9 w-64 rounded-[var(--r-md)]" />
        </div>
        <Skeleton className="h-52 w-full rounded-[var(--r-lg)]" />
      </div>

      <Skeleton className="h-24 w-full rounded-[var(--r-lg)]" />
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
    </div>
  );
}
