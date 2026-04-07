import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const invoiceStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN classification = 'professional' THEN 1 ELSE 0 END) as professional,
      SUM(CASE WHEN classification = 'personal' THEN 1 ELSE 0 END) as personal,
      SUM(CASE WHEN classification = 'unknown' THEN 1 ELSE 0 END) as unclassified,
      SUM(CASE WHEN extraction_status = 'done' THEN 1 ELSE 0 END) as extracted,
      SUM(CASE WHEN extraction_status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN classification = 'professional' THEN amount ELSE 0 END) as total_professional_amount,
      SUM(CASE WHEN classification = 'professional' THEN vat_amount ELSE 0 END) as total_vat
    FROM invoices WHERE year = ? AND quarter = ?
  `).get(year, quarter) as Record<string, number>;

  const txStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN classification = 'professional' THEN 1 ELSE 0 END) as professional,
      SUM(CASE WHEN classification = 'personal' THEN 1 ELSE 0 END) as personal,
      SUM(CASE WHEN classification = 'unknown' THEN 1 ELSE 0 END) as unclassified,
      SUM(CASE WHEN matched_invoice_id IS NOT NULL THEN 1 ELSE 0 END) as matched,
      SUM(CASE WHEN classification = 'professional' THEN ABS(amount) ELSE 0 END) as total_professional_amount
    FROM transactions WHERE year = ? AND quarter = ?
  `).get(year, quarter) as Record<string, number>;

  return NextResponse.json({
    year,
    quarter,
    invoices: invoiceStats,
    transactions: txStats,
    readyForExport: (invoiceStats.unclassified || 0) === 0 && (txStats.unclassified || 0) === 0,
  });
}
