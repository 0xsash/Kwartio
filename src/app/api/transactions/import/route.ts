import { NextRequest, NextResponse } from 'next/server';
import { parseCSV, importTransactions } from '@/lib/csv-import';
import { applyClassificationRules } from '@/lib/matching';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const bankFormat = formData.get('bank') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const content = await file.text();
  const parsed = parseCSV(content, bankFormat || undefined);

  if (parsed.length === 0) {
    return NextResponse.json({ error: 'No transactions found in file. Check the format.' }, { status: 400 });
  }

  const { imported, skipped } = importTransactions(parsed);

  // Apply any existing classification rules
  applyClassificationRules();

  const parts = [`${imported} transacties ge\u00EFmporteerd`];
  if (skipped > 0) parts.push(`${skipped} duplicaten overgeslagen`);

  return NextResponse.json({
    imported,
    skipped,
    total_parsed: parsed.length,
    message: parts.join(', '),
  });
}
