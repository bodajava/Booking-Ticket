import { getDefaultAppOrigin } from "@/lib/app-origin";
import { qrPng, verificationUrl } from "@/lib/qr";
import { isWellFormedToken } from "@/lib/verification";

/**
 * The boarding-pass QR code as a PNG.
 *
 * This exists for email. Gmail and Outlook both strip `data:` image sources,
 * so a QR code inlined as a data URI is simply invisible in the clients most
 * travellers use — it has to be a real URL the mail client can fetch.
 *
 * Public, like the page it points at: a mail client fetching an image carries
 * no session. It deliberately renders from the token alone and never touches
 * the database, so an unknown token costs a QR render and nothing more — it
 * cannot be used to probe which bookings exist, because every well-formed
 * token returns an image whether or not it resolves.
 */
export const runtime = "nodejs";

const SIZE = 480;

export async function GET(
  _request: Request,
  context: RouteContext<"/api/boarding-pass/[token]/qr">,
) {
  const { token } = await context.params;

  if (!isWellFormedToken(token)) {
    return new Response("Not found", { status: 404 });
  }

  const origin = getDefaultAppOrigin();
  if (!origin) {
    return new Response("App origin is not configured", { status: 500 });
  }

  const png = await qrPng(verificationUrl(origin, token), SIZE);

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // The code for a token never changes, and an email may be opened years
      // later. Immutable so mail proxies cache it rather than re-rendering.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(png.byteLength),
    },
  });
}
