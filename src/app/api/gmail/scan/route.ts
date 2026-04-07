import { NextResponse } from 'next/server';
import { scanInboxForInvoices, isGmailConnected } from '@/lib/gmail';

export async function POST() {
  if (!isGmailConnected()) {
    return NextResponse.json({ error: 'Gmail niet verbonden' }, { status: 400 });
  }

  const result = await scanInboxForInvoices();
  return NextResponse.json(result);
}
