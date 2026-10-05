export interface CustomerQuotePdf {
  reference: string;
  versionNo: number;
  currency: string;
  vehicle: unknown;
  items: Array<{
    label: string;
    quantity: number;
    unitAmountMinor: string;
    lineTotalMinor: string;
  }>;
  totalMinor: string;
  validUntil: Date | string | null;
  terms: string | null;
  customerNotes: string | null;
}

function printable(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');
}

function pdfString(value: unknown): string {
  return `(${printable(value)})`;
}

export function renderCustomerQuotePdf(quote: CustomerQuotePdf): Buffer {
  const vehicle = printable(quote.vehicle);
  const lines = [
    'GreenWay Motors',
    `Quotation ${quote.reference} - Version ${quote.versionNo}`,
    `Currency: ${quote.currency}`,
    `Vehicle: ${vehicle}`,
    `Valid until: ${quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : 'N/A'}`,
    '',
    'Customer items:'
  ];
  for (const item of quote.items) {
    lines.push(`${item.label} | Qty ${item.quantity} | ${item.lineTotalMinor} ${quote.currency}`);
  }
  lines.push('', `Total: ${quote.totalMinor} ${quote.currency}`);
  if (quote.terms) lines.push('', `Terms: ${quote.terms}`);
  if (quote.customerNotes) lines.push('', `Notes: ${quote.customerNotes}`);

  const wrapped = lines.flatMap((line) => wrapLine(line, 88));
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += 54)
    pages.push(wrapped.slice(index, index + 54));
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  for (const [index, page] of pages.entries()) {
    const commands = ['BT', '/F1 10 Tf', '50 790 Td', '14 TL'];
    page.forEach((line, lineIndex) => {
      if (lineIndex > 0) commands.push('T*');
      commands.push(`${pdfString(line)} Tj`);
    });
    commands.push('ET');
    const content = commands.join('\n');
    const pageId = pageIds[index]!;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
    );
  }
  let document = '%PDF-1.4\n%GreenWay\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}

function wrapLine(line: string, maxLength: number): string[] {
  if (!line) return [''];
  const words = line.split(/\s+/);
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxLength) {
      if (current) result.push(current);
      for (let offset = 0; offset < word.length; offset += maxLength)
        result.push(word.slice(offset, offset + maxLength));
      current = '';
    } else if (!current) current = word;
    else if (current.length + word.length + 1 <= maxLength) current += ` ${word}`;
    else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result;
}
