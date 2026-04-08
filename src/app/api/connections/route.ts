import { NextResponse } from 'next/server';
import { isGmailConnected } from '@/lib/gmail';
import { isBankConnected } from '@/lib/bank-api';
import { getSetting } from '@/lib/db';

export async function GET() {
  const [gmailConnected, bankConnected, gmailLastScan, bankLastSync, googleClientId, googleClientSecret, nordigenSecretId, nordigenSecretKey] = await Promise.all([
    isGmailConnected(),
    isBankConnected(),
    getSetting('gmail_last_scan'),
    getSetting('bank_last_sync'),
    getSetting('google_client_id'),
    getSetting('google_client_secret'),
    getSetting('nordigen_secret_id'),
    getSetting('nordigen_secret_key'),
  ]);

  return NextResponse.json({
    gmail: {
      connected: gmailConnected,
      lastScan: gmailLastScan,
      configured: !!(googleClientId && googleClientSecret),
    },
    bank: {
      connected: bankConnected,
      lastSync: bankLastSync,
      configured: !!(nordigenSecretId && nordigenSecretKey),
    },
  });
}
