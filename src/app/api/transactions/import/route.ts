import { NextRequest, NextResponse } from 'next/server';
import { parseCSV, importTransactions, type ParsedTransaction } from '@/lib/csv-import';
import { extractTransactionsFromDocument } from '@/lib/extract';
import { applyClassificationRules } from '@/lib/matching';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  let parsed: ParsedTransaction[];

  if (ext === 'pdf') {
    // Use Claude Vision to extract transactions from bank statement PDF
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = await extractTransactionsFromDocument(buffer, file.name);
  } else {
    // CSV: use Claude to detect columns, then parse
    const content = await file.text();
    parsed = await parseCSV(content);
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: 'Geen transacties gevonden in het bestand. Controleer het formaat.' }, { status: 400 });
  }

  const { imported, skipped } = await importTransactions(parsed);

  // Apply any existing classification rules
  await applyClassificationRules();

  const parts = [`${imported} transacties ge\u00EFmporteerd`];
  if (skipped > 0) parts.push(`${skipped} duplicaten overgeslagen`);

  return NextResponse.json({
    imported,
    skipped,
    total_parsed: parsed.length,
    message: parts.join(', '),
  });
}
