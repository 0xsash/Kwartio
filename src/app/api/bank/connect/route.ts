import { NextRequest, NextResponse } from 'next/server';
import { getBelgianBanks, createBankConnection } from '@/lib/bank-api';

export async function GET() {
  try {
    const banks = await getBelgianBanks();
    return NextResponse.json({ banks });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { institutionId } = await request.json();

  if (!institutionId) {
    return NextResponse.json({ error: 'Geen bank geselecteerd' }, { status: 400 });
  }

  try {
    const result = await createBankConnection(institutionId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
