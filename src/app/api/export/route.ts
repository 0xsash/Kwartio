import { NextRequest, NextResponse } from 'next/server';
import { generateQuarterlyExport } from '@/lib/export';
import fs from 'fs';

export async function POST(request: NextRequest) {
  const { year, quarter } = await request.json();

  const currentYear = year || new Date().getFullYear();
  const currentQuarter = quarter || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  try {
    const zipPath = await generateQuarterlyExport(currentYear, currentQuarter);
    const fileBuffer = fs.readFileSync(zipPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="Kwartio_${currentYear}_${currentQuarter}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
