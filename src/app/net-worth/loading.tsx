import { Skeleton } from "@/components/ui/Card";

export default function Loading() {
  return (
    <div className="space-y-8" role="status" aria-label="در حال بارگذاری ارزش خالص">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="flex items-end justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-72 rounded-[10px]" />
          <Skeleton className="h-3 w-52" />
        </div>
        <Skeleton className="h-9 w-64 rounded-[var(--r-md)]" />
      </div>
      <Skeleton className="h-56 w-full rounded-[var(--r-lg)]" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-[var(--r-lg)]" />
        ))}
      </div>
    </div>
  );
}
