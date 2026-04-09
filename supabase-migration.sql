-- Kwartio Supabase Schema Migration
-- Run this in your Supabase SQL Editor (supabase.com → project → SQL Editor)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  file_path text NOT NULL,
  original_filename text NOT NULL,
  vendor text,
  amount double precision,
  vat_amount double precision,
  vat_rate double precision,
  currency text DEFAULT 'EUR',
  invoice_date text,
  invoice_number text,
  description text,
  category text,
  classification text DEFAULT 'unknown' CHECK(classification IN ('professional', 'personal', 'unknown')),
  extraction_status text DEFAULT 'pending' CHECK(extraction_status IN ('pending', 'processing', 'done', 'failed')),
  extracted_data text,
  file_hash text,
  quarter text,
  year integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  date text NOT NULL,
  description text,
  amount double precision NOT NULL,
  counterparty text,
  reference text,
  account_number text,
  classification text DEFAULT 'unknown' CHECK(classification IN ('professional', 'personal', 'unknown')),
  matched_invoice_id text REFERENCES invoices(id) ON DELETE SET NULL,
  category text,
  source text DEFAULT 'csv_import',
  quarter text,
  year integer,
  created_at timestamptz DEFAULT now()
);

-- Classification rules table
CREATE TABLE IF NOT EXISTS classification_rules (
  id text PRIMARY KEY,
  pattern text NOT NULL,
  field text NOT NULL CHECK(field IN ('vendor', 'counterparty', 'description')),
  classification text NOT NULL CHECK(classification IN ('professional', 'personal')),
  category text,
  created_at timestamptz DEFAULT now()
);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_quarter ON invoices(year, quarter);
CREATE INDEX IF NOT EXISTS idx_transactions_quarter ON transactions(year, quarter);
CREATE INDEX IF NOT EXISTS idx_transactions_matched ON transactions(matched_invoice_id);

-- Storage bucket for invoice files
-- Run this separately or create via Supabase Dashboard → Storage → New Bucket
-- Name: invoices, Public: false
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service role full access to the invoices bucket
CREATE POLICY "Service role full access" ON storage.objects
  FOR ALL USING (bucket_id = 'invoices')
  WITH CHECK (bucket_id = 'invoices');

-- Disable RLS on tables (we use service role key, not user auth)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Allow service role to bypass RLS
CREATE POLICY "Service role access" ON invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role access" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role access" ON classification_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role access" ON settings FOR ALL USING (true) WITH CHECK (true);
