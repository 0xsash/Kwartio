import { NextResponse } from 'next/server';
import { extractPendingInvoices } from '@/lib/gmail';

export async function POST() {
  const result = await extractPendingInvoices();
  return NextResponse.json(result);
}
