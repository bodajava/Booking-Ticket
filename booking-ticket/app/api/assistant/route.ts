import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { answerTravelQuestion } from "@/lib/assistant";

export const runtime = "nodejs";

/** An embedding call plus a chat completion does not fit in the default cap. */
export const maxDuration = 60;

const requestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional(),
});

export async function POST(request: Request) {
  // Every question costs an embedding call plus a completion, so this is
  // gated even though the chat model itself is free.
  const { userId } = await auth();

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await answerTravelQuestion(
      parsed.data.message,
      parsed.data.history ?? [],
    );
    return Response.json(result);
  } catch (error) {
    console.error("[assistant] failed", error);
    return Response.json(
      { error: "Assistant is unavailable right now" },
      { status: 502 },
    );
  }
}
