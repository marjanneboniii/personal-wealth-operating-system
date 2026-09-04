/**
 * «همه دارایی‌ها» end-to-end render — the «ارزش‌گذاری دارایی‌ها» box.
 *
 * This renders the REAL `/assets` server component (no component re-implementations)
 * and reads the box back out of the HTML, which is exactly what the user asked for:
 *
 *   · USD and Toman are SPLIT — six figures, each with its own label
 *     (ارزش روز تومانی/دلاری، بهای تمام‌شده تومانی/دلاری،
 *      سود/زیان تحقق‌نیافته تومانی/دلاری), never one primary amount with a
 *      hidden second-currency equivalent glued to a label;
 *   · the figures come from the read model (a 2 ETH holding bought with dollars
 *     plus the remaining cash), so the box, the table and net worth cannot drift;
 *   · no «Fresh» chip anywhere in the markup, and the crypto row is named in
 *     Persian («اتریوم»).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { D } from "../src/domain/decimal";
import { formatMoney, formatSignedMoney } from "../src/lib/format";

let sessionToken: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && sessionToken ? { value: sessionToken } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  },
});

let db: any, createSchemaIfNotExists: any, schema: any, createSession: any;
let AssetsPage: any, renderToReadableStream: any, getPortfolioValuation: any;
let clearCoinGeckoPriceCache: any, postEntry: any, recordBuy: any;

const RATE = "100000";
const originalFetch = globalThis.fetch;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  schema = await import("../src/db/schema");
  ({ createSession } = await import("../src/lib/auth"));
  ({ getPortfolioValuation } = await import("../src/features/portfolio/service"));
  ({ clearCoinGeckoPriceCache } = await import("../src/features/pricing/service"));
  ({ postEntry, recordBuy } = await import("../src/features/ledger/service"));
  ({ default: AssetsPage } = await import("../src/app/assets/page"));
  ({ renderToReadableStream } = await import("react-dom/server"));
}
const modulesReady = loadModules();

async function resetDb() {
  await createSchemaIfNotExists();
  const { lotConsumptions, lots, entryFxSnapshots, postings, journalEntries, accounts, userFxSettings, assets, assetClasses, currencies, users, sessions } = schema;
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(userFxSettings);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(sessions);
  await db.delete(users);
}

/**
 * 20 000 USD cash → buy 2 ETH at 3 000 USD (cost 6 000 USD). ETH is then
 * priced at 4 000 USD by the mocked quote: value 8 000 USD = 800 000 000 IRT,
 * unrealized +2 000 USD = +200 000 000 IRT. Cash left: 14 000 USD.
 */
async function setupEthBook() {
  await resetDb();
  const { accounts, assetClasses, assets, currencies, entryFxSnapshots, userFxSettings, users } = schema;
  const [user] = await db.insert(users).values({ name: "Assets Render", username: "assets-render" }).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: RATE });
  const [usd] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$" }).returning();
  const [cashClass] = await db.insert(assetClasses).values({ code: "cash", name: "Cash" }).returning();
  const [cryptoClass] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto" }).returning();
  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "دلار آمریکا", classId: cashClass.id, currencyId: usd.id, decimals: 2, pricingMethod: "face_value" })
    .returning();
  const [eth] = await db
    .insert(assets)
    .values({
      symbol: "ETH",
      name: "اتریوم",
      classId: cryptoClass.id,
      decimals: 8,
      pricingMethod: "coingecko",
      priceSource: "coingecko",
      coingeckoId: "ethereum",
    })
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "1010", name: "نقدی", type: "asset", assetId: usdAsset.id })
    .returning();
  const [wallet] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "1200", name: "کیف پول اتریوم", type: "asset", assetId: eth.id })
    .returning();
  const [equity] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "3010", name: "سرمایه", type: "equity", assetId: usdAsset.id })
    .returning();

  await postEntry({
    userId: user.id,
    entryDate: "2026-08-01",
    type: "opening",
    description: "Opening cash",
    postings: [
      { accountId: cash.id, assetId: usdAsset.id, quantity: "20000", baseValue: "20000" },
      { accountId: equity.id, assetId: usdAsset.id, quantity: "-20000", baseValue: "-20000" },
    ],
  });
  const buy = await recordBuy({
    userId: user.id,
    entryDate: "2026-08-02",
    description: "Buy 2 ETH",
    assetAccountId: wallet.id,
    cashAccountId: cash.id,
    assetId: eth.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });
  await db.insert(entryFxSnapshots).values({
    entryId: buy.id,
    irtAmount: D("6000").mul(RATE).toString(),
    usdAmount: "6000",
    fxRate: RATE,
    rateSource: "test",
    rateDate: "2026-08-02",
  });

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ethereum: { usd: 4000, last_updated_at: 1_786_406_400 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  sessionToken = (await createSession(user.id)).token;
  return { user, eth };
}

