import { supabase, type Invoice, type Transaction } from './db';

// Strip common corporate suffixes and noise to compare vendor↔counterparty
// fuzzily. Handles cases like "Google LLC" vs "GOOGLE *YouTubePremium".
function normalizeVendor(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|bv|bvba|srl|sa|nv|gmbh|ag|corp|company|limited|com|plc|sprl)\b/g, '')
    .replace(/[*._\-/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function autoMatchTransactions(year: number, quarter: string) {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .eq('year', year)
    .eq('quarter', quarter)
    .eq('extraction_status', 'done')
    .returns<Invoice[]>();

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('year', year)
    .eq('quarter', quarter)
    .is('matched_invoice_id', null)
    .returns<Transaction[]>();

  const matches: { transactionId: string; invoiceId: string; confidence: number }[] = [];

  for (const tx of transactions || []) {
    let bestMatch: { invoiceId: string; score: number } | null = null;

    for (const inv of invoices || []) {
      if (!inv.amount) continue;

      let score = 0;

      const txAmount = Math.abs(tx.amount);
      const invAmount = Math.abs(inv.amount);
      const amountDiff = Math.abs(txAmount - invAmount);

      if (amountDiff < 0.01) {
        score += 50;
      } else if (amountDiff < 1) {
        score += 30;
      } else if (amountDiff / invAmount < 0.10) {
        // Widened from 5% to 10% to handle FX variation (USD invoices, etc.)
        score += 15;
      } else {
        continue;
      }

      if (inv.invoice_date && tx.date) {
        const invDate = new Date(inv.invoice_date);
        const txDate = new Date(tx.date);
        const daysDiff = Math.abs((txDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 3) score += 25;
        else if (daysDiff <= 7) score += 15;
        else if (daysDiff <= 14) score += 10;
        else if (daysDiff <= 30) score += 5;
        else if (daysDiff <= 45) score += 3;
      }

      if (inv.vendor && tx.counterparty) {
        // Compare normalized forms to handle "Google LLC" vs "GOOGLE *YouTubePremium"
        const vendorNorm = normalizeVendor(inv.vendor);
        const counterpartyNorm = normalizeVendor(tx.counterparty);

        if (vendorNorm && counterpartyNorm) {
          if (counterpartyNorm.includes(vendorNorm) || vendorNorm.includes(counterpartyNorm)) {
            score += 25;
          } else {
            const vendorWords = vendorNorm.split(/\s+/);
            const counterpartyWords = counterpartyNorm.split(/\s+/);
            const commonWords = vendorWords.filter(
              (w) => w.length > 2 && counterpartyWords.some((cw) => cw.includes(w)),
            );
            if (commonWords.length > 0) {
              score += 10;
            }
          }
        }
      }

      if (inv.vendor && tx.description) {
        const descNorm = normalizeVendor(tx.description);
        const vendorNorm = normalizeVendor(inv.vendor);
        if (vendorNorm && descNorm && (descNorm.includes(vendorNorm) || vendorNorm.includes(descNorm))) {
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

  const usedInvoices = new Set<string>();
  const sortedMatches = matches.sort((a, b) => b.confidence - a.confidence);
  const appliedMatches: typeof matches = [];

  for (const match of sortedMatches) {
    if (usedInvoices.has(match.invoiceId)) continue;
    usedInvoices.add(match.invoiceId);

    await supabase
      .from('transactions')
      .update({ matched_invoice_id: match.invoiceId })
      .eq('id', match.transactionId);

    appliedMatches.push(match);
  }

  return appliedMatches;
}

export async function applyClassificationRules() {
  const { data: rules } = await supabase
    .from('classification_rules')
    .select('*');

  if (!rules || rules.length === 0) return;

  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .eq('classification', 'unknown')
    .returns<Invoice[]>();

  for (const inv of invoices || []) {
    for (const rule of rules) {
      const value = rule.field === 'vendor' ? inv.vendor : inv.description;
      if (value && value.toLowerCase().includes(rule.pattern.toLowerCase())) {
        await supabase
          .from('invoices')
          .update({ classification: rule.classification, category: rule.category || inv.category })
          .eq('id', inv.id);
        break;
      }
    }
  }

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('classification', 'unknown')
    .returns<Transaction[]>();

  for (const tx of transactions || []) {
    for (const rule of rules) {
      let value: string | null = null;
      if (rule.field === 'counterparty') value = tx.counterparty;
      else if (rule.field === 'description') value = tx.description;
      else if (rule.field === 'vendor') value = tx.counterparty;

      if (value && value.toLowerCase().includes(rule.pattern.toLowerCase())) {
        await supabase
          .from('transactions')
          .update({ classification: rule.classification, category: rule.category || tx.category })
          .eq('id', tx.id);
        break;
      }
    }
  }
}
