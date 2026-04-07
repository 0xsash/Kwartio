import { NextRequest, NextResponse } from 'next/server';
import { generateInvoicesZip } from '@/lib/export';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const buffer = await generateInvoicesZip(year, quarter);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Facturen_${year}_${quarter}.zip"`,
    },
  });
}
