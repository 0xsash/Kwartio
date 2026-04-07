import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db';

export async function GET() {
  const settings = getAllSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as Record<string, string>;

  const allowedKeys = [
    'business_name', 'vat_number', 'address_line1', 'address_line2',
    'city', 'postal_code', 'country', 'phone', 'email',
  ];

  for (const [key, value] of Object.entries(body)) {
    if (allowedKeys.includes(key) && typeof value === 'string') {
      setSetting(key, value);
    }
  }

  return NextResponse.json({ success: true });
}
