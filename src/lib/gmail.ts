import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { supabase, getSetting, setSetting, getQuarterFromDate } from './db';
import { extractInvoiceData } from './extract';

async function getOAuth2Client() {
  const clientId = await getSetting('google_client_id');
  const clientSecret = await getSetting('google_client_secret');
  const appUrl = await getSetting('app_url');
  const redirectUri = appUrl
    ? `${appUrl}/api/auth/gmail/callback`
    : 'http://localhost:3000/api/auth/gmail/callback';

  if (!clientId || !clientSecret) return null;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getGmailAuthUrl(): Promise<string | null> {
  const client = await getOAuth2Client();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  });
}

export async function handleGmailCallback(code: string): Promise<boolean> {
  const client = await getOAuth2Client();
  if (!client) return false;

  const { tokens } = await client.getToken(code);
  if (tokens.refresh_token) {
    await setSetting('gmail_refresh_token', tokens.refresh_token);
  }
  if (tokens.access_token) {
    await setSetting('gmail_access_token', tokens.access_token);
  }
  if (tokens.expiry_date) {
    await setSetting('gmail_token_expiry', tokens.expiry_date.toString());
  }
  await setSetting('gmail_connected', 'true');
  return true;
}

async function getAuthenticatedClient() {
  const client = await getOAuth2Client();
  if (!client) return null;

  const refreshToken = await getSetting('gmail_refresh_token');
  const accessToken = await getSetting('gmail_access_token');
  if (!refreshToken) return null;

  client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken || undefined,
  });

  return client;
}

// Process a batch of items with limited concurrency
async function processBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }
  return results;
}

export async function scanInboxForInvoices(): Promise<{
  found: number;
  imported: number;
  errors: string[];
}> {
  const client = await getAuthenticatedClient();
  if (!client) return { found: 0, imported: 0, errors: ['Gmail niet verbonden'] };

  const gmail = google.gmail({ version: 'v1', auth: client });
  const errors: string[] = [];

  const queries = [
    'has:attachment (subject:factuur OR subject:invoice OR subject:facture OR subject:receipt OR subject:bon OR subject:bestelling OR subject:order OR subject:payment OR subject:betaling OR subject:paiement OR subject:creditnota OR subject:credit note OR subject:nota OR subject:afrekening OR subject:rekening)',
    'has:attachment from:(noreply OR no-reply OR billing OR invoice OR factuur OR facture OR finance OR accounting OR boekhouding OR comptabilite OR admin OR info OR support)',
    'has:attachment (filename:pdf OR filename:PDF) (factuur OR invoice OR facture OR receipt OR bon OR nota OR credit)',
  ];

  // Get already-imported message IDs
  const processedMessageIds = new Set<string>();
  const { data: existing } = await supabase
    .from('invoices')
    .select('extracted_data')
    .like('extracted_data', '%gmail_message_id%');

  for (const row of existing || []) {
    try {
      const data = JSON.parse(row.extracted_data || '{}');
      if (data.gmail_message_id) processedMessageIds.add(data.gmail_message_id);
    } catch { /* skip */ }
  }

  // Phase 1: Run all queries in parallel to collect unique message IDs
  const uniqueMessageIds = new Set<string>();
  const queryResults = await Promise.allSettled(
    queries.map(async (query) => {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `${query} newer_than:1y`,
        maxResults: 50,
      });
      return res.data.messages || [];
    }),
  );

  for (const result of queryResults) {
    if (result.status === 'fulfilled') {
      for (const msg of result.value) {
        if (msg.id && !processedMessageIds.has(msg.id)) {
          uniqueMessageIds.add(msg.id);
        }
      }
    } else {
      const errMsg = result.reason?.message || String(result.reason);
      if (errMsg.includes('401') || errMsg.includes('invalid_grant') || errMsg.includes('Token')) {
        return { found: 0, imported: 0, errors: ['Gmail authenticatie verlopen. Koppel Gmail opnieuw via Instellingen.'] };
      }
      errors.push(`Query failed: ${errMsg}`);
    }
  }

  const found = uniqueMessageIds.size;
  if (found === 0) {
    await setSetting('gmail_last_scan', new Date().toISOString());
    return { found: 0, imported: 0, errors };
  }

  // Phase 2: Fetch messages and save attachments in parallel batches (no Claude extraction yet)
  const messageIds = Array.from(uniqueMessageIds);
  let imported = 0;

  const importResults = await processBatch(messageIds, 5, async (msgId) => {
    try {
      const count = await saveGmailAttachments(gmail, msgId);
      return count;
    } catch (e) {
      errors.push(`Message ${msgId}: ${(e as Error).message}`);
      return 0;
    }
  });

  for (const count of importResults) {
    imported += count;
  }

  await setSetting('gmail_last_scan', new Date().toISOString());

  return { found, imported, errors };
}

