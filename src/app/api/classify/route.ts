import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// Get unclassified items for the swipe UI
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const invoices = db.prepare(
    "SELECT id, 'invoice' as type, vendor as name, description, amount, invoice_date as date, category FROM invoices WHERE year = ? AND quarter = ? AND classification = 'unknown' ORDER BY invoice_date"
  ).all(year, quarter);

  const transactions = db.prepare(
    "SELECT id, 'transaction' as type, counterparty as name, description, amount, date, category FROM transactions WHERE year = ? AND quarter = ? AND classification = 'unknown' ORDER BY date"
  ).all(year, quarter);

  const items = [...invoices, ...transactions];

  return NextResponse.json({ items, total: items.length });
}

// Batch classify
export async function POST(request: NextRequest) {
  const { classifications } = await request.json();

  if (!Array.isArray(classifications)) {
    return NextResponse.json({ error: 'Expected classifications array' }, { status: 400 });
  }

  const updateInvoice = db.prepare('UPDATE invoices SET classification = ?, category = COALESCE(?, category), updated_at = datetime(\'now\') WHERE id = ?');
  const updateTransaction = db.prepare('UPDATE transactions SET classification = ?, category = COALESCE(?, category) WHERE id = ?');
  const insertRule = db.prepare('INSERT OR REPLACE INTO classification_rules (id, pattern, field, classification, category) VALUES (?, ?, ?, ?, ?)');

  let updated = 0;

  const applyAll = db.transaction(() => {
    for (const item of classifications) {
      const { id, type, classification, category, name } = item;

      if (type === 'invoice') {
        updateInvoice.run(classification, category || null, id);
      } else {
        updateTransaction.run(classification, category || null, id);
      }

      // Learn the pattern
      if (name && classification !== 'unknown') {
        const field = type === 'invoice' ? 'vendor' : 'counterparty';
        const ruleId = `rule_${field}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        insertRule.run(ruleId, name, field, classification, category || null);
      }

      updated++;
    }
  });

  applyAll();

  return NextResponse.json({ updated });
}
