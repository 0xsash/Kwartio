import { NextResponse } from 'next/server';
import { processGmailBatch, isGmailConnected } from '@/lib/gmail';

// Step 2: Process a small batch of messages (download attachments)
export async function POST() {
  const connected = await isGmailConnected();
  if (!connected) {
    return NextResponse.json({ error: 'Gmail niet verbonden' }, { status: 400 });
  }

  const result = await processGmailBatch(3);
  return NextResponse.json(result);
}
