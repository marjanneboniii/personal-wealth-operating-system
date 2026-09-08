"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";

export default function GoogleAuthButton({ label = "ورود با Google" }: { label?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const start = async () => {
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setPending(false);
      setMessage("ورود با Google آغاز نشد؛ تنظیمات Supabase را بررسی کنید.");
    }
  };

  return (
    <div className="space-y-2" aria-live="polite">
      <button type="button" onClick={start} disabled={pending} className="btn w-full">
        <Icon name="globe" size={16} />
        {pending ? "در حال انتقال…" : label}
      </button>
      {message && <p className="text-center text-[11px]" style={{ color: "var(--negative)" }}>{message}</p>}
    </div>
  );
}
