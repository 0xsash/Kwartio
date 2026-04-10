-- Kwartio Deduplication Migration
-- Run this in your Supabase SQL Editor AFTER running supabase-migration.sql

-- ============================================================================
-- STEP 1: Inspect existing duplicates BEFORE adding constraints
-- ============================================================================
-- Run these SELECT queries first. If they return rows, you need to clean up
-- the duplicates manually before adding the UNIQUE indexes below, otherwise
-- the CREATE UNIQUE INDEX statements will fail.

-- 1a. Find invoice duplicates by file_hash
-- SELECT file_hash, COUNT(*), array_agg(id) as ids
-- FROM invoices
-- WHERE file_hash IS NOT NULL
-- GROUP BY file_hash
-- HAVING COUNT(*) > 1;

-- 1b. Find invoice duplicates by content (vendor + amount + date)
-- SELECT LOWER(vendor) as v, amount, invoice_date, COUNT(*), array_agg(id) as ids
-- FROM invoices
-- WHERE vendor IS NOT NULL AND amount IS NOT NULL AND invoice_date IS NOT NULL
-- GROUP BY LOWER(vendor), amount, invoice_date
-- HAVING COUNT(*) > 1;

-- 1c. Find transaction duplicates
-- SELECT date, amount, COALESCE(counterparty, ''), COALESCE(account_number, ''),
--        COUNT(*), array_agg(id) as ids
-- FROM transactions
-- GROUP BY date, amount, COALESCE(counterparty, ''), COALESCE(account_number, '')
-- HAVING COUNT(*) > 1;

-- ============================================================================
-- STEP 2: Clean up existing duplicates (ONLY if the SELECTs above returned rows)
-- ============================================================================
-- Keep the oldest record (MIN(created_at)), delete the rest.
-- REVIEW and run manually if needed:

-- Delete invoice file-hash duplicates (keeps the first-created one)
-- DELETE FROM invoices
-- WHERE id IN (
--   SELECT id FROM (
--     SELECT id, ROW_NUMBER() OVER (PARTITION BY file_hash ORDER BY created_at ASC) as rn
--     FROM invoices
--     WHERE file_hash IS NOT NULL
--   ) t WHERE rn > 1
-- );

-- Delete invoice content duplicates
-- DELETE FROM invoices
-- WHERE id IN (
--   SELECT id FROM (
--     SELECT id, ROW_NUMBER() OVER (
--       PARTITION BY LOWER(vendor), amount, invoice_date ORDER BY created_at ASC
--     ) as rn
--     FROM invoices
--     WHERE vendor IS NOT NULL AND amount IS NOT NULL AND invoice_date IS NOT NULL
--   ) t WHERE rn > 1
-- );

-- Delete transaction duplicates
-- DELETE FROM transactions
-- WHERE id IN (
--   SELECT id FROM (
--     SELECT id, ROW_NUMBER() OVER (
--       PARTITION BY date, amount, COALESCE(counterparty, ''), COALESCE(account_number, '')
--       ORDER BY created_at ASC
--     ) as rn
--     FROM transactions
--   ) t WHERE rn > 1
-- );

-- ============================================================================
-- STEP 3: Add UNIQUE indexes to prevent future duplicates
-- ============================================================================

-- Exact file dedup: same PDF bytes can never be imported twice.
-- Partial index: only enforces when file_hash is NOT NULL (older records or
-- needs_download placeholders may have no hash).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_file_hash_unique
  ON invoices (file_hash)
  WHERE file_hash IS NOT NULL;

-- Content dedup: same (vendor, amount, invoice_date) can never appear twice.
-- Case-insensitive vendor match. Partial index because all three fields are
-- populated only after successful extraction.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_content_unique
  ON invoices (LOWER(vendor), amount, invoice_date)
  WHERE vendor IS NOT NULL
    AND amount IS NOT NULL
    AND invoice_date IS NOT NULL;

-- Transactions per-account dedup: uses COALESCE so NULL counterparty/account
-- still participates in the uniqueness check. Crucially INCLUDES
-- account_number — without it, the same-amount/vendor charge on two
-- different cards would be silently dropped as a "duplicate".
CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique
  ON transactions (date, amount, COALESCE(counterparty, ''), COALESCE(account_number, ''));
