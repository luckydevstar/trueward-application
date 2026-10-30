import { NextResponse } from "next/server";

import { askAssistant, type AssistantTodo } from "@/lib/assistant";
import { ADMINS_ONLY } from "@/lib/clock";
import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { isAdminRole } from "@/lib/roles";
import { requestActor } from "@/lib/supabase/request";

export const maxDuration = 60;

/**
 * The desktop clock's assistant (trueward-clock). Signs in through
 * /api/clock/login, then a bearer token; outside the device gate, so for
 * admins only (src/lib/clock.ts). The todos come from the desktop; the rest
 * is read as the person, so the model sees only what they could.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  if (!isAdminRole(ctx.actor.role)) return fail(ADMINS_ONLY, 403);
  const input = await body<{
    question?: string;
    history?: Array<{ question?: unknown; answer?: unknown }>;
    todos?: AssistantTodo[];
    timeZone?: string;
    todayStart?: string;
  }>(request);
  if (typeof input?.question !== "string" || !input.question.trim()) return fail("Type a question first.");

  const result = await askAssistant(ctx.db, ctx.actor, {
    question: input.question,
    history: (Array.isArray(input.history) ? input.history : [])
      .filter((t) => typeof t?.question === "string" && typeof t?.answer === "string")
      .map((t) => ({ question: t.question as string, answer: t.answer as string })),
    todos: (Array.isArray(input.todos) ? input.todos : []).flatMap((t) =>
      typeof t?.text === "string"
        ? [
            {
              text: t.text,
              notes: typeof t.notes === "string" ? t.notes : null,
              due: typeof t.due === "string" ? t.due : null,
              date: typeof t.date === "string" ? t.date : null,
              repeat: typeof t.repeat === "string" ? t.repeat : null,
              alarm: t.alarm === true,
              done: t.done === true,
            },
          ]
        : [],
    ),
    timeZone: typeof input.timeZone === "string" ? input.timeZone : null,
    todayStart: typeof input.todayStart === "string" ? input.todayStart : null,
  });
  return result.ok ? NextResponse.json({ answer: result.answer, model: result.model }) : fail(result.error);
}
