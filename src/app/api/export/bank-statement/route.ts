import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings } from '@/lib/db';
import { generateBankStatementPDF } from '@/lib/pdf-generate';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
  const quarter = searchParams.get('quarter') || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const settings = getAllSettings();
  const buffer = await generateBankStatementPDF(year, quarter, settings);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Bankafschrift_${year}_${quarter}.pdf"`,
    },
  });
}