// Save attachments from a Gmail message WITHOUT running Claude extraction
// Extraction happens separately via extractPendingInvoices()
async function saveGmailAttachments(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
): Promise<number> {
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From'],
  });

  // Check all parts (including nested) for attachments
  const parts = collectParts(msg.data.payload);
  let savedCount = 0;

  for (const part of parts) {
    const mimeType = part.mimeType || '';
    const filename = part.filename || '';

    if (!filename) continue;

    const ext = filename.toLowerCase().split('.').pop() || '';
    const isInvoiceFile = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext) ||
      mimeType === 'application/pdf' ||
      mimeType.startsWith('image/');

    if (!isInvoiceFile || !part.body?.attachmentId) continue;

    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: part.body.attachmentId,
    });

    if (!attachment.data.data) continue;

    const fileBuffer = Buffer.from(attachment.data.data, 'base64');

    // Skip tiny files (logos/signatures)
    if (fileBuffer.length < 5000) continue;

    const id = uuidv4();
    const storedName = `${id}.${ext}`;

    // Upload to Supabase Storage
    await supabase.storage
      .from('invoices')
      .upload(storedName, fileBuffer, { contentType: mimeType || 'application/octet-stream' });

    // Insert into DB with pending extraction status and gmail_message_id
    await supabase.from('invoices').insert({
      id,
      file_path: storedName,
      original_filename: filename,
      extraction_status: 'pending',
      extracted_data: JSON.stringify({ gmail_message_id: messageId }),
    });

    savedCount++;
  }

  return savedCount;
}

// Recursively collect all parts from a Gmail message payload
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectParts(payload: any): Array<{ mimeType?: string; filename?: string; body?: { attachmentId?: string } }> {
  if (!payload) return [];
  const result: Array<{ mimeType?: string; filename?: string; body?: { attachmentId?: string } }> = [];
  if (payload.filename) result.push(payload);
  if (payload.parts) {
    for (const part of payload.parts as Array<typeof payload>) {
      result.push(...collectParts(part));
    }
  }
  return result;
}

// Extract data from pending invoices (called separately)
export async function extractPendingInvoices(): Promise<{
  extracted: number;
  failed: number;
  remaining: number;
}> {
  const { data: pending } = await supabase
    .from('invoices')
    .select('id, file_path, original_filename, extracted_data')
    .eq('extraction_status', 'pending')
    .limit(10); // Process 10 at a time to stay within serverless timeout

  if (!pending || pending.length === 0) {
    return { extracted: 0, failed: 0, remaining: 0 };
  }

  let extracted = 0;
  let failed = 0;

  // Process extractions 3 at a time
  await processBatch(pending, 3, async (invoice) => {
    try {
      await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', invoice.id);

      // Download file from Supabase Storage
      const { data: fileData } = await supabase.storage
        .from('invoices')
        .download(invoice.file_path);

      if (!fileData) {
        await supabase.from('invoices').update({ extraction_status: 'failed' }).eq('id', invoice.id);
        failed++;
        return;
      }

      const fileBuffer = Buffer.from(await fileData.arrayBuffer());
      const data = await extractInvoiceData(fileBuffer, invoice.original_filename || invoice.file_path);

      // Preserve existing extracted_data fields (like gmail_message_id)
      let existingData: Record<string, unknown> = {};
      try { existingData = JSON.parse(invoice.extracted_data || '{}'); } catch { /* skip */ }
      const mergedData = { ...existingData, ...data };

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
        extracted_data: JSON.stringify(mergedData),
        extraction_status: 'done',
        quarter: qInfo.quarter,
        year: qInfo.year,
        updated_at: new Date().toISOString(),
      }).eq('id', invoice.id);

      extracted++;
    } catch {
      await supabase.from('invoices').update({ extraction_status: 'failed' }).eq('id', invoice.id);
      failed++;
    }
  });

  // Check how many remain
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_status', 'pending');

  return { extracted, failed, remaining: count || 0 };
}

export async function isGmailConnected(): Promise<boolean> {
  const connected = await getSetting('gmail_connected');
  const refreshToken = await getSetting('gmail_refresh_token');
  return connected === 'true' && !!refreshToken;
}
