import { v4 as uuidv4 } from 'uuid';
import db, { getSetting, setSetting, getQuarterFromDate } from './db';
import { applyClassificationRules } from './matching';

// GoCardless Bank Account Data (formerly Nordigen) — free EU Open Banking API
// Supports all major Belgian banks: KBC, Belfius, ING, BNP Paribas Fortis, Argenta, etc.

const BASE_URL = 'https://bankaccountdata.gocardless.com/api/v2';

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  let accessToken = getSetting('nordigen_access_token');
  const tokenExpiry = getSetting('nordigen_token_expiry');

  // Refresh token if expired
  if (!accessToken || (tokenExpiry && Date.now() > parseInt(tokenExpiry))) {
    await refreshAccessToken();
    accessToken = getSetting('nordigen_access_token');
  }

  if (!accessToken) throw new Error('Bank API niet geconfigureerd');

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
}

async function refreshAccessToken() {
  const secretId = getSetting('nordigen_secret_id');
  const secretKey = getSetting('nordigen_secret_key');

  if (!secretId || !secretKey) throw new Error('GoCardless API keys niet ingesteld');

  const res = await fetch(`${BASE_URL}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });

  if (!res.ok) throw new Error('Kon geen API token ophalen');

  const data = await res.json();
  setSetting('nordigen_access_token', data.access);
  setSetting('nordigen_token_expiry', (Date.now() + data.access_expires * 1000).toString());

  if (data.refresh) {
    setSetting('nordigen_refresh_token_api', data.refresh);
  }
}

// Get list of Belgian banks
export async function getBelgianBanks(): Promise<Array<{
  id: string;
  name: string;
  logo: string;
}>> {
  const res = await apiRequest('/institutions/?country=be');
  if (!res.ok) throw new Error('Kon banken niet ophalen');

  const data = await res.json();
  return data.map((bank: { id: string; name: string; logo: string }) => ({
    id: bank.id,
    name: bank.name,
    logo: bank.logo,
  }));
}

// Create a bank connection requisition (user needs to authorize)
export async function createBankConnection(institutionId: string): Promise<{
  id: string;
  link: string;
}> {
  const redirectUrl = getSetting('app_url')
    ? `${getSetting('app_url')}/api/auth/bank/callback`
    : 'http://localhost:3000/api/auth/bank/callback';

  const res = await apiRequest('/requisitions/', {
    method: 'POST',
    body: JSON.stringify({
      redirect: redirectUrl,
      institution_id: institutionId,
      user_language: 'NL',
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || 'Kon bankverbinding niet aanmaken');
  }

  const data = await res.json();
  setSetting('nordigen_requisition_id', data.id);
  return { id: data.id, link: data.link };
}

// Check if bank connection is active
export async function checkBankConnection(): Promise<{
  connected: boolean;
  accounts: string[];
  status: string;
}> {
  const reqId = getSetting('nordigen_requisition_id');
  if (!reqId) return { connected: false, accounts: [], status: 'not_started' };

  try {
    const res = await apiRequest(`/requisitions/${reqId}/`);
    if (!res.ok) return { connected: false, accounts: [], status: 'error' };

    const data = await res.json();
    const accounts = data.accounts || [];

    if (data.status === 'LN' && accounts.length > 0) {
      // Store account IDs
      setSetting('nordigen_accounts', JSON.stringify(accounts));
      setSetting('bank_connected', 'true');
      return { connected: true, accounts, status: 'linked' };
    }

    return { connected: false, accounts: [], status: data.status };
  } catch {
    return { connected: false, accounts: [], status: 'error' };
  }
}

// Sync transactions from connected bank accounts
export async function syncBankTransactions(): Promise<{
  imported: number;
  skipped: number;
  accounts: number;
  errors: string[];
}> {
  const accountsJson = getSetting('nordigen_accounts');
  if (!accountsJson) return { imported: 0, skipped: 0, accounts: 0, errors: ['Geen bankrekeningen verbonden'] };

  const accountIds = JSON.parse(accountsJson) as string[];
  const errors: string[] = [];
  let totalImported = 0;
  let totalSkipped = 0;

  const checkDuplicate = db.prepare(
    'SELECT id FROM transactions WHERE date = ? AND amount = ? AND counterparty = ?'
  );
  const insert = db.prepare(`
    INSERT INTO transactions (id, date, description, amount, counterparty, reference, account_number, source, quarter, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'bank_api', ?, ?)
  `);

  for (const accountId of accountIds) {
    try {
      // Get account details
      const detailsRes = await apiRequest(`/accounts/${accountId}/`);
      if (!detailsRes.ok) continue;
      const details = await detailsRes.json();
      const iban = details.iban || '';

      // Get transactions (last 90 days)
      const txRes = await apiRequest(`/accounts/${accountId}/transactions/`);
      if (!txRes.ok) {
        errors.push(`Account ${iban}: kon transacties niet ophalen`);
        continue;
      }

      const txData = await txRes.json();
      const bookedTx = txData.transactions?.booked || [];

      const insertMany = db.transaction(() => {
        for (const tx of bookedTx) {
          const date = tx.bookingDate || tx.valueDate || '';
          const amount = parseFloat(tx.transactionAmount?.amount || '0');
          const counterparty = tx.creditorName || tx.debtorName || '';
          const description = tx.remittanceInformationUnstructured ||
            tx.remittanceInformationUnstructuredArray?.join(' ') || '';
          const reference = tx.transactionId || tx.internalTransactionId || '';

          if (!date || amount === 0) continue;

          // Duplicate check
          const existing = checkDuplicate.get(date, amount, counterparty);
          if (existing) { totalSkipped++; continue; }

          const { quarter, year } = getQuarterFromDate(date);
          const id = uuidv4();
          insert.run(id, date, description, amount, counterparty, reference, iban, quarter, year);
          totalImported++;
        }
      });

      insertMany();
    } catch (e) {
      errors.push(`Account sync failed: ${(e as Error).message}`);
    }
  }

  // Apply classification rules
  if (totalImported > 0) {
    applyClassificationRules();
  }

  setSetting('bank_last_sync', new Date().toISOString());

  return { imported: totalImported, skipped: totalSkipped, accounts: accountIds.length, errors };
}

export function isBankConnected(): boolean {
  return getSetting('bank_connected') === 'true';
}
