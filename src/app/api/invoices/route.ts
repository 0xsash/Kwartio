import { NextRequest, NextResponse } from 'next/server';
import db, { type Invoice } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
  const classification = searchParams.get('classification');

  let query = 'SELECT * FROM invoices WHERE year = ? AND quarter = ?';
  const params: unknown[] = [year, quarter];

  if (classification) {
    query += ' AND classification = ?';
    params.push(classification);
  }

  query += ' ORDER BY invoice_date DESC';

  const invoices = db.prepare(query).all(...params) as Invoice[];
  return NextResponse.json({ invoices, year, quarter });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const allowedFields = ['vendor', 'amount', 'vat_amount', 'vat_rate', 'invoice_date', 'invoice_number', 'description', 'category', 'classification'];
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE invoices SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  // If classification changed, learn the pattern
  if (updates.classification && updates.classification !== 'unknown') {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Invoice;
    if (invoice?.vendor) {
      db.prepare(
        'INSERT OR REPLACE INTO classification_rules (id, pattern, field, classification, category) VALUES (?, ?, ?, ?, ?)'
      ).run(`rule_${invoice.vendor.toLowerCase().replace(/\s+/g, '_')}`, invoice.vendor, 'vendor', updates.classification, updates.category || invoice.category);
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  db.prepare('UPDATE transactions SET matched_invoice_id = NULL WHERE matched_invoice_id = ?').run(id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
