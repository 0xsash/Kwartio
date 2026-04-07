import { NextRequest, NextResponse } from 'next/server';
import db, { type Transaction } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
  const classification = searchParams.get('classification');
  const unmatched = searchParams.get('unmatched');

  let query = 'SELECT t.*, i.vendor as matched_vendor, i.original_filename as matched_invoice_file FROM transactions t LEFT JOIN invoices i ON t.matched_invoice_id = i.id WHERE t.year = ? AND t.quarter = ?';
  const params: unknown[] = [year, quarter];

  if (classification) {
    query += ' AND t.classification = ?';
    params.push(classification);
  }

  if (unmatched === 'true') {
    query += ' AND t.matched_invoice_id IS NULL';
  }

  query += ' ORDER BY t.date DESC';

  const transactions = db.prepare(query).all(...params);
  return NextResponse.json({ transactions, year, quarter });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const allowedFields = ['description', 'counterparty', 'classification', 'category', 'matched_invoice_id'];
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  values.push(id);

  db.prepare(`UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  // Learn classification rule
  if (updates.classification && updates.classification !== 'unknown') {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Transaction;
    if (tx?.counterparty) {
      db.prepare(
        'INSERT OR REPLACE INTO classification_rules (id, pattern, field, classification, category) VALUES (?, ?, ?, ?, ?)'
      ).run(`rule_tx_${tx.counterparty.toLowerCase().replace(/\s+/g, '_')}`, tx.counterparty, 'counterparty', updates.classification, updates.category || tx.category);
    }
  }

  return NextResponse.json({ success: true });
}
