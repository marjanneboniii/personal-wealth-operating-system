import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, accounts } from "@/db/schema";
import { authenticateApi } from "@/lib/authGuard";
import {
  stripClientControlledFields,
  validateAccountOwnership,
  validateAmount,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

async function accountAsset(accountId: string): Promise<string> {
  const row = await db
    .select({ a: accounts.assetId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row[0]?.a) throw new Error("حساب انتخاب‌شده به هیچ دارایی متصل نیست");
  return row[0].a;
}

/**
 * Security-Hardened Transactions REST Endpoint with 100% IDOR Protection.
 * Only returns or modifies journal entries belonging to current authenticated user.
 */
export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    // Return all for user
    const list = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.userId, auth.user.id));
    return NextResponse.json({ ok: true, transactions: list });
  }

  const [je] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, auth.user.id)))
    .limit(1);

  if (!je) {
    return NextResponse.json({ ok: false, error: "سند یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, transaction: je });
}

export async function PUT(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "شناسه سند الزامی است." }, { status: 400 });
  }

  // IDOR Protection: Verify ownership before update
  const [je] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, auth.user.id)))
    .limit(1);

  if (!je) {
    return NextResponse.json({ ok: false, error: "سند یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  const body = await req.json();
  const [updated] = await db
    .update(journalEntries)
    .set({
      description: body.description ?? je.description,
      reference: body.reference ?? je.reference,
    })
    .where(eq(journalEntries.id, je.id))
    .returning();

  return NextResponse.json({ ok: true, transaction: updated });
}

export async function DELETE(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "شناسه سند الزامی است." }, { status: 400 });
  }

  // IDOR Protection: Verify ownership before delete/void
  const [je] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, auth.user.id)))
    .limit(1);

  if (!je) {
    return NextResponse.json({ ok: false, error: "سند یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  await db.delete(journalEntries).where(eq(journalEntries.id, je.id));

  return NextResponse.json({ ok: true, message: "سند با موفقیت حذف شد." });
}

export async function POST(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key") || body.idempotencyKey || undefined;

    // PART 29 & 30: Strip any client-controlled accounting metadata
    stripClientControlledFields(body);

    const { type, entryDate, description, primaryAccountId, counterAccountId, amount, quantity } = body;
    if (!type || !entryDate || !description || !primaryAccountId || !counterAccountId || (!amount && !quantity)) {
      return NextResponse.json({ ok: false, error: "اطلاعات تراکنش ناقص است." }, { status: 400 });
    }

    // PART 24 & 25: Finite positive amount validation (> 0)
    const validValue = validateAmount(amount || quantity, "مبلغ تراکنش");

    // PART 27 & 28: Ownership validation
    await validateAccountOwnership(primaryAccountId, auth.user.id);
    await validateAccountOwnership(counterAccountId, auth.user.id);

    const assetId = body.assetId || (await accountAsset(primaryAccountId));
    const { recordIncome, recordExpense, recordTransfer } = await import("@/features/ledger/service");
    let res: { id: string; idempotentReplay?: boolean };

    if (type === "income") {
      res = await recordIncome({
        entryDate,
        description,
        cashAccountId: primaryAccountId,
        categoryAccountId: counterAccountId,
        assetId,
        quantity: validValue,
        baseValue: validValue,
        userId: auth.user.id,
        idempotencyKey,
      });
    } else if (type === "expense") {
      res = await recordExpense({
        entryDate,
        description,
        cashAccountId: primaryAccountId,
        categoryAccountId: counterAccountId,
        assetId,
        quantity: validValue,
        baseValue: validValue,
        userId: auth.user.id,
        idempotencyKey,
      });
    } else if (type === "transfer") {
      res = await recordTransfer({
        entryDate,
        description,
        fromAccountId: primaryAccountId,
        toAccountId: counterAccountId,
        assetId,
        quantity: validValue,
        unitPrice: "1",
        userId: auth.user.id,
        idempotencyKey,
      });
    } else {
      return NextResponse.json({ ok: false, error: "نوع تراکنش در این وب‌سرویس پشتیبانی نمی‌شود." }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, id: res.id, idempotentReplay: Boolean(res.idempotentReplay) },
      { status: res.idempotentReplay ? 200 : 201 },
    );
  } catch (err: any) {
    const status = err.status || (err.code === "IDEMPOTENCY_CONFLICT" ? 409 : 500);
    return NextResponse.json(
      { ok: false, error: err.message || "خطا در ایجاد سند" },
      { status },
    );
  }
}
