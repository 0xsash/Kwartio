import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  // Invoice stats
  const { data: allInvoices } = await supabase
    .from('invoices')
    .select('classification, extraction_status, amount, vat_amount')
    .eq('year', year)
    .eq('quarter', quarter);

  const invoices = allInvoices || [];
  const invoiceStats = {
    total: invoices.length,
    professional: invoices.filter(i => i.classification === 'professional').length,
    personal: invoices.filter(i => i.classification === 'personal').length,
    unclassified: invoices.filter(i => i.classification === 'unknown').length,
    extracted: invoices.filter(i => i.extraction_status === 'done').length,
    failed: invoices.filter(i => i.extraction_status === 'failed').length,
    total_professional_amount: invoices.filter(i => i.classification === 'professional').reduce((s, i) => s + (i.amount || 0), 0),
    total_vat: invoices.filter(i => i.classification === 'professional').reduce((s, i) => s + (i.vat_amount || 0), 0),
  };

  // Transaction stats
  const { data: allTransactions } = await supabase
    .from('transactions')
    .select('classification, matched_invoice_id, amount')
    .eq('year', year)
    .eq('quarter', quarter);

  const txs = allTransactions || [];
  const txStats = {
    total: txs.length,
    professional: txs.filter(t => t.classification === 'professional').length,
    personal: txs.filter(t => t.classification === 'personal').length,
    unclassified: txs.filter(t => t.classification === 'unknown').length,
    matched: txs.filter(t => t.matched_invoice_id !== null).length,
    total_professional_amount: txs.filter(t => t.classification === 'professional').reduce((s, t) => s + Math.abs(t.amount || 0), 0),
  };

  return NextResponse.json({
    year,
    quarter,
    invoices: invoiceStats,
    transactions: txStats,
    readyForExport: invoiceStats.unclassified === 0 && txStats.unclassified === 0,
  });
}
