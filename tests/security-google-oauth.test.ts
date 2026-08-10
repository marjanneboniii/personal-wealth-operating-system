import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { POST as googleAuthApi } from "../src/app/api/auth/google/route";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { users, sessions } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { createSession } from "../src/lib/auth";

const originalFetch = global.fetch;

function setupMockFetch(mockHandler: (url: string) => Record<string, unknown> | null) {
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const result = mockHandler(url);
      if (!result) {
        return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
      }
      return new Response(JSON.stringify(result), { status: 200 });
    }
    return originalFetch(input, init);
  };
}

afterEach(() => {
  global.fetch = originalFetch;
});

async function cleanDb() {
  await createSchemaIfNotExists();
  await db.delete(sessions);
  await db.delete(users);
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
}

test("Section 19 — Google OAuth Test 1: Valid Token -> Login Success", async () => {
  await cleanDb();
  setupMockFetch(() => ({
    aud: "test-google-client-id",
    iss: "https://accounts.google.com",
    sub: "google-sub-123",
    email: "user1@gmail.com",
    email_verified: "true",
    name: "Valid User",
  }));

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "valid-jwt-token" }),
  });

  const res = await googleAuthApi(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);

  const [u] = await db.select().from(users).where(eq(users.googleId as any, "google-sub-123"));
  assert.ok(u);
  assert.equal(u.email, "user1@gmail.com");
});

test("Section 19 — Google OAuth Test 2: Fake Token -> 401", async () => {
  await cleanDb();
  setupMockFetch(() => null); // Simulate Google returning 401 invalid token

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "fake-jwt-token" }),
  });

  const res = await googleAuthApi(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.ok, false);
});

test("Section 19 — Google OAuth Test 3: Wrong aud -> Reject (401)", async () => {
  await cleanDb();
  setupMockFetch(() => ({
    aud: "wrong-client-id-aud",
    iss: "https://accounts.google.com",
    sub: "google-sub-456",
    email: "user2@gmail.com",
    email_verified: "true",
  }));

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "jwt-wrong-aud" }),
  });

  const res = await googleAuthApi(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /توکن برای این اپ نیست/);
});

test("Section 19 — Google OAuth Test 4: Wrong iss -> Reject (401)", async () => {
  await cleanDb();
  setupMockFetch(() => ({
    aud: "test-google-client-id",
    iss: "https://attacker-issuer.com",
    sub: "google-sub-789",
    email: "user3@gmail.com",
    email_verified: "true",
  }));

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "jwt-wrong-iss" }),
  });

  const res = await googleAuthApi(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /صادرکننده توکن Google نامعتبر است/);
});

test("Section 19 — Google OAuth Test 5: Email verification invalid -> Reject (401)", async () => {
  await cleanDb();
  setupMockFetch(() => ({
    aud: "test-google-client-id",
    iss: "https://accounts.google.com",
    sub: "google-sub-999",
    email: "unverified@gmail.com",
    email_verified: "false",
  }));

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "jwt-unverified-email" }),
  });

  const res = await googleAuthApi(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /ایمیل Google تأیید نشده است/);
});

test("Section 19 — Google OAuth Test 6: Without Google Configuration -> No Demo Mode -> Reject / Disabled (503)", async () => {
  await cleanDb();
  delete process.env.GOOGLE_CLIENT_ID;

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "jwt-token-no-config" }),
  });

  const res = await googleAuthApi(req);
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /Google authentication is not configured/);
});

test("Section 3 — Google OAuth: Account Takeover prevention (unauthenticated cannot claim existing email)", async () => {
  await cleanDb();
  setupMockFetch(() => ({
    aud: "test-google-client-id",
    iss: "https://accounts.google.com",
    sub: "attacker-google-id",
    email: "victim@gmail.com",
    email_verified: "true",
  }));

  // Existing target user with email victim@gmail.com
  const [target] = await db
    .insert(users)
    .values({ name: "Victim", username: "victim1", email: "victim@gmail.com", role: "owner" } as any)
    .returning();

  // Attacker tries to log in with Google using victim's email WITHOUT being logged in as victim
  const reqUnauth = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "attacker-id-token" }),
  });

  const resUnauth = await googleAuthApi(reqUnauth);
  assert.equal(resUnauth.status, 409);
  const jsonUnauth = await resUnauth.json();
  assert.equal(jsonUnauth.ok, false);

  // Verify target user's googleId is still null
  const [checkTarget] = await db.select().from(users).where(eq(users.id, target.id));
  assert.equal(checkTarget.googleId, null);

  // Now legitimate user links while authenticated
  const { token } = await createSession(target.id);
  const reqAuth = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${token}` },
    body: JSON.stringify({ idToken: "attacker-id-token" }),
  });

  const resAuth = await googleAuthApi(reqAuth);
  assert.equal(resAuth.status, 200);
  const jsonAuth = await resAuth.json();
  assert.equal(jsonAuth.ok, true);

  const [checkTargetLinked] = await db.select().from(users).where(eq(users.id, target.id));
  assert.equal(checkTargetLinked.googleId, "attacker-google-id");
});
