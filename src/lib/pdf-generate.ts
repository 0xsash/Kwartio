import PDFDocument from 'pdfkit';
import db, { type Transaction } from './db';

type Settings = Record<string, string>;

export async function generateBankStatementPDF(
  year: number,
  quarter: string,
  settings: Settings
): Promise<Buffer> {
  const transactions = db
    .prepare(
      "SELECT * FROM transactions WHERE year = ? AND quarter = ? AND classification = 'professional' ORDER BY date ASC"
    )
    .all(year, quarter) as Transaction[];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('Bankafschrift', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`${quarter} ${year}`, { align: 'center' });
    doc.moveDown();

    // Business details
    if (settings.business_name) {
      doc.fontSize(10).font('Helvetica-Bold').text(settings.business_name);
    }
    if (settings.vat_number) {
      doc.fontSize(9).font('Helvetica').text(`BTW: ${settings.vat_number}`);
    }
    if (settings.address_line1) {
      doc.text(settings.address_line1);
    }
    if (settings.postal_code || settings.city) {
      doc.text(`${settings.postal_code || ''} ${settings.city || ''}`.trim());
    }
    doc.moveDown();

    // Table header
    const tableTop = doc.y;
    const colX = { date: 50, counterparty: 130, description: 270, debit: 390, credit: 460, balance: 510 };

    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Datum', colX.date, tableTop);
    doc.text('Tegenpartij', colX.counterparty, tableTop);
    doc.text('Omschrijving', colX.description, tableTop);
    doc.text('Debet', colX.debit, tableTop, { width: 60, align: 'right' });
    doc.text('Credit', colX.credit, tableTop, { width: 60, align: 'right' });
    doc.text('Saldo', colX.balance, tableTop, { width: 60, align: 'right' });

    doc
      .moveTo(50, tableTop + 12)
      .lineTo(570, tableTop + 12)
      .stroke();

    // Table rows
    let y = tableTop + 18;
    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    doc.font('Helvetica').fontSize(7);

    for (const tx of transactions) {
      if (y > 750) {
        doc.addPage();
        y = 50;
      }

      runningBalance += tx.amount;
      if (tx.amount < 0) totalDebit += Math.abs(tx.amount);
      else totalCredit += tx.amount;

      doc.text(tx.date, colX.date, y, { width: 75 });
      doc.text((tx.counterparty || '').substring(0, 22), colX.counterparty, y, { width: 135 });
      doc.text((tx.description || '').substring(0, 20), colX.description, y, { width: 115 });

      if (tx.amount < 0) {
        doc.text(formatEur(Math.abs(tx.amount)), colX.debit, y, { width: 60, align: 'right' });
        doc.text('', colX.credit, y, { width: 60, align: 'right' });
      } else {
        doc.text('', colX.debit, y, { width: 60, align: 'right' });
        doc.text(formatEur(tx.amount), colX.credit, y, { width: 60, align: 'right' });
      }
      doc.text(formatEur(runningBalance), colX.balance, y, { width: 60, align: 'right' });

      y += 14;
    }

    // Totals
    y += 6;
    doc
      .moveTo(50, y)
      .lineTo(570, y)
      .stroke();
    y += 6;

    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Totaal', colX.date, y);
    doc.text(formatEur(totalDebit), colX.debit, y, { width: 60, align: 'right' });
    doc.text(formatEur(totalCredit), colX.credit, y, { width: 60, align: 'right' });
    doc.text(formatEur(runningBalance), colX.balance, y, { width: 60, align: 'right' });

    y += 20;
    doc.font('Helvetica').fontSize(8);
    doc.text(`${transactions.length} transacties | Gegenereerd door Kwartio`, 50, y, { align: 'center' });

    doc.end();
  });
}

export async function generateCoverSheetPDF(
  year: number,
  quarter: string,
  settings: Settings,
  summary: {
    invoiceCount: number;
    transactionCount: number;
    totalAmount: number;
    totalVat: number;
    categories: Array<{ name: string; count: number; total: number }>;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('Kwartaalpakket', { align: 'center' });
    doc.fontSize(16).font('Helvetica').text(`${quarter} ${year}`, { align: 'center' });
    doc.moveDown(2);

    // Business details
    doc.fontSize(12).font('Helvetica-Bold').text('Bedrijfsgegevens');
    doc.moveTo(50, doc.y).lineTo(250, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    if (settings.business_name) doc.text(`Naam: ${settings.business_name}`);
    if (settings.vat_number) doc.text(`BTW-nummer: ${settings.vat_number}`);
    if (settings.address_line1) doc.text(`Adres: ${settings.address_line1}`);
    if (settings.postal_code || settings.city) {
      doc.text(`${settings.postal_code || ''} ${settings.city || ''}`.trim());
    }
    if (settings.email) doc.text(`E-mail: ${settings.email}`);
    if (settings.phone) doc.text(`Telefoon: ${settings.phone}`);
    doc.moveDown(1.5);

    // Summary
    doc.fontSize(12).font('Helvetica-Bold').text('Overzicht');
    doc.moveTo(50, doc.y).lineTo(250, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Professionele facturen: ${summary.invoiceCount}`);
    doc.text(`Professionele transacties: ${summary.transactionCount}`);
    doc.text(`Totaalbedrag (incl. BTW): ${formatEur(summary.totalAmount)}`);
    doc.text(`Totaal BTW: ${formatEur(summary.totalVat)}`);
    doc.text(`Netto (excl. BTW): ${formatEur(summary.totalAmount - summary.totalVat)}`);
    doc.moveDown(1.5);

    // Category breakdown
    if (summary.categories.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').text('Per categorie');
      doc.moveTo(50, doc.y).lineTo(250, doc.y).stroke();
      doc.moveDown(0.5);

      doc.fontSize(9).font('Helvetica-Bold');
      const catY = doc.y;
      doc.text('Categorie', 50, catY, { width: 200 });
      doc.text('Aantal', 260, catY, { width: 60, align: 'right' });
      doc.text('Totaal', 330, catY, { width: 80, align: 'right' });
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(9);
      for (const cat of summary.categories) {
        const cy = doc.y;
        doc.text(cat.name, 50, cy, { width: 200 });
        doc.text(cat.count.toString(), 260, cy, { width: 60, align: 'right' });
        doc.text(formatEur(cat.total), 330, cy, { width: 80, align: 'right' });
        doc.moveDown(0.2);
      }
      doc.moveDown(1.5);
    }

    // Contents
    doc.fontSize(12).font('Helvetica-Bold').text('Inhoud pakket');
    doc.moveTo(50, doc.y).lineTo(250, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.list([
      'Voorblad (dit document)',
      'Excel overzicht (Samenvatting, Facturen, Transacties, BTW)',
      `Facturen (${summary.invoiceCount} PDF's per categorie)`,
      'Bankafschrift (PDF)',
    ]);

    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#888888');
    doc.text(`Gegenereerd door Kwartio op ${new Date().toLocaleDateString('nl-BE')}`, { align: 'center' });

    doc.end();
  });
}

function formatEur(n: number): string {
  return `\u20AC${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
