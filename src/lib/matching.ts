import db, { type Invoice, type Transaction } from './db';

// Match transactions to invoices based on amount, date proximity, and vendor similarity
export function autoMatchTransactions(year: number, quarter: string) {
  const invoices = db.prepare(
    'SELECT * FROM invoices WHERE year = ? AND quarter = ? AND extraction_status = ?'
  ).all(year, quarter, 'done') as Invoice[];

  const transactions = db.prepare(
    'SELECT * FROM transactions WHERE year = ? AND quarter = ? AND matched_invoice_id IS NULL'
  ).all(year, quarter) as Transaction[];

  const matches: { transactionId: string; invoiceId: string; confidence: number }[] = [];

  for (const tx of transactions) {
    let bestMatch: { invoiceId: string; score: number } | null = null;

    for (const inv of invoices) {
      if (!inv.amount) continue;

      let score = 0;

      // Amount matching (most important) - check if absolute values are close
      const txAmount = Math.abs(tx.amount);
      const invAmount = Math.abs(inv.amount);
      const amountDiff = Math.abs(txAmount - invAmount);

      if (amountDiff < 0.01) {
        score += 50; // Exact match
      } else if (amountDiff < 1) {
        score += 30; // Very close (rounding)
      } else if (amountDiff / invAmount < 0.05) {
        score += 15; // Within 5%
      } else {
        continue; // Amount too different, skip
      }

      // Date proximity
      if (inv.invoice_date && tx.date) {
        const invDate = new Date(inv.invoice_date);
        const txDate = new Date(tx.date);
        const daysDiff = Math.abs((txDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 3) score += 25;
        else if (daysDiff <= 7) score += 15;
        else if (daysDiff <= 14) score += 10;
        else if (daysDiff <= 30) score += 5;
      }

      // Vendor / counterparty similarity
      if (inv.vendor && tx.counterparty) {
        const vendorLower = inv.vendor.toLowerCase();
        const counterpartyLower = tx.counterparty.toLowerCase();

        if (counterpartyLower.includes(vendorLower) || vendorLower.includes(counterpartyLower)) {
          score += 25;
        } else {
          // Check for partial word match
          const vendorWords = vendorLower.split(/\s+/);
          const counterpartyWords = counterpartyLower.split(/\s+/);
          const commonWords = vendorWords.filter(w => w.length > 2 && counterpartyWords.some(cw => cw.includes(w)));
          if (commonWords.length > 0) {
            score += 10;
          }
        }
      }

      // Description match
      if (inv.vendor && tx.description) {
        const descLower = tx.description.toLowerCase();
        const vendorLower = inv.vendor.toLowerCase();
        if (descLower.includes(vendorLower) || vendorLower.includes(descLower)) {
          score += 10;
        }
      }

      if (score > (bestMatch?.score ?? 0)) {
        bestMatch = { invoiceId: inv.id, score };
      }
    }

    if (bestMatch && bestMatch.score >= 40) {
      matches.push({
        transactionId: tx.id,
        invoiceId: bestMatch.invoiceId,
        confidence: Math.min(bestMatch.score, 100),
      });
    }
  }

  // Apply matches (highest confidence first, no duplicate invoice matches)
  const usedInvoices = new Set<string>();
  const sortedMatches = matches.sort((a, b) => b.confidence - a.confidence);
  const appliedMatches: typeof matches = [];

  const updateStmt = db.prepare(
    'UPDATE transactions SET matched_invoice_id = ? WHERE id = ?'
  );

  for (const match of sortedMatches) {
    if (usedInvoices.has(match.invoiceId)) continue;
    usedInvoices.add(match.invoiceId);
    updateStmt.run(match.invoiceId, match.transactionId);
    appliedMatches.push(match);
  }

  return appliedMatches;
}

// Apply learned classification rules
export function applyClassificationRules() {
  const rules = db.prepare('SELECT * FROM classification_rules').all() as Array<{
    pattern: string;
    field: string;
    classification: string;
    category: string | null;
  }>;

  const updateInvoice = db.prepare(
    'UPDATE invoices SET classification = ?, category = COALESCE(?, category) WHERE id = ?'
  );
  const updateTransaction = db.prepare(
    'UPDATE transactions SET classification = ?, category = COALESCE(?, category) WHERE id = ?'
  );

  // Apply to unclassified invoices
  const invoices = db.prepare(
    "SELECT * FROM invoices WHERE classification = 'unknown'"
  ).all() as Invoice[];

  for (const inv of invoices) {
    for (const rule of rules) {
      const value = rule.field === 'vendor' ? inv.vendor : inv.description;
      if (value && value.toLowerCase().includes(rule.pattern.toLowerCase())) {
        updateInvoice.run(rule.classification, rule.category, inv.id);
        break;
      }
    }
  }

  // Apply to unclassified transactions
  const transactions = db.prepare(
    "SELECT * FROM transactions WHERE classification = 'unknown'"
  ).all() as Transaction[];

  for (const tx of transactions) {
    for (const rule of rules) {
      let value: string | null = null;
      if (rule.field === 'counterparty') value = tx.counterparty;
      else if (rule.field === 'description') value = tx.description;
      else if (rule.field === 'vendor') value = tx.counterparty;

      if (value && value.toLowerCase().includes(rule.pattern.toLowerCase())) {
        updateTransaction.run(rule.classification, rule.category, tx.id);
        break;
      }
    }
  }
}
