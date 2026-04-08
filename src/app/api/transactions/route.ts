import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
  const classification = searchParams.get('classification');
  const unmatched = searchParams.get('unmatched');

  let query = supabase
    .from('transactions')
    .select('*, invoices!transactions_matched_invoice_id_fkey(vendor, original_filename)')
    .eq('year', year)
    .eq('quarter', quarter);

  if (classification) {
    query = query.eq('classification', classification);
  }

  if (unmatched === 'true') {
    query = query.is('matched_invoice_id', null);
  }

  const { data } = await query.order('date', { ascending: false });

  const transactions = (data || []).map((row: Record<string, unknown>) => {
    const invoiceData = row.invoices as { vendor: string; original_filename: string } | null;
    return {
      ...row,
      invoices: undefined,
      matched_vendor: invoiceData?.vendor || null,
      matched_invoice_file: invoiceData?.original_filename || null,
    };
  });

  return NextResponse.json({ transactions, year, quarter });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const allowedFields = ['description', 'counterparty', 'classification', 'category', 'matched_invoice_id'];
  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      updateData[key] = value;
    }
  }

  if (Object.keys(updateData).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  await supabase.from('transactions').update(updateData).eq('id', id);

  // Learn classification rule
  if (updates.classification && updates.classification !== 'unknown') {
    const { data: tx } = await supabase.from('transactions').select('*').eq('id', id).single();
    if (tx?.counterparty) {
      await supabase.from('classification_rules').upsert({
        id: `rule_tx_${tx.counterparty.toLowerCase().replace(/\s+/g, '_')}`,
        pattern: tx.counterparty,
        field: 'counterparty',
        classification: updates.classification,
        category: updates.category || tx.category,
      }, { onConflict: 'id' });
    }
  }

  return NextResponse.json({ success: true });
}
