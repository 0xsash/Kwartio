import { NextResponse } from 'next/server';
import { isGmailConnected } from '@/lib/gmail';
import { isBankConnected } from '@/lib/bank-api';
import { getSetting } from '@/lib/db';

export async function GET() {
  return NextResponse.json({
    gmail: {
      connected: isGmailConnected(),
      lastScan: getSetting('gmail_last_scan'),
      configured: !!(getSetting('google_client_id') && getSetting('google_client_secret')),
    },
    bank: {
      connected: isBankConnected(),
      lastSync: getSetting('bank_last_sync'),
      configured: !!(getSetting('nordigen_secret_id') && getSetting('nordigen_secret_key')),
    },
  });
}
