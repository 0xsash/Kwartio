import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import db, { getQuarterFromDate, type Invoice } from '@/lib/db';
import { extractInvoiceData } from '@/lib/extract';

export async function POST(request: NextRequest) {
  const { id } = await request.json();

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Invoice | undefined;
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const filePath = path.join(process.cwd(), 'uploads', invoice.file_path);

  try {
    db.prepare("UPDATE invoices SET extraction_status = 'processing' WHERE id = ?").run(id);
    const data = await extractInvoiceData(filePath);

    const dateStr = (data.invoice_date as string) || '';
    const qInfo = dateStr
      ? getQuarterFromDate(dateStr)
      : { quarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`, year: new Date().getFullYear() };

    db.prepare(`
      UPDATE invoices SET
        vendor = ?, amount = ?, vat_amount = ?, vat_rate = ?,
        invoice_date = ?, invoice_number = ?, description = ?,
        category = ?, currency = ?, extracted_data = ?,
        extraction_status = 'done', quarter = ?, year = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.vendor as string || null,
      data.amount as number || null,
      data.vat_amount as number || null,
      data.vat_rate as number || null,
      data.invoice_date as string || null,
      data.invoice_number as string || null,
      data.description as string || null,
      data.category as string || null,
      data.currency as string || 'EUR',
      JSON.stringify(data),
      qInfo.quarter,
      qInfo.year,
      id
    );

    return NextResponse.json({ success: true, data });
  } catch (error) {
    db.prepare("UPDATE invoices SET extraction_status = 'failed' WHERE id = ?").run(id);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
