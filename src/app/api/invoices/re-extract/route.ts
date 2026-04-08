import { NextRequest, NextResponse } from 'next/server';
import { supabase, getQuarterFromDate, type Invoice } from '@/lib/db';
import { extractInvoiceData } from '@/lib/extract';

export async function POST(request: NextRequest) {
  const { id } = await request.json();

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single<Invoice>();

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  // Download file from Supabase Storage
  const { data: fileData } = await supabase.storage
    .from('invoices')
    .download(invoice.file_path);

  if (!fileData) return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });

  const fileBuffer = Buffer.from(await fileData.arrayBuffer());

  try {
    await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', id);
    const data = await extractInvoiceData(fileBuffer, invoice.original_filename);

    const dateStr = (data.invoice_date as string) || '';
    const qInfo = dateStr
      ? getQuarterFromDate(dateStr)
      : { quarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`, year: new Date().getFullYear() };

    await supabase.from('invoices').update({
      vendor: data.vendor as string || null,
      amount: data.amount as number || null,
      vat_amount: data.vat_amount as number || null,
      vat_rate: data.vat_rate as number || null,
      invoice_date: data.invoice_date as string || null,
      invoice_number: data.invoice_number as string || null,
      description: data.description as string || null,
      category: data.category as string || null,
      currency: data.currency as string || 'EUR',
      extracted_data: JSON.stringify(data),
      extraction_status: 'done',
      quarter: qInfo.quarter,
      year: qInfo.year,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    await supabase.from('invoices').update({ extraction_status: 'failed' }).eq('id', id);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
