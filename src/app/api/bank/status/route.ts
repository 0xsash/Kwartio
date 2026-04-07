import { NextResponse } from 'next/server';
import { checkBankConnection, isBankConnected } from '@/lib/bank-api';

export async function GET() {
  if (!isBankConnected()) {
    return NextResponse.json({ connected: false, status: 'not_connected' });
  }

  try {
    const result = await checkBankConnection();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ connected: false, status: 'error', error: (e as Error).message });
  }
}
