import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const client = new Anthropic();

const EXTRACTION_PROMPT = `You are analyzing an invoice/receipt image. Extract the following information and return it as JSON only (no markdown, no explanation):

{
  "vendor": "Company/store name",
  "amount": 123.45,
  "vat_amount": 25.92,
  "vat_rate": 21,
  "currency": "EUR",
  "invoice_date": "2026-01-15",
  "invoice_number": "INV-2026-001",
  "description": "Brief description of what was purchased",
  "category": "one of: software, hosting, telecom, office_supplies, travel, insurance, professional_services, marketing, subscriptions, hardware, utilities, meals, transport, other",
  "line_items": [
    {"description": "Item name", "amount": 100.00, "vat": 21.00}
  ]
}

Rules:
- All amounts should be numbers (not strings)
- Dates in YYYY-MM-DD format
- If you can't determine a field, use null
- VAT rate is the percentage (e.g., 21 for 21%)
- For Belgian invoices, common VAT rates are 6%, 12%, and 21%
- Currency should be ISO code (EUR, USD, etc.)
- Category should match one of the listed options exactly
- Return ONLY the JSON object, nothing else`;

export async function extractInvoiceData(filePath: string): Promise<Record<string, unknown>> {
  const absolutePath = path.resolve(filePath);
  const fileBuffer = fs.readFileSync(absolutePath);
  const base64 = fileBuffer.toString('base64');

  const ext = path.extname(filePath).toLowerCase();
  const isPdf = ext === '.pdf';

  let imageMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (!isPdf) {
    switch (ext) {
      case '.png':
        imageMediaType = 'image/png';
        break;
      case '.webp':
        imageMediaType = 'image/webp';
        break;
      case '.gif':
        imageMediaType = 'image/gif';
        break;
    }
  }

  const contentBlock: Anthropic.Messages.ContentBlockParam = isPdf
    ? {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: base64,
        },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: imageMediaType,
          data: base64,
        },
      };

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from response, handling potential markdown wrapping
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr);
}
