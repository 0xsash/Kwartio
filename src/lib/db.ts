import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getSupabase() as any)[prop];
  },
});

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('settings')
    .select('key, value');
  const result: Record<string, string> = {};
  for (const row of data || []) result[row.key] = row.value;
  return result;
}

export function getQuarterFromDate(dateStr: string): { quarter: string; year: number } {
  const date = new Date(dateStr);
  const month = date.getMonth();
  const quarter = `Q${Math.floor(month / 3) + 1}`;
  return { quarter, year: date.getFullYear() };
}

export type Invoice = {
  id: string;
  file_path: string;
  original_filename: string;
  vendor: string | null;
  amount: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  currency: string;
  invoice_date: string | null;
  invoice_number: string | null;
  description: string | null;
  category: string | null;
  classification: 'professional' | 'personal' | 'unknown';
  extraction_status: 'pending' | 'processing' | 'done' | 'failed';
  extracted_data: string | null;
  quarter: string | null;
  year: number | null;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  counterparty: string | null;
  reference: string | null;
  account_number: string | null;
  classification: 'professional' | 'personal' | 'unknown';
  matched_invoice_id: string | null;
  category: string | null;
  source: string;
  quarter: string | null;
  year: number | null;
  created_at: string;
};
