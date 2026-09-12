import { z } from "zod";

import { countMatchingFlights } from "@/lib/home/home-data";

/** Live result count for the landing-page search button. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().regex(/^[A-Z]{3}$/).optional(),
  to: z.string().regex(/^[A-Z]{3}$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    date: url.searchParams.get("date") || undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "Invalid filter" }, { status: 400 });
  }

  const count = await countMatchingFlights({
    originCode: parsed.data.from,
    destinationCode: parsed.data.to,
    date: parsed.data.date,
  });

  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
