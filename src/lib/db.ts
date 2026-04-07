import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'kwartio.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    vendor TEXT,
    amount REAL,
    vat_amount REAL,
    vat_rate REAL,
    currency TEXT DEFAULT 'EUR',
    invoice_date TEXT,
    invoice_number TEXT,
    description TEXT,
    category TEXT,
    classification TEXT DEFAULT 'unknown' CHECK(classification IN ('professional', 'personal', 'unknown')),
    extraction_status TEXT DEFAULT 'pending' CHECK(extraction_status IN ('pending', 'processing', 'done', 'failed')),
    extracted_data TEXT,
    quarter TEXT,
    year INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    counterparty TEXT,
    reference TEXT,
    account_number TEXT,
    classification TEXT DEFAULT 'unknown' CHECK(classification IN ('professional', 'personal', 'unknown')),
    matched_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    category TEXT,
    source TEXT DEFAULT 'csv_import',
    quarter TEXT,
    year INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS classification_rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    field TEXT NOT NULL CHECK(field IN ('vendor', 'counterparty', 'description')),
    classification TEXT NOT NULL CHECK(classification IN ('professional', 'personal')),
    category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_quarter ON invoices(year, quarter);
  CREATE INDEX IF NOT EXISTS idx_transactions_quarter ON transactions(year, quarter);
  CREATE INDEX IF NOT EXISTS idx_transactions_matched ON transactions(matched_invoice_id);
`);

export default db;

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
