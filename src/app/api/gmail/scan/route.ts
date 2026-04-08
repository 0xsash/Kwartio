import { NextResponse } from 'next/server';
import { scanInboxForInvoices, isGmailConnected } from '@/lib/gmail';

export async function POST() {
  const connected = await isGmailConnected();
  if (!connected) {
    return NextResponse.json({ error: 'Gmail niet verbonden' }, { status: 400 });
  }

  const result = await scanInboxForInvoices();
  return NextResponse.json(result);
}
