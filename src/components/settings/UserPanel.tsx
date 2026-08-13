"use client";

import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { purgeClientCaches } from "@/lib/swClient";

type User = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  role: string;
};

export default function UserPanel({ user }: { user: User }) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // SECURITY (L-03): wipe any Service-Worker cached bytes so the next
      // user of this device never sees the previous tenant's data.
      await purgeClientCaches();
    }
    router.push("/");
    router.refresh();
  };

  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          {(user.username?.[0] || user.name?.[0] || "U").toUpperCase()}
        </span>
        <div>
          <p className="text-[13px] font-semibold">{user.name || user.username || "کاربر"}</p>
          <p className="muted num text-[11px]" dir="ltr">
            @{user.username || "—"} {user.email ? `· ${user.email}` : ""}
          </p>
          <span className="badge badge-brand mt-1 text-[10px]">{user.role === "owner" ? "مالک" : user.role}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <a href="/login" className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[12px]" style={{ touchAction: "manipulation" }}>
          <Icon name="settings" size={14} />
          تغییر حساب
        </a>
        <button
          type="button"
          onClick={handleLogout}
          className="btn !min-h-9 !px-3 !py-1.5 text-[12px]"
          style={{ touchAction: "manipulation" }}
        >
          <Icon name="x" size={14} />
          خروج
        </button>
      </div>
    </div>
  );
}