async function renderAssetsPage(): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(AssetsPage, {}), {
    onError(error: unknown) {
      errors.push(error);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(
    errors.map((e) => String((e as Error)?.message ?? e)),
    [],
    "the assets page must render without server errors",
  );
  return html;
}

function valuationBox(html: string): string {
  const start = html.indexOf("ارزش‌گذاری دارایی‌ها");
  assert.ok(start >= 0, "the page must render the «ارزش‌گذاری دارایی‌ها» box");
  const rest = html.slice(start);
  const end = rest.indexOf("خانواده");
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
}

test("the assets view splits every valuation figure into Toman and USD", async () => {
  await modulesReady;
  try {
    const { user, eth } = await setupEthBook();

    const valuation = await getPortfolioValuation(undefined, user.id);
    const ethRow = valuation.assetValuations.find((r: any) => r.assetId === eth.id)!;
    // Anchor the fixture: if these drift, the split figures below mean nothing.
    assert.equal(ethRow.currentValue, "8000");
    assert.equal(ethRow.currentValueToman, D("8000").mul(RATE).toString());
    assert.equal(ethRow.costBasis, "6000");
    assert.equal(ethRow.unrealizedPnl, "2000");

    // Expected box figures — summed here in the test, independently of the
    // component helper, from the rows the read model returns.
    const sum = (pick: (row: any) => string | null) =>
      (valuation.assetValuations as any[]).reduce((acc: any, row: any) => acc.add(D(pick(row) ?? "0")), D("0"));
    const valueToman = sum((r: any) => r.currentValueToman);
    const valueUsd = sum((r: any) => r.currentValue);
    const costToman = sum((r: any) => r.costBasisToman ?? r.currentValueToman);
    const costUsd = sum((r: any) => r.costBasis);
    const pnlToman = sum((r) => r.unrealizedPnlToman);
    const pnlUsd = sum((r: any) => r.unrealizedPnl);

    const box = valuationBox(await renderAssetsPage());

    for (const label of [
      "ارزش روز تومانی",
      "ارزش روز دلاری",
      "بهای تمام‌شده تومانی",
      "بهای تمام‌شده دلاری",
      "سود/زیان تحقق‌نیافته تومانی",
      "سود/زیان تحقق‌نیافته دلاری",
    ]) {
      assert.ok(box.includes(label), `the box must label each figure separately: missing ${label}`);
    }

    const amounts = {
      valueToman: formatMoney(valueToman.toFixed(0), "IRT"),
      valueUsd: formatMoney(valueUsd.toString(), "USD"),
      costToman: formatMoney(costToman.toFixed(0), "IRT"),
      costUsd: formatMoney(costUsd.toString(), "USD"),
      pnlToman: formatSignedMoney(pnlToman.toFixed(0), "IRT"),
      pnlUsd: formatSignedMoney(pnlUsd.toString(), "USD"),
    };

    // One currency per line — and the line is the ONLY thing that carries it:
    // «ارزش روز تومانی» shows a Toman amount, «ارزش روز دلاری» a dollar one.
    const lineOf = (label: string) => {
      const at = box.indexOf(label);
      assert.ok(at >= 0, `missing label ${label}`);
      const end = box.indexOf("</div>", at);
      return box.slice(at, end > 0 ? end : at + 300);
    };
    const pairs: [string, string, string][] = [
      ["ارزش روز تومانی", amounts.valueToman, amounts.valueUsd],
      ["ارزش روز دلاری", amounts.valueUsd, amounts.valueToman],
      ["بهای تمام‌شده تومانی", amounts.costToman, amounts.costUsd],
      ["بهای تمام‌شده دلاری", amounts.costUsd, amounts.costToman],
      ["سود/زیان تحقق‌نیافته تومانی", amounts.pnlToman, amounts.pnlUsd],
      ["سود/زیان تحقق‌نیافته دلاری", amounts.pnlUsd, amounts.pnlToman],
    ];
    for (const [label, mine, other] of pairs) {
      const line = lineOf(label);
      assert.ok(line.includes(mine), `${label} must show ${mine.replace(/\u00a0/g, " ")}, got: ${line}`);
      assert.ok(!line.includes(other), `${label} must not carry the other currency's figure`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    clearCoinGeckoPriceCache();
    sessionToken = null;
  }
});

test("the assets view carries no «Fresh» chip and names the asset in Persian", async () => {
  await modulesReady;
  try {
    await setupEthBook();
    const html = await renderAssetsPage();
    const text = html.replace(/<[^>]*>/g, " ");

    // The Latin freshness chip — and the way it glued onto the basis chip to
    // read as one word — is gone; the basis chips themselves are Persian and
    // legitimate («مبنای تومان» / «مبنای دلار»).
    for (const banned of ["Fresh", "Stale", "Unavailable", "مبنای دلارFresh", "مبنای تومانFresh"]) {
      assert.ok(!text.includes(banned), `«${banned}» must not reach the screen any more`);
    }
    assert.ok(text.includes("اتریوم"), "the ETH row is named in Persian");
  } finally {
    globalThis.fetch = originalFetch;
    clearCoinGeckoPriceCache();
    sessionToken = null;
  }
});
