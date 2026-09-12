import { z } from "zod";

import { getAvailabilitySnapshot } from "@/lib/seat-availability";

/**
 * A one-shot authoritative snapshot.
 *
 * The live stream is the normal path; this exists for the moments a stream
 * cannot cover: the tab coming back to the foreground, and the polling
 * fallback a client drops into when SSE cannot be established at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const flightIdSchema = z.uuid();

export async function GET(
  _request: Request,
  context: RouteContext<"/api/flights/[flightId]/availability">,
) {
  const { flightId } = await context.params;

  if (!flightIdSchema.safeParse(flightId).success) {
    return new Response("Invalid flight id", { status: 400 });
  }

  return Response.json(await getAvailabilitySnapshot(flightId), {
    headers: { "Cache-Control": "no-store" },
  });
}
