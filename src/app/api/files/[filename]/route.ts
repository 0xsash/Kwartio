import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  const { data, error } = await supabase.storage
    .from('invoices')
    .download(filename);

  if (error || !data) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const contentTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
  };

  const buffer = Buffer.from(await data.arrayBuffer());
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
    },
  });
}
