import { NextRequest, NextResponse } from 'next/server';
import { getMissingInvoiceTransactions, getMissingInvoiceCount } from '@/lib/missing-invoices';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : undefined;
  const quarter = searchParams.get('quarter') || undefined;
  const countOnly = searchParams.get('count') === 'true';

  if (countOnly) {
    const count = await getMissingInvoiceCount(year, quarter);
    return NextResponse.json({ count });
  }

  const transactions = await getMissingInvoiceTransactions(year, quarter);
  return NextResponse.json({ transactions });
}
