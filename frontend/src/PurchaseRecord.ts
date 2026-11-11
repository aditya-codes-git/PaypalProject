import { jsPDF } from 'jspdf';
import type { Operation } from './cloud';
import type { Ledger } from './Procurement';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const amount = (cents: number) => usd.format(cents / 100);
const timestamp = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});
const date = (value: string | Date) => `${timestamp.format(new Date(value))} UTC`;

export function savePurchaseRecord(operation: Operation, ledger: Ledger, statusLabel: (status: string) => string) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
  const margin = 44;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const width = pageWidth - margin * 2;
  const funds = new Map(operation.scenario.funds.map(fund => [fund.id, fund.name]));
  const supplies = new Map(operation.scenario.needs.map(need => [need.id, need.name]));
  let y = 0;

  pdf.setProperties({ title: 'ReliefOps Purchase Record', creator: 'ReliefOps' });

  function pageHeader() {
    pdf.setFillColor('#5544B8');
    pdf.rect(0, 0, pageWidth, 5, 'F');
    pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor('#5544B8');
    pdf.text('ReliefOps', margin, 34);
    y = 56;
  }

  function fit(height: number) {
    if (y + height > pageHeight - 54) {
      pdf.addPage();
      pageHeader();
    }
  }

  function paragraph(value: string, size = 11, bold = false, color = '#252438') {
    const content = value.replace(/\s+/gu, ' ').trim();
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color);
    const lineHeight = size * 1.45;
    const fallback = /[^\x20-\x7e\xa0-\xff]/u.test(content);
    const lines: string[] = fallback ? wrapWithBrowserFont(content, size, bold, width) : pdf.splitTextToSize(content, width);
    for (const line of lines) {
      fit(lineHeight);
      pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color);
      if (fallback) {
        const image = renderText(line, size, bold, color);
        const imageWidth = Math.min(image.width / 2, width);
        pdf.addImage(image, 'PNG', margin, y, imageWidth, lineHeight, undefined, 'FAST');
      } else {
        pdf.text(line, margin, y + size);
      }
      y += lineHeight;
    }
  }

  function section(title: string) {
    fit(68);
    y += 15;
    pdf.setDrawColor('#DBD9E7').line(margin, y, pageWidth - margin, y);
    y += 9;
    paragraph(title, 15, true);
    y += 5;
  }

  pageHeader();
  paragraph('Purchase record', 29, true);
  paragraph(operation.name, 16, true);
  paragraph(`Exported ${date(new Date())} | PayPal sandbox | USD`);
  paragraph(`Operation ID: ${operation.id} | Revision ${operation.revision}`, 10, false, '#5A5871');

  section('Purchases');
  if (!ledger.purchases.length) paragraph('No approved purchases yet.');
  for (const purchase of ledger.purchases) {
    fit(75);
    paragraph(purchase.supplier, 13, true);
    const supply = purchase.supply_name ?? supplies.get(purchase.need_id) ?? purchase.need_id;
    paragraph(`${purchase.quantity} × ${supply} | ${amount(purchase.cost_cents)} | ${statusLabel(purchase.status)}`);
    paragraph(`Purchase ID: ${purchase.id}`, 10);
    if (purchase.order_id) paragraph(`PayPal order: ${purchase.order_id}`);
    if (purchase.capture_id) paragraph(`PayPal payment: ${purchase.capture_id}`);
    if (purchase.refund_id) paragraph(`PayPal refund: ${purchase.refund_id}`);
    for (const allocation of purchase.allocations ?? []) {
      paragraph(`Funding: ${funds.get(allocation.fund_id) ?? allocation.fund_id} | ${amount(allocation.amount_cents)}`);
    }
    if (purchase.supplier_confirmation) {
      paragraph(`Supplier reference: ${purchase.supplier_confirmation.supplier_reference}`);
      if (purchase.supplier_confirmation.invoice_reference) {
        paragraph(`Invoice reference: ${purchase.supplier_confirmation.invoice_reference}`);
      }
    }
    const receipts = purchase.receipts ?? [];
    if (receipts.length || purchase.delivery_closed) {
      const accepted = receipts.reduce((total, receipt) => total + receipt.accepted_units, 0);
      paragraph(`Delivery: ${accepted} of ${purchase.quantity} received | ${purchase.delivery_closed ? 'Closed' : 'Open'}`);
      for (const receipt of receipts) {
        paragraph(`Receipt ${receipt.reference} | ${receipt.location} | ${receipt.accepted_units} accepted, ${receipt.rejected_units} rejected | ${date(receipt.at)}`, 10);
      }
    }
    y += 12;
  }

  const balances = Object.entries(ledger.balances);
  if (balances.length) {
    section('Funding balances');
    for (const [id, balance] of balances) {
      fit(40);
      paragraph(funds.get(id) ?? id, 11, true);
      paragraph(`${amount(balance.opening_cents)} budget | ${amount(balance.reserved_cents)} reserved | ${amount(balance.spent_cents)} spent | ${amount(balance.available_cents)} available`, 10);
      y += 5;
    }
  }

  const sources = ledger.documents.filter(document => document.confirmed.length);
  if (sources.length) {
    section('Confirmed grant documents');
    for (const source of sources) {
      fit(46);
      paragraph(source.filename, 11, true);
      for (const index of source.confirmed) {
        const proposal = source.proposals.funds[index];
        if (proposal) paragraph(`${proposal.name} | Page ${proposal.page}`, 10);
      }
      paragraph(`Document SHA-256: ${source.hash}`, 9);
      y += 5;
    }
  }

  if (ledger.events.length) {
    section('Purchase activity');
    for (const event of ledger.events) {
      fit(42);
      paragraph(date(event.at), 9, true, '#5A5871');
      paragraph(event.message, 10);
      y += 6;
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor('#5A5871');
    pdf.text('ReliefOps | Purchase record', margin, pageHeight - 25);
    pdf.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 25, { align: 'right' });
  }
  pdf.save(`reliefops-purchase-record-${operation.id}.pdf`);
}

// Built-in PDF fonts cover Latin text. Let the browser render other scripts using its font fallback.
function wrapWithBrowserFont(value: string, size: number, bold: boolean, width: number) {
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = browserFont(size, bold);
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  return [...lines, line];
}

function browserFont(size: number, bold: boolean) {
  return `${bold ? 'bold' : 'normal'} ${size}px Arial, sans-serif`;
}

function renderText(value: string, size: number, bold: boolean, color: string) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  context.font = browserFont(size, bold);
  canvas.width = Math.ceil(context.measureText(value).width * 2 + 4);
  canvas.height = Math.ceil(size * 1.45 * 2);
  context.scale(2, 2);
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
  context.font = browserFont(size, bold);
  context.fillStyle = color;
  context.fillText(value, 0, size);
  return canvas;
}
