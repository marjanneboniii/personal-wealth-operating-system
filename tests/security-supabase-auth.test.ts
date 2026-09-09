import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Supabase owns password and OAuth authentication", () => {
  const actions = read("src/lib/auth-actions.ts");
  const google = read("src/components/auth/GoogleAuthButton.tsx");
  assert.match(actions, /auth\.signUp\(/);
  assert.match(actions, /auth\.signInWithPassword\(/);
  assert.match(actions, /captchaToken/);
  assert.doesNotMatch(actions, /hashPassword\(/);
  assert.match(google, /signInWithOAuth/);
  assert.doesNotMatch(google, /accounts\.google\.com/);
});

test("server identity is signature validated and secrets stay server-only", () => {
  const auth = read("src/lib/auth.ts");
  const proxy = read("src/lib/supabase/proxy.ts");
  const browser = read("src/lib/supabase/client.ts");
  const admin = read("src/lib/supabase/admin.ts");
  assert.match(auth, /auth\.getUser\(/);
  assert.match(proxy, /auth\.getClaims\(/);
  assert.doesNotMatch(proxy, /auth\.getSession\(/);
  assert.match(browser, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(browser, /SUPABASE_SECRET_KEY/);
  assert.match(admin, /SUPABASE_SECRET_KEY/);
  assert.match(admin, /persistSession: false/);
});

test("RLS defaults closed and binds financial rows to auth.uid()", () => {
  const sql = read("drizzle/0017_supabase_auth_rls.sql");
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.doesNotMatch(sql, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.match(sql, /DROP TABLE IF EXISTS public\.sessions/);
  assert.match(sql, /UPDATE public\.users SET pin_hash = NULL, password_hash = NULL, google_id = NULL/);
  assert.doesNotMatch(sql, /'institutions','assets'/);
  assert.match(sql, /'user'/);
  assert.doesNotMatch(sql, /raw_user_meta_data\s*->>\s*'role'/);
});

test("Supabase privileged helpers and advisor findings stay hardened", () => {
  const definerAcl = read("drizzle/0018_supabase_definer_acl.sql");
  const advisor = read("drizzle/0019_supabase_advisor_hardening.sql");

  assert.match(definerAcl, /REVOKE ALL ON FUNCTION public\.sync_auth_user_profile\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(definerAcl, /REVOKE ALL ON FUNCTION public\.rls_auto_enable\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(advisor, /vehicle_valuation_snapshots_immutable\(\) SET search_path = ''/);
  assert.match(advisor, /DROP POLICY IF EXISTS tenant_insert ON public\.audit_log/);
  assert.match(advisor, /CREATE POLICY expense_categories_select/);
  assert.match(advisor, /index_record\.indkey\[0\] = constraint_record\.conkey\[1\]/);
});

test("public signup cannot assign owner and admin protects owner accounts", () => {
  const actions = read("src/lib/auth-actions.ts");
  const callback = read("src/app/auth/callback/route.ts");
  const admin = read("src/app/admin/actions.ts");
  assert.match(actions, /role: DEFAULT_SELF_REGISTERED_ROLE/);
  assert.match(callback, /email_confirmed_at \? "owner" : "user"/);
  assert.match(admin, /targetId === actor\.id/);
  assert.match(admin, /targetProfile\.role === "owner"/);
  assert.match(admin, /actor\.role !== "owner"/);
});

test("legacy custom Google endpoint is retired", () => {
  const route = read("src/app/api/auth/google/route.ts");
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /tokeninfo|GOOGLE_CLIENT_ID/);
});
