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

export async function scanInboxForInvoices(): Promise<{
  found: number;
  imported: number;
  errors: string[];
}> {
  const client = await getAuthenticatedClient();
  if (!client) return { found: 0, imported: 0, errors: ['Gmail niet verbonden'] };

  const gmail = google.gmail({ version: 'v1', auth: client });
  const errors: string[] = [];
  let found = 0;
  let imported = 0;

  const queries = [
    'has:attachment (subject:factuur OR subject:invoice OR subject:receipt OR subject:bon OR subject:bestelling OR subject:order OR subject:payment OR subject:betaling)',
    'has:attachment from:(noreply OR no-reply OR billing OR invoice OR factuur OR finance OR accounting)',
    'has:attachment filename:pdf (factuur OR invoice OR receipt)',
  ];

  const processedMessageIds = new Set<string>();

  // Get already-imported message IDs
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

  for (const query of queries) {
    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `${query} newer_than:90d`,
        maxResults: 50,
      });

      const messages = res.data.messages || [];
      found += messages.length;

      for (const msg of messages) {
        if (!msg.id || processedMessageIds.has(msg.id)) continue;
        processedMessageIds.add(msg.id);

        try {
          const result = await processGmailMessage(gmail, msg.id);
          if (result) imported += result;
        } catch (e) {
          errors.push(`Message ${msg.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      errors.push(`Query failed: ${(e as Error).message}`);
    }
  }

  await setSetting('gmail_last_scan', new Date().toISOString());

  return { found, imported, errors };
}

async function processGmailMessage(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string
): Promise<number> {
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
  });

  const parts = msg.data.payload?.parts || [];
  let importedCount = 0;

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

    // Insert into DB
    await supabase.from('invoices').insert({
      id,
      file_path: storedName,
      original_filename: filename,
      extraction_status: 'pending',
    });

    // Extract with Claude Vision
    try {
      await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', id);
      const data = await extractInvoiceData(fileBuffer, filename);

      (data as Record<string, unknown>).gmail_message_id = messageId;

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

      importedCount++;
    } catch {
      await supabase.from('invoices').update({ extraction_status: 'failed' }).eq('id', id);
    }
  }

  return importedCount;
}

export async function isGmailConnected(): Promise<boolean> {
  const connected = await getSetting('gmail_connected');
  const refreshToken = await getSetting('gmail_refresh_token');
  return connected === 'true' && !!refreshToken;
}
