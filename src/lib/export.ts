import db, { type Invoice, type Transaction } from './db';
import * as XLSX from 'xlsx';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

const CATEGORY_LABELS: Record<string, string> = {
  software: 'Software & Licenties',
  hosting: 'Hosting & Cloud',
  telecom: 'Telecom & Internet',
  office_supplies: 'Kantoorbenodigdheden',
  travel: 'Reiskosten',
  insurance: 'Verzekeringen',
  professional_services: 'Professionele Diensten',
  marketing: 'Marketing & Reclame',
  subscriptions: 'Abonnementen',
  hardware: 'Hardware & Apparatuur',
  utilities: 'Nutsvoorzieningen',
  meals: 'Maaltijden & Representatie',
  transport: 'Transport',
  other: 'Overige',
};

const VAT_CODES: Record<number, string> = {
  0: '0% BTW',
  6: '6% BTW',
  12: '12% BTW',
  21: '21% BTW',
};

export async function generateQuarterlyExport(year: number, quarter: string): Promise<string> {
  const exportDir = path.join(process.cwd(), 'data', 'exports');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const zipPath = path.join(exportDir, `Kwartio_${year}_${quarter}.zip`);

  const invoices = db.prepare(
    "SELECT * FROM invoices WHERE year = ? AND quarter = ? AND classification = 'professional' ORDER BY invoice_date"
  ).all(year, quarter) as Invoice[];

  const transactions = db.prepare(
    "SELECT t.*, i.vendor as matched_vendor, i.original_filename as matched_invoice FROM transactions t LEFT JOIN invoices i ON t.matched_invoice_id = i.id WHERE t.year = ? AND t.quarter = ? AND t.classification = 'professional' ORDER BY t.date"
  ).all(year, quarter) as (Transaction & { matched_vendor: string | null; matched_invoice: string | null })[];

  // Build Excel workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Overview / Samenvatting
  const summaryData: Record<string, unknown>[] = [];
  const categoryTotals = new Map<string, { count: number; total: number; vat: number }>();

  for (const inv of invoices) {
    const cat = inv.category || 'other';
    const existing = categoryTotals.get(cat) || { count: 0, total: 0, vat: 0 };
    existing.count++;
    existing.total += inv.amount || 0;
    existing.vat += inv.vat_amount || 0;
    categoryTotals.set(cat, existing);
  }

  summaryData.push({
    'Kwartaal': `${quarter} ${year}`,
    'Categorie': '',
    'Aantal': '',
    'Totaal excl. BTW': '',
    'BTW': '',
    'Totaal incl. BTW': '',
  });

  let grandTotal = 0;
  let grandVat = 0;

  for (const [cat, data] of categoryTotals.entries()) {
    grandTotal += data.total;
    grandVat += data.vat;
    summaryData.push({
      'Kwartaal': '',
      'Categorie': CATEGORY_LABELS[cat] || cat,
      'Aantal': data.count,
      'Totaal excl. BTW': roundTwo(data.total - data.vat),
      'BTW': roundTwo(data.vat),
      'Totaal incl. BTW': roundTwo(data.total),
    });
  }

  summaryData.push({
    'Kwartaal': '',
    'Categorie': 'TOTAAL',
    'Aantal': invoices.length,
    'Totaal excl. BTW': roundTwo(grandTotal - grandVat),
    'BTW': roundTwo(grandVat),
    'Totaal incl. BTW': roundTwo(grandTotal),
  });

  const ws1 = XLSX.utils.json_to_sheet(summaryData);
  ws1['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 12 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Samenvatting');

  // Sheet 2: All invoices
  const invoiceRows = invoices.map((inv, i) => ({
    '#': i + 1,
    'Datum': inv.invoice_date || '',
    'Leverancier': inv.vendor || '',
    'Factuurnummer': inv.invoice_number || '',
    'Omschrijving': inv.description || '',
    'Categorie': CATEGORY_LABELS[inv.category || 'other'] || inv.category || '',
    'Bedrag excl. BTW': roundTwo((inv.amount || 0) - (inv.vat_amount || 0)),
    'BTW %': inv.vat_rate ? `${inv.vat_rate}%` : '',
    'BTW Bedrag': roundTwo(inv.vat_amount || 0),
    'Totaal': roundTwo(inv.amount || 0),
    'BTW Code': inv.vat_rate ? (VAT_CODES[inv.vat_rate] || `${inv.vat_rate}% BTW`) : '',
    'Bestandsnaam': inv.original_filename,
  }));

  const ws2 = XLSX.utils.json_to_sheet(invoiceRows);
  ws2['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 25 }, { wch: 18 }, { wch: 35 },
    { wch: 25 }, { wch: 16 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Facturen');

  // Sheet 3: All professional transactions
  const txRows = transactions.map((tx, i) => ({
    '#': i + 1,
    'Datum': tx.date,
    'Omschrijving': tx.description || '',
    'Tegenpartij': tx.counterparty || '',
    'Bedrag': roundTwo(tx.amount),
    'Categorie': CATEGORY_LABELS[tx.category || 'other'] || tx.category || '',
    'Gekoppelde Factuur': tx.matched_invoice || '',
    'Referentie': tx.reference || '',
  }));

  const ws3 = XLSX.utils.json_to_sheet(txRows);
  ws3['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 35 }, { wch: 25 },
    { wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'Transacties');

  // Sheet 4: BTW summary per rate
  const vatByRate = new Map<number, { base: number; vat: number; count: number }>();
  for (const inv of invoices) {
    if (inv.vat_rate != null && inv.amount != null) {
      const rate = inv.vat_rate;
      const existing = vatByRate.get(rate) || { base: 0, vat: 0, count: 0 };
      existing.base += (inv.amount - (inv.vat_amount || 0));
      existing.vat += (inv.vat_amount || 0);
      existing.count++;
      vatByRate.set(rate, existing);
    }
  }

  const vatRows = Array.from(vatByRate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, data]) => ({
      'BTW Tarief': `${rate}%`,
      'Aantal Facturen': data.count,
      'Basis (excl. BTW)': roundTwo(data.base),
      'BTW Bedrag': roundTwo(data.vat),
      'Totaal (incl. BTW)': roundTwo(data.base + data.vat),
    }));

  const ws4 = XLSX.utils.json_to_sheet(vatRows);
  ws4['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'BTW Overzicht');

  // Write Excel to buffer
  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Create ZIP
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);

    // Add Excel file
    archive.append(Buffer.from(excelBuffer), {
      name: `Kwartio_${year}_${quarter}_Boekhouding.xlsx`,
    });

    // Add invoice PDFs/images in organized folders
    for (const inv of invoices) {
      const filePath = path.join(process.cwd(), 'uploads', inv.file_path);
      if (fs.existsSync(filePath)) {
        const cat = CATEGORY_LABELS[inv.category || 'other'] || 'Overige';
        const safeVendor = (inv.vendor || 'Onbekend').replace(/[^a-zA-Z0-9\s-]/g, '');
        const ext = path.extname(inv.original_filename);
        const fileName = `${inv.invoice_date || 'geen_datum'}_${safeVendor}_€${inv.amount?.toFixed(2) || '0.00'}${ext}`;
        archive.file(filePath, { name: `Facturen/${cat}/${fileName}` });
      }
    }

    archive.finalize();
  });
}

function roundTwo(n: number): number {
  return Math.round(n * 100) / 100;
}
