import { formatJalaliIso } from "@/lib/format";
import StaleBundleCheck from "@/components/settings/StaleBundleCheck";

/**
 * «نسخه» — the build this server runs. The client half compares it with the
 * build of the JavaScript actually running in the browser: an installed PWA
 * can keep serving an old bundle from its cache, and this is where that shows.
 */
export default function AppVersion() {
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT || "local";
  const builtAt = process.env.NEXT_PUBLIC_BUILD_TIME;
  return (
    <div className="expense-sub flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        نسخه <span className="num" dir="ltr">{commit === "local" ? "محلی" : commit}</span>
        {builtAt ? ` · ساخته‌شده ${formatJalaliIso(builtAt.slice(0, 10))}` : ""}
      </span>
      <StaleBundleCheck serverCommit={commit} />
    </div>
  );
}
