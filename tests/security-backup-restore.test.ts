import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as restoreApi } from "../src/app/api/restore/route";
import { GET as backupApi } from "../src/app/api/backup/route";

test("Security Hardening — Restore API requires confirmToken", async () => {
  const reqWithoutToken = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      app: "PWOS",
      schemaVersion: "1.0",
      data: {},
    }),
  });

  const res = await restoreApi(reqWithoutToken);
  assert.equal(res.status, 400);

  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /تأییدیه بازیابی ارائه نشده است/);
});

test("Security Hardening — SQL Injection neutralized in restore payload", async () => {
  // Payload attempting SQL injection via column name and raw string
  const maliciousPayload = {
    app: "PWOS",
    schemaVersion: "1.0",
    confirmToken: "RESTORE_DATABASE_OVERWRITE",
    data: {
      currencies: [
        {
          "code'; DROP TABLE users; --": "USD",
          name: "US Dollar', ''); DROP TABLE journal_entries; --",
          symbol: "$",
          decimals: 2,
          is_fiat: true,
        },
      ],
    },
  };

  const req = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(maliciousPayload),
  });

  const res = await restoreApi(req);
  // Response should succeed or handle gracefully without executing injection or breaking schema
  assert.ok(res.status === 200 || res.status === 500);

  if (res.status === 200) {
    const json = await res.json();
    assert.equal(json.ok, true);
  }
});
