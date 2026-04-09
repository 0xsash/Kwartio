import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabase, getQuarterFromDate } from '@/lib/db';
import { extractInvoiceData } from '@/lib/extract';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const transactionId = formData.get('transaction_id') as string;

  if (!file) {
    return NextResponse.json({ error: 'Geen bestand meegestuurd' }, { status: 400 });
  }
  if (!transactionId) {
    return NextResponse.json({ error: 'Geen transactie-ID meegestuurd' }, { status: 400 });
  }

  const id = uuidv4();
  const ext = file.name.split('.').pop() || 'pdf';
  const storedName = `${id}.${ext}`;

  const bytes = await file.arrayBuffer();
  const fileBuffer = Buffer.from(bytes);

  // Upload to Supabase Storage
  await supabase.storage
    .from('invoices')
    .upload(storedName, fileBuffer, { contentType: file.type || 'application/octet-stream' });

  // Insert invoice record
  await supabase.from('invoices').insert({
    id,
    file_path: storedName,
    original_filename: file.name,
    extraction_status: 'pending',
  });

  // Extract invoice data
  let extractionStatus = 'pending';
  try {
    await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', id);
    const data = await extractInvoiceData(fileBuffer, file.name);

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

    extractionStatus = 'done';
  } catch {
    await supabase.from('invoices').update({ extraction_status: 'failed' }).eq('id', id);
    extractionStatus = 'failed';
  }

  // Link the transaction to this invoice
  await supabase
    .from('transactions')
    .update({ matched_invoice_id: id })
    .eq('id', transactionId);

  return NextResponse.json({
    invoice_id: id,
    extraction_status: extractionStatus,
    message: extractionStatus === 'done'
      ? 'Factuur geüpload en gekoppeld'
      : 'Factuur geüpload en gekoppeld (extractie mislukt, je kan later opnieuw proberen)',
  });
}
