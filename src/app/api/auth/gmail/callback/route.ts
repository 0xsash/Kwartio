import { NextRequest, NextResponse } from 'next/server';
import { handleGmailCallback } from '@/lib/gmail';

export async function GET(request: NextRequest) {
  const code = new URL(request.url).searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=gmail_no_code', request.url));
  }

  try {
    const success = await handleGmailCallback(code);
    if (success) {
      return NextResponse.redirect(new URL('/settings?success=gmail_connected', request.url));
    }
    return NextResponse.redirect(new URL('/settings?error=gmail_failed', request.url));
  } catch {
    return NextResponse.redirect(new URL('/settings?error=gmail_failed', request.url));
  }
}
