import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApi } from "@/lib/authGuard";
import { isTrustedMutation } from "@/lib/requestSecurity";
import { MAX_MESSAGE_CHARS, runChatTurn } from "@/features/assistant/chat";

export const dynamic = "force-dynamic";
// 60 s is valid on every Vercel plan, with or without Fluid compute (a higher
// value fails the deploy on Hobby without it). chat.ts keeps the whole turn,
// fallbacks included, inside 54 s.
export const maxDuration = 60;

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    conversationId: z.uuid().nullable().optional(),
    editMessageId: z.uuid().nullable().optional(),
  })
  .strict();

/**
 * دستیار هوشمند — one chat turn, streamed as newline-delimited JSON events
 * (see ChatEvent in features/assistant/chat.ts).
 *
 * Signed-in, same-origin only. The user id comes from the session — never
 * from the body — and the Gemini key never leaves the server.
 */
export async function POST(request: Request) {
  if (!isTrustedMutation(request)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است." }, { status: 403 });
  const auth = await authenticateApi(request);
  if (!auth.authenticated || !auth.user || auth.user.id === "admin-token") {
    return NextResponse.json({ ok: false, error: "برای گفتگو با دستیار وارد شوید." }, { status: 401 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: `پیام باید بین ۱ تا ${MAX_MESSAGE_CHARS.toLocaleString("fa-IR")} نویسه باشد.` }, { status: 400 });
  }

  const userId = auth.user.id;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runChatTurn({ userId, ...body, signal: request.signal })) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", code: "unknown", message: "ارتباط با دستیار قطع شد." }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
