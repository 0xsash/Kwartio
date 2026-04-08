import { NextResponse } from 'next/server';
import { syncBankTransactions, isBankConnected } from '@/lib/bank-api';

export async function POST() {
  const connected = await isBankConnected();
  if (!connected) {
    return NextResponse.json({ error: 'Bank niet verbonden' }, { status: 400 });
  }

  try {
    const result = await syncBankTransactions();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
