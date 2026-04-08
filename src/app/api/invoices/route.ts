import { NextRequest, NextResponse } from 'next/server';
import { supabase, type Invoice } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
  const classification = searchParams.get('classification');

  let query = supabase
    .from('invoices')
    .select('*')
    .eq('year', year)
    .eq('quarter', quarter);

  if (classification) {
    query = query.eq('classification', classification);
  }

  if (searchParams.get('unmatched') === 'true') {
    // Get matched invoice IDs first
    const { data: matched } = await supabase
      .from('transactions')
      .select('matched_invoice_id')
      .not('matched_invoice_id', 'is', null);

    const matchedIds = (matched || []).map(m => m.matched_invoice_id).filter(Boolean);
    if (matchedIds.length > 0) {
      query = query.not('id', 'in', `(${matchedIds.join(',')})`);
    }
  }

  const { data: invoices } = await query.order('invoice_date', { ascending: false }).returns<Invoice[]>();

  return NextResponse.json({ invoices: invoices || [], year, quarter });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const allowedFields = ['vendor', 'amount', 'vat_amount', 'vat_rate', 'invoice_date', 'invoice_number', 'description', 'category', 'classification'];
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      updateData[key] = value;
    }
  }

  if (Object.keys(updateData).length <= 1) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  await supabase.from('invoices').update(updateData).eq('id', id);

  // If classification changed, learn the pattern
  if (updates.classification && updates.classification !== 'unknown') {
    const { data: invoice } = await supabase.from('invoices').select('*').eq('id', id).single();
    if (invoice?.vendor) {
      await supabase.from('classification_rules').upsert({
        id: `rule_${invoice.vendor.toLowerCase().replace(/\s+/g, '_')}`,
        pattern: invoice.vendor,
        field: 'vendor',
        classification: updates.classification,
        category: updates.category || invoice.category,
      }, { onConflict: 'id' });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('transactions').update({ matched_invoice_id: null }).eq('matched_invoice_id', id);
  await supabase.from('invoices').delete().eq('id', id);
  return NextResponse.json({ success: true });
}
