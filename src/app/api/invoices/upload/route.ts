import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import db, { getQuarterFromDate } from '@/lib/db';
import { extractInvoiceData } from '@/lib/extract';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll('files') as File[];

  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const results: Array<{ id: string; filename: string; status: string }> = [];

  for (const file of files) {
    const id = uuidv4();
    const ext = path.extname(file.name);
    const storedName = `${id}${ext}`;
    const filePath = path.join(uploadDir, storedName);

    // Write file to disk
    const bytes = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(bytes));

    // Insert into DB with pending status
    db.prepare(`
      INSERT INTO invoices (id, file_path, original_filename, extraction_status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, storedName, file.name);

    // Try to extract immediately
    try {
      db.prepare("UPDATE invoices SET extraction_status = 'processing' WHERE id = ?").run(id);
      const data = await extractInvoiceData(filePath);

      const dateStr = (data.invoice_date as string) || '';
      const qInfo = dateStr ? getQuarterFromDate(dateStr) : { quarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`, year: new Date().getFullYear() };

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

      results.push({ id, filename: file.name, status: 'extracted' });
    } catch (error) {
      db.prepare("UPDATE invoices SET extraction_status = 'failed' WHERE id = ?").run(id);
      results.push({ id, filename: file.name, status: 'failed: ' + (error as Error).message });
    }
  }

  return NextResponse.json({ results });
}
