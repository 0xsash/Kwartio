import { NextRequest, NextResponse } from 'next/server';
import { generateExcelWorkbook } from '@/lib/export';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const buffer = await generateExcelWorkbook(year, quarter);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Kwartio_${year}_${quarter}.xlsx"`,
    },
  });
}
