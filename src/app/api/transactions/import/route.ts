import { NextRequest, NextResponse } from 'next/server';
import { parseCSV, importTransactions, type ParsedTransaction } from '@/lib/csv-import';
import { extractTransactionsFromDocument } from '@/lib/extract';
import { applyClassificationRules } from '@/lib/matching';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Geen bestand ontvangen' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    let parsed: ParsedTransaction[] = [];
    let diagnostic = '';

    try {
      if (ext === 'pdf') {
        // Use Claude Vision to extract transactions from bank statement PDF
        const buffer = Buffer.from(await file.arrayBuffer());
        parsed = await extractTransactionsFromDocument(buffer, file.name);
      } else if (ext === 'csv' || ext === 'txt') {
        const content = await file.text();
        const result = await parseCSV(content);
        parsed = result.transactions;
        diagnostic = result.diagnostic;
      } else {
        return NextResponse.json(
          { error: `Bestandstype ".${ext}" niet ondersteund. Upload een CSV, TXT of PDF.` },
          { status: 400 },
        );
      }
    } catch (parseError) {
      const msg = (parseError as Error).message || 'Onbekende fout tijdens parsen';
      console.error(`Parse error for ${file.name}:`, parseError);
      return NextResponse.json(
        { error: `Kon ${file.name} niet verwerken: ${msg}` },
        { status: 400 },
      );
    }

    if (parsed.length === 0) {
      const hint = diagnostic
        ? `Geen transacties herkend. ${diagnostic}`
        : ext === 'pdf'
          ? 'Geen transacties herkend in dit PDF. Is dit wel een bankafschrift met een transactielijst?'
          : 'Geen transacties herkend in dit CSV-bestand. Controleer het formaat.';
      return NextResponse.json({ error: hint }, { status: 400 });
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
  } catch (e) {
    // Last-resort catch so the frontend always gets a JSON response
    console.error('Import route unhandled error:', e);
    return NextResponse.json(
      { error: `Onverwachte fout: ${(e as Error).message || 'unknown'}` },
      { status: 500 },
    );
  }
}
