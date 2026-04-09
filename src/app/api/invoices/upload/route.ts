import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabase, getQuarterFromDate } from '@/lib/db';
import { extractInvoiceData } from '@/lib/extract';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll('files') as File[];
  const replaceId = formData.get('replace_id') as string | null;

  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const results: Array<{ id: string; filename: string; status: string }> = [];

  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const fileBuffer = Buffer.from(bytes);

    // Duplicate check: hash the file content
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
    const { data: existingByHash } = await supabase
      .from('invoices')
      .select('id, vendor')
      .eq('file_hash', fileHash)
      .limit(1);

    if (existingByHash && existingByHash.length > 0) {
      results.push({ id: existingByHash[0].id, filename: file.name, status: `overgeslagen — duplicaat van ${existingByHash[0].vendor || file.name}` });
      continue;
    }

    // If replacing a needs_download placeholder, reuse its ID
    const id = replaceId || uuidv4();
    const ext = file.name.split('.').pop() || 'pdf';
    const storedName = `${id}.${ext}`;

    // Upload to Supabase Storage
    await supabase.storage
      .from('invoices')
      .upload(storedName, fileBuffer, { contentType: file.type || 'application/octet-stream' });

    if (replaceId) {
      // Update existing placeholder record
      await supabase.from('invoices').update({
        file_path: storedName,
        original_filename: file.name,
        extraction_status: 'pending',
        file_hash: fileHash,
      }).eq('id', replaceId);
    } else {
      // Insert new record
      await supabase.from('invoices').insert({
        id,
        file_path: storedName,
        original_filename: file.name,
        extraction_status: 'pending',
        file_hash: fileHash,
      });
    }

    // Try to extract immediately
    try {
      await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', id);
      const data = await extractInvoiceData(fileBuffer, file.name);

      const dateStr = (data.invoice_date as string) || '';
      const qInfo = dateStr ? getQuarterFromDate(dateStr) : { quarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`, year: new Date().getFullYear() };

      // Post-extraction duplicate check: same vendor + amount + date
      const vendor = data.vendor as string || null;
      const amount = data.amount as number || null;
      const invoiceDate = data.invoice_date as string || null;
      if (vendor && amount && invoiceDate) {
        const { data: existingByContent } = await supabase
          .from('invoices')
          .select('id')
          .eq('vendor', vendor)
          .eq('amount', amount)
          .eq('invoice_date', invoiceDate)
          .neq('id', id)
          .limit(1);

        if (existingByContent && existingByContent.length > 0) {
          // Remove the duplicate we just created
          await supabase.from('invoices').delete().eq('id', id);
          await supabase.storage.from('invoices').remove([storedName]);
          results.push({ id: existingByContent[0].id, filename: file.name, status: `overgeslagen — duplicaat (${vendor}, €${amount})` });
          continue;
        }
      }

      await supabase.from('invoices').update({
        vendor,
        amount,
        vat_amount: data.vat_amount as number || null,
        vat_rate: data.vat_rate as number || null,
        invoice_date: invoiceDate,
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
