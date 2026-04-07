import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import db, { getSetting, setSetting, getQuarterFromDate } from './db';
import { extractInvoiceData } from './extract';

function getOAuth2Client() {
  const clientId = getSetting('google_client_id');
  const clientSecret = getSetting('google_client_secret');
  const redirectUri = getSetting('app_url')
    ? `${getSetting('app_url')}/api/auth/gmail/callback`
    : 'http://localhost:3000/api/auth/gmail/callback';

  if (!clientId || !clientSecret) return null;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGmailAuthUrl(): string | null {
  const client = getOAuth2Client();
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
  const client = getOAuth2Client();
  if (!client) return false;

  const { tokens } = await client.getToken(code);
  if (tokens.refresh_token) {
    setSetting('gmail_refresh_token', tokens.refresh_token);
  }
  if (tokens.access_token) {
    setSetting('gmail_access_token', tokens.access_token);
  }
  if (tokens.expiry_date) {
    setSetting('gmail_token_expiry', tokens.expiry_date.toString());
  }
  setSetting('gmail_connected', 'true');
  return true;
}

function getAuthenticatedClient() {
  const client = getOAuth2Client();
  if (!client) return null;

  const refreshToken = getSetting('gmail_refresh_token');
  const accessToken = getSetting('gmail_access_token');
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
  const client = getAuthenticatedClient();
  if (!client) return { found: 0, imported: 0, errors: ['Gmail niet verbonden'] };

  const gmail = google.gmail({ version: 'v1', auth: client });
  const errors: string[] = [];
  let found = 0;
  let imported = 0;

  // Search for invoice/receipt emails from the last 90 days
  const queries = [
    'has:attachment (subject:factuur OR subject:invoice OR subject:receipt OR subject:bon OR subject:bestelling OR subject:order OR subject:payment OR subject:betaling)',
    'has:attachment from:(noreply OR no-reply OR billing OR invoice OR factuur OR finance OR accounting)',
    'has:attachment filename:pdf (factuur OR invoice OR receipt)',
  ];

  const processedMessageIds = new Set<string>();

  // Get already-imported message IDs to avoid duplicates
  const existing = db.prepare(
    "SELECT extracted_data FROM invoices WHERE extracted_data LIKE '%gmail_message_id%'"
  ).all() as Array<{ extracted_data: string }>;
  for (const row of existing) {
    try {
      const data = JSON.parse(row.extracted_data);
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

  // Update last scan time
  setSetting('gmail_last_scan', new Date().toISOString());

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
  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  let importedCount = 0;

  for (const part of parts) {
    // Only process PDF, image attachments
    const mimeType = part.mimeType || '';
    const filename = part.filename || '';

    if (!filename) continue;

    const ext = path.extname(filename).toLowerCase();
    const isInvoiceFile = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(ext) ||
      mimeType === 'application/pdf' ||
      mimeType.startsWith('image/');

    if (!isInvoiceFile || !part.body?.attachmentId) continue;

    // Download attachment
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: part.body.attachmentId,
    });

    if (!attachment.data.data) continue;

    const fileBuffer = Buffer.from(attachment.data.data, 'base64');

    // Skip tiny files (likely logos/signatures, not invoices)
    if (fileBuffer.length < 5000) continue;

    const id = uuidv4();
    const storedName = `${id}${ext}`;
    const filePath = path.join(uploadDir, storedName);

    fs.writeFileSync(filePath, fileBuffer);

    // Insert into DB
    db.prepare(`
      INSERT INTO invoices (id, file_path, original_filename, extraction_status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, storedName, filename);

    // Extract with Claude Vision
    try {
      db.prepare("UPDATE invoices SET extraction_status = 'processing' WHERE id = ?").run(id);
      const data = await extractInvoiceData(filePath);

      // Add gmail metadata
      (data as Record<string, unknown>).gmail_message_id = messageId;

      const dateStr = (data.invoice_date as string) || '';
      const qInfo = dateStr
        ? getQuarterFromDate(dateStr)
        : { quarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`, year: new Date().getFullYear() };

      db.prepare(`
        UPDATE invoices SET
          vendor = ?, amount = ?, vat_amount = ?, vat_rate = ?,
          invoice_date = ?, invoice_number = ?, description = ?,
          category = ?, currency = ?, extracted_data = ?,
          extraction_status = 'done', quarter = ?, year = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.vendor as string || null,
        data.amount as number || null,
        data.vat_amount as number || null,
        data.vat_rate as number || null,
        data.invoice_date as string || null,
        data.invoice_number as string || null,
        data.description as string || null,
        data.category as string || null,
        data.currency as string || 'EUR',
        JSON.stringify(data),
        qInfo.quarter, qInfo.year, id
      );

      importedCount++;
    } catch {
      db.prepare("UPDATE invoices SET extraction_status = 'failed' WHERE id = ?").run(id);
    }
  }

  return importedCount;
}

export function isGmailConnected(): boolean {
  return getSetting('gmail_connected') === 'true' && !!getSetting('gmail_refresh_token');
}
