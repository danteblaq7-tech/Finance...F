// Decide what an uploaded file REALLY is from its first bytes, never from the name or the Content-Type the client sent.
export function sniffFile(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  // Plain text / CSV: no NUL bytes and valid UTF-8.
  const head = buf.subarray(0, 4096);
  if (!head.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return { kind: 'text', mime: 'text/plain', ext: 'txt' };
    } catch { /* not UTF-8 */ }
  }
  return null;
}

/** A file name that is safe to store and show: no paths, no control characters, bounded length. */
export function safeFileName(name) {
  const base = String(name ?? 'statement').split(/[\\/]/).pop().replace(/[^\w.\- ()]+/g, '_').trim();
  return (base || 'statement').slice(0, 120);
}
