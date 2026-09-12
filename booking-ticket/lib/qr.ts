import QRCode from "qrcode";

/**
 * Boarding-pass QR codes.
 *
 * Two renderings, because the two places a pass appears have opposite
 * constraints. The web page gets inline SVG: no extra request, crisp at any
 * zoom, and it scales with the layout. Email gets a PNG served from a URL,
 * because Gmail and Outlook both refuse `data:` image sources — an inlined
 * data-URI QR code simply does not appear in the client that most travellers
 * read their confirmation in.
 *
 * Error correction is set to M. A boarding pass gets folded, screenshotted and
 * photographed off a cracked phone screen at an angle; L saves a few modules
 * and fails in exactly those conditions, while H would inflate the code for no
 * benefit at this payload size.
 */

const OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 2,
  // Bone on stage: the palette's own two values, so the code sits in the
  // design rather than punching a white hole through a dark card. The
  // contrast ratio is far beyond what a scanner needs.
  color: { dark: "#15110eff", light: "#ece6dcff" },
};

/** The URL a scanner is sent to. */
export function verificationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/verify/${token}`;
}

/** Inline SVG markup, for rendering directly into a page. */
export async function qrSvg(data: string, size: number): Promise<string> {
  return QRCode.toString(data, { ...OPTIONS, type: "svg", width: size });
}

/** PNG bytes, for the email's `<img src>`. */
export async function qrPng(data: string, size: number): Promise<Buffer> {
  return QRCode.toBuffer(data, { ...OPTIONS, type: "png", width: size });
}
