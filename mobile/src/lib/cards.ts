/**
 * The QR code on an exam card holds  https://<site>/verify/<CODE>  (or just the code).
 * Accepts that, a pasted link, or the bare code; returns the upper-case code, or null if it is neither.
 * Same rule as the backend (services/invigilation.js) and the web app (lib/utils.ts).
 */
export function extractCode(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const fromUrl = s.match(/\/verify\/([A-Za-z0-9]{8,16})(?:[/?#].*)?$/);
  const code = (fromUrl ? fromUrl[1]! : s).toUpperCase();
  return /^[A-Z0-9]{8,16}$/.test(code) ? code : null;
}

/** What goes inside the QR on a student's exam card: a link to the public check page when the web address is known. */
export function cardQrValue(code: string, webUrl: string | undefined = process.env.EXPO_PUBLIC_WEB_URL): string {
  const base = webUrl?.trim().replace(/\/+$/, '');
  return base ? `${base}/verify/${code}` : code;
}
