import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, vendor, description, amount, invoice_date, category, invoice_number, vat_amount, vat_rate, original_filename')
    .eq('year', year)
    .eq('quarter', quarter)
    .eq('classification', 'unknown')
    .order('invoice_date');

  const { data: transactions } = await supabase
    .from('transactions')
    .select('id, counterparty, description, amount, date, category, reference, account_number')
    .eq('year', year)
    .eq('quarter', quarter)
    .eq('classification', 'unknown')
    .order('date');

  const items = [
    ...(invoices || []).map(i => ({
      ...i,
      type: 'invoice',
      name: i.vendor,
      date: i.invoice_date,
      invoice_number: i.invoice_number,
      vat_amount: i.vat_amount,
      vat_rate: i.vat_rate,
      original_filename: i.original_filename,
      reference: null,
      account_number: null,
    })),
    ...(transactions || []).map(t => ({
      ...t,
      type: 'transaction',
      name: t.counterparty,
      reference: t.reference,
      account_number: t.account_number,
      invoice_number: null,
      vat_amount: null,
      vat_rate: null,
      original_filename: null,
    })),
  ];

  return NextResponse.json({ items, total: items.length });
}

export async function POST(request: NextRequest) {
  const { classifications } = await request.json();

  if (!Array.isArray(classifications)) {
    return NextResponse.json({ error: 'Expected classifications array' }, { status: 400 });
  }

  let updated = 0;

  for (const item of classifications) {
    const { id, type, classification, category, name } = item;

    if (type === 'invoice') {
      await supabase.from('invoices').update({
        classification,
        category: category || undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    } else {
      await supabase.from('transactions').update({
        classification,
        category: category || undefined,
      }).eq('id', id);
    }

    // Learn the pattern
    if (name && classification !== 'unknown') {
      const field = type === 'invoice' ? 'vendor' : 'counterparty';
      const ruleId = `rule_${field}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      await supabase.from('classification_rules').upsert({
        id: ruleId,
        pattern: name,
        field,
        classification,
        category: category || null,
      }, { onConflict: 'id' });
    }

    updated++;
  }

  return NextResponse.json({ updated });
}
