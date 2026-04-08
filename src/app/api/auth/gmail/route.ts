import { NextResponse } from 'next/server';
import { getGmailAuthUrl } from '@/lib/gmail';

export async function GET() {
  const url = await getGmailAuthUrl();
  if (!url) {
    return NextResponse.json(
      { error: 'Google Client ID/Secret niet ingesteld. Ga naar Instellingen.' },
      { status: 400 }
    );
  }
  return NextResponse.redirect(url);
}
