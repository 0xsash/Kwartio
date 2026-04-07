import { NextRequest, NextResponse } from 'next/server';
import { generateInvoiceCSV, generateTransactionCSV } from '@/lib/export';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
  const type = searchParams.get('type') || 'invoices';

  const csv = type === 'transactions'
    ? generateTransactionCSV(year, quarter)
    : generateInvoiceCSV(year, quarter);

  const filename = type === 'transactions'
    ? `Kwartio_Transacties_${year}_${quarter}.csv`
    : `Kwartio_Facturen_${year}_${quarter}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
