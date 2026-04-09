import { supabase, type Transaction } from './db';

// Patterns that indicate non-invoice transactions (internal transfers, ATM, etc.)
const SKIP_PATTERNS = [
  'eigen rekening', 'spaarrekening', 'sparen', 'interne overschrijving',
  'geldopname', 'geldautomaat', 'atm', 'bancontact',
  'overschrijving naar', 'overschrijving van',
  'domiciliëring', 'domiciliering', 'standing order',
  'rente', 'intrest', 'interest',
  'kosten', 'bankkosten', 'provisie',
  'loon', 'salaris', 'wedde',
];

const MIN_AMOUNT_THRESHOLD = 10; // EUR — skip tiny transactions

export function transactionNeedsInvoice(tx: Transaction): boolean {
  // Only expenses (negative amounts)
  if (tx.amount >= 0) return false;

  // Skip personal transactions
  if (tx.classification === 'personal') return false;

  // Skip already matched
  if (tx.matched_invoice_id) return false;

  // Skip tiny amounts (bank fees, parking, etc.)
  if (Math.abs(tx.amount) < MIN_AMOUNT_THRESHOLD) return false;

  // Skip known non-invoice patterns
  const searchText = [tx.counterparty, tx.description, tx.reference]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const pattern of SKIP_PATTERNS) {
    if (searchText.includes(pattern)) return false;
  }

  return true;
}

export async function getMissingInvoiceTransactions(
  year?: number,
  quarter?: string,
): Promise<Transaction[]> {
  let query = supabase
    .from('transactions')
    .select('*')
    .is('matched_invoice_id', null)
    .lt('amount', -MIN_AMOUNT_THRESHOLD)
    .neq('classification', 'personal');

  if (year) query = query.eq('year', year);
  if (quarter) query = query.eq('quarter', quarter);

  const { data } = await query.order('date', { ascending: false }).returns<Transaction[]>();

  // Apply pattern-based filtering in JS (more flexible than SQL)
  return (data || []).filter(transactionNeedsInvoice);
}

export async function getMissingInvoiceCount(
  year?: number,
  quarter?: string,
): Promise<number> {
  const transactions = await getMissingInvoiceTransactions(year, quarter);
  return transactions.length;
}
