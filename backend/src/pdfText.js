// Text layer of a PDF. Uses `unpdf` (pdf.js packaged for servers). It is imported lazily so the API still starts
// if the package is missing, and a PDF that cannot be read simply goes to a person for review.
//
// Scanned statements (a photo inside a PDF) have no text layer: they come back empty and are reviewed by staff.
export async function extractPdfText(buffer) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  if (pdf.numPages > 30) throw new Error('PDF has too many pages to be a fee statement.');
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === 'string' ? text : String(text ?? '');
}
