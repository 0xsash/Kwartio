import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
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

// Step 1: Quick search — just list message IDs (fast, no downloads)
export async function scanInboxMessageIds(): Promise<{
  messageIds: string[];
  errors: string[];
}> {
  const client = await getAuthenticatedClient();
  if (!client) return { messageIds: [], errors: ['Gmail niet verbonden'] };

  const gmail = google.gmail({ version: 'v1', auth: client });
  const errors: string[] = [];

  // Broad queries organized by category — designed for any Belgian freelancer.
  // Each query targets a common pattern, NOT specific individual vendors.
  const queries = [
    // --- SUBJECT-BASED (language-agnostic invoice/receipt keywords) ---

    // Dutch/French/English invoice & payment terms
    'has:attachment (subject:factuur OR subject:invoice OR subject:facture OR subject:receipt OR subject:bon OR subject:bestelling OR subject:order OR subject:rekening OR subject:afrekening OR subject:creditnota OR subject:"credit note" OR subject:nota OR subject:betaling OR subject:paiement)',

    // SaaS/subscription receipt patterns (English — most SaaS uses English)
    'has:attachment (subject:"your receipt" OR subject:"payment receipt" OR subject:"payment confirmation" OR subject:"monthly statement" OR subject:"subscription" OR subject:"renewal" OR subject:"billing statement" OR subject:"your order" OR subject:"purchase confirmation")',

    // Dutch/French confirmation & payment patterns
    'has:attachment (subject:"bevestiging" OR subject:"betalingsbewijs" OR subject:"overzicht" OR subject:"maandoverzicht" OR subject:"je bestelling" OR subject:"uw factuur" OR subject:"uw bestelling" OR subject:"votre facture" OR subject:"votre commande")',

    // --- FROM-BASED (automated sender patterns) ---

    // Generic automated senders — catches most companies
    'has:attachment from:(noreply OR no-reply OR billing OR payments OR receipts OR invoice OR invoicing OR finance OR accounting OR orders OR notification OR donotreply OR automated OR mailer OR system)',

    // --- FROM-BASED (common service categories) ---

    // Cloud, AI & developer platforms
    'has:attachment from:(stripe.com OR google.com OR apple.com OR microsoft.com OR github.com OR amazonaws.com OR cloudflare.com OR digitalocean.com OR heroku.com OR netlify.com OR vercel.com OR hetzner.com OR ovh.com OR scaleway.com)',

    // Productivity, design & collaboration SaaS
    'has:attachment from:(notion.so OR figma.com OR canva.com OR slack.com OR zoom.us OR dropbox.com OR adobe.com OR atlassian.com OR jetbrains.com OR 1password.com OR lastpass.com OR trello.com OR asana.com OR monday.com OR miro.com)',

    // Social media, entertainment & consumer subscriptions
    'has:attachment from:(x.com OR twitter.com OR spotify.com OR linkedin.com OR meta.com OR facebook.com OR instagram.com OR tiktok.com OR twitch.tv OR patreon.com OR substack.com)',

    // AI services
    'has:attachment from:(openai.com OR anthropic.com OR huggingface.co OR replicate.com OR stability.ai OR midjourney.com OR perplexity.ai)',

    // Belgian telecom & utilities (major providers)
    'has:attachment from:(proximus.be OR telenet.be OR orange.be OR voo.be OR scarlet.be OR mobile-vikings.be OR engie.be OR luminus.be OR eneco.be OR fluvius.be OR water-link.be OR totalenergies.be)',

    // Belgian e-commerce & retail
    'has:attachment from:(bol.com OR coolblue.be OR coolblue.nl OR zalando.be OR amazon.de OR amazon.fr OR amazon.com OR mediamarkt.be OR fnac.be)',

    // Belgian government, tax & social security
    'has:attachment from:(minfin.fed.be OR fod.belgie.be OR socialsecurity.be OR rsz.be OR rsvz.be OR onss.be OR inasti.be OR vlaanderen.be OR brussels.be OR wallonie.be OR fiscus.fgov.be)',

    // Belgian social secretariats & HR/payroll
    'has:attachment from:(acerta.be OR securex.be OR liantis.be OR xerius.be OR partena.be OR attentia.be OR sd-worx.be OR ucm.be OR groupe-s.be)',

    // Insurance & financial services
    'has:attachment from:(ethias.be OR ag.be OR axa.be OR belfius.be OR kbc.be OR ing.be OR bnpparibasfortis.be OR argenta.be OR paypal.com OR wise.com OR revolut.com OR mollie.com OR stripe.com)',

    // --- FILE-BASED & CATCH-ALL ---

    // Any PDF with invoice/receipt keywords in email body
    'has:attachment filename:pdf (factuur OR invoice OR facture OR receipt OR bon OR nota OR credit OR statement OR rekening OR ontvangstbewijs)',

    // Gmail auto-categorized purchases
    'has:attachment category:purchases',
  ];

  // Additional queries for government NOTIFICATION emails (often no attachment).
  // These create "needs download" reminders for documents on portals.
  const govNotificationQueries = [
    // Belgian government portal notifications (may not have PDF attached)
    'from:(minfin.fed.be OR fod.belgie.be OR fiscus.fgov.be OR socialsecurity.be OR rsz.be OR rsvz.be OR onss.be OR inasti.be) (document OR aangifte OR bijdrage OR voorheffing OR attest OR btw OR tva)',
    // Social secretariat notifications
    'from:(acerta.be OR securex.be OR liantis.be OR xerius.be OR partena.be OR ucm.be OR sd-worx.be) (factuur OR afrekening OR bijdrage OR document OR overzicht)',
    // eBox notifications
    'from:(ebox.be OR myebox.be OR csam.be OR itsme.be) (document OR bericht OR message)',
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

  // Helper to run a set of queries and collect message IDs
  async function runQueries(queryList: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    const results = await Promise.allSettled(
      queryList.map(async (query) => {
        const allMessages: Array<{ id?: string | null }> = [];
        let pageToken: string | undefined;
        for (let page = 0; page < 2; page++) {
          const res = await gmail.users.messages.list({
            userId: 'me',
            q: `${query} newer_than:2y`,
            maxResults: 100,
            pageToken,
          });
          allMessages.push(...(res.data.messages || []));
          pageToken = res.data.nextPageToken || undefined;
          if (!pageToken) break;
        }
        return allMessages;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const msg of result.value) {
          if (msg.id && !processedMessageIds.has(msg.id)) {
            ids.add(msg.id);
          }
        }
      } else {
        const errMsg = result.reason?.message || String(result.reason);
        if (errMsg.includes('401') || errMsg.includes('invalid_grant') || errMsg.includes('Token')) {
          errors.push('Gmail authenticatie verlopen. Koppel Gmail opnieuw via Instellingen.');
          return ids;
        }
        errors.push(`Query failed: ${errMsg}`);
      }
    }
    return ids;
  }

  // Run attachment-based queries (main invoice search)
  const uniqueMessageIds = await runQueries(queries);

  if (errors.some(e => e.includes('authenticatie verlopen'))) {
    return { messageIds: [], errors };
  }

  // Run government notification queries (may not have attachments)
  const govMessageIds = await runQueries(govNotificationQueries);
  // Merge: gov notification IDs that aren't already in the main set get tagged
  const govOnlyIds = new Set<string>();
  for (const id of govMessageIds) {
    if (!uniqueMessageIds.has(id)) {
      govOnlyIds.add(id);
      uniqueMessageIds.add(id);
    }
  }

  // Store message IDs for batch processing
  const messageIds = Array.from(uniqueMessageIds);
  if (messageIds.length > 0) {
    await setSetting('gmail_scan_queue', JSON.stringify(messageIds));
  }
  // Store gov-only IDs so the batch processor knows to create reminders
  if (govOnlyIds.size > 0) {
    await setSetting('gmail_gov_ids', JSON.stringify(Array.from(govOnlyIds)));
  }

  return { messageIds, errors };
}

// Step 2: Process a small batch of messages (called repeatedly from frontend)
export async function processGmailBatch(batchSize: number = 3): Promise<{
  processed: number;
  imported: number;
  remaining: number;
  errors: string[];
}> {
  const client = await getAuthenticatedClient();
  if (!client) return { processed: 0, imported: 0, remaining: 0, errors: ['Gmail niet verbonden'] };

  const queueJson = await getSetting('gmail_scan_queue');
  if (!queueJson) return { processed: 0, imported: 0, remaining: 0, errors: [] };

  let queue: string[];
  try { queue = JSON.parse(queueJson); } catch { return { processed: 0, imported: 0, remaining: 0, errors: [] }; }

  if (queue.length === 0) return { processed: 0, imported: 0, remaining: 0, errors: [] };

  const gmail = google.gmail({ version: 'v1', auth: client });
  const errors: string[] = [];
  const batch = queue.splice(0, batchSize);
  let imported = 0;

  // Process batch in parallel
  const results = await Promise.allSettled(
    batch.map(async (msgId) => {
      try {
        return await saveGmailAttachments(gmail, msgId);
      } catch (e) {
        errors.push(`${msgId}: ${(e as Error).message}`);
        return 0;
      }
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') imported += r.value;
  }

  // Update queue
  if (queue.length > 0) {
    await setSetting('gmail_scan_queue', JSON.stringify(queue));
  } else {
    await setSetting('gmail_scan_queue', '');
    await setSetting('gmail_last_scan', new Date().toISOString());
  }

  return { processed: batch.length, imported, remaining: queue.length, errors };
}

// Save attachments from a Gmail message WITHOUT running Claude extraction.
// For government notification emails without attachments, creates a reminder.
async function saveGmailAttachments(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
): Promise<number> {
  // MUST use format 'full' to get payload.parts (attachment info).
  // 'metadata' only returns headers, NOT the parts tree.
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = msg.data.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const dateHeader = headers.find(h => h.name === 'Date')?.value || '';

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

    // Skip tiny files (logos/signatures) — 3KB threshold
    if (fileBuffer.length < 3000) continue;

    // Duplicate check by file hash
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
    const { data: existingByHash } = await supabase
      .from('invoices')
      .select('id')
      .eq('file_hash', fileHash)
      .limit(1);
    if (existingByHash && existingByHash.length > 0) continue;

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
      file_hash: fileHash,
    });

    savedCount++;
  }

  // If no attachments saved AND this is a government notification email,
  // create a "needs_download" reminder so the user knows to fetch it from the portal
  if (savedCount === 0) {
    const govIdsJson = await getSetting('gmail_gov_ids');
    const govIds: string[] = govIdsJson ? JSON.parse(govIdsJson) : [];
    if (govIds.includes(messageId)) {
      // Check if we already have a reminder for this message
      const { data: existingReminder } = await supabase
        .from('invoices')
        .select('id')
        .like('extracted_data', `%"gmail_message_id":"${messageId}"%`)
        .limit(1);

      if (!existingReminder || existingReminder.length === 0) {
        // Extract a clean sender name from the From header
        const senderMatch = from.match(/^"?([^"<]+)"?\s*</);
        const senderName = senderMatch ? senderMatch[1].trim() : from.split('@')[0];

        const emailDate = dateHeader ? new Date(dateHeader) : new Date();
        const dateStr = emailDate.toISOString().split('T')[0];
        const qInfo = getQuarterFromDate(dateStr);

        const id = uuidv4();
        await supabase.from('invoices').insert({
          id,
          file_path: '',
          original_filename: `[Download nodig] ${subject}`,
          extraction_status: 'needs_download',
          extracted_data: JSON.stringify({
            gmail_message_id: messageId,
            reminder: true,
            source: 'government_notification',
            email_subject: subject,
            email_from: from,
            email_date: dateStr,
          }),
          vendor: senderName,
          invoice_date: dateStr,
          description: `Document beschikbaar op portaal — ${subject}`,
          quarter: qInfo.quarter,
          year: qInfo.year,
        });
        savedCount++;
      }
    }
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
    .limit(10);

  if (!pending || pending.length === 0) {
    return { extracted: 0, failed: 0, remaining: 0 };
  }

  let extracted = 0;
  let failed = 0;

  // Process extractions 3 at a time
  const batches = [];
  for (let i = 0; i < pending.length; i += 3) {
    batches.push(pending.slice(i, i + 3));
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(async (invoice) => {
        try {
          await supabase.from('invoices').update({ extraction_status: 'processing' }).eq('id', invoice.id);

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
      }),
    );
    // Count results
    for (const r of results) {
      if (r.status === 'rejected') failed++;
    }
  }

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
