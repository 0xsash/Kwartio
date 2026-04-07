import { NextRequest, NextResponse } from 'next/server';
import { generateAccountantPackage } from '@/lib/export';

export async function POST(request: NextRequest) {
  const { year, quarter } = await request.json();

  const currentYear = year || new Date().getFullYear();
  const currentQuarter = quarter || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const buffer = await generateAccountantPackage(currentYear, currentQuarter);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Kwartio_${currentYear}_${currentQuarter}_Boekhoudpakket.zip"`,
    },
  });
}
