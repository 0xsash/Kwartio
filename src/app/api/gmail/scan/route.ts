import { NextResponse } from 'next/server';
import { scanInboxMessageIds, isGmailConnected } from '@/lib/gmail';

// Step 1: Quick scan — just find message IDs (no downloads)
export async function POST() {
  const connected = await isGmailConnected();
  if (!connected) {
    return NextResponse.json({ error: 'Gmail niet verbonden' }, { status: 400 });
  }

  const result = await scanInboxMessageIds();
  return NextResponse.json({
    found: result.messageIds.length,
    errors: result.errors,
  });
}
