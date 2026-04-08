import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabase, getQuarterFromDate } from '@/lib/db';
import { extractInvoiceData } from '@/lib/extract';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll('files') as File[];

  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const results: Array<{ id: string; filename: string; status: string }> = [];

  for (const file of files) {
    const id = uuidv4();
    const ext = file.name.split('.').pop() || 'pdf';
    const storedName = `${id}.${ext}`;

    const bytes = await file.arrayBuffer();
    const fileBuffer = Buffer.from(bytes);

    // Upload to Supabase Storage
    await supabase.storage
      .from('invoices')
      .upload(storedName, fileBuffer, { contentType: file.type || 'application/octet-stream' });

    // Insert into DB with pending status
    await supabase.from('invoices').insert({
      id,
      file_path: storedName,
      original_filename: file.name,
      extraction_status: 'pending',
    });

    // Try to extract immediately
    try {
      await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', id);
      const data = await extractInvoiceData(fileBuffer, file.name);

      const dateStr = (data.invoice_date as string) || '';
      const qInfo = dateStr ? getQuarterFromDate(dateStr) : { quarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`, year: new Date().getFullYear() };

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

      results.push({ id, filename: file.name, status: 'extracted' });
    } catch (error) {
      await supabase.from('invoices').update({ extraction_status: 'failed' }).eq('id', id);
      results.push({ id, filename: file.name, status: 'failed: ' + (error as Error).message });
    }
  }

  return NextResponse.json({ results });
}
