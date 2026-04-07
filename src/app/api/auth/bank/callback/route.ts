import { NextRequest, NextResponse } from 'next/server';
import { checkBankConnection } from '@/lib/bank-api';

export async function GET(request: NextRequest) {
  try {
    const result = await checkBankConnection();
    if (result.connected) {
      return NextResponse.redirect(new URL('/settings?success=bank_connected', request.url));
    }
    return NextResponse.redirect(new URL('/settings?error=bank_pending', request.url));
  } catch {
    return NextResponse.redirect(new URL('/settings?error=bank_failed', request.url));
  }
}
