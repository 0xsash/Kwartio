import { NextRequest, NextResponse } from 'next/server';
import { autoMatchTransactions } from '@/lib/matching';

export async function POST(request: NextRequest) {
  const { year, quarter } = await request.json();

  const currentYear = year || new Date().getFullYear();
  const currentQuarter = quarter || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const matches = autoMatchTransactions(currentYear, currentQuarter);

  return NextResponse.json({
    matched: matches.length,
    matches: matches.map(m => ({
      transactionId: m.transactionId,
      invoiceId: m.invoiceId,
      confidence: m.confidence,
    })),
  });
}
