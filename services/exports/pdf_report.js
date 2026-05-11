const PDFDocument = require('pdfkit');

function _trunc(v, max) {
  const s = (v == null ? '' : String(v));
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function _safeColor(c, fb) { return /^#[0-9A-Fa-f]{6}$/.test(String(c||'')) ? c : fb; }

function streamPdf(report, res, filename = 'infogenie-report.pdf', brand) {
  brand = brand || {};
  const PRIMARY = _safeColor(brand.primaryColor, '#1E1B4B');
  const ACCENT  = _safeColor(brand.accentColor,  '#7C3AED');
  const TEXT    = _safeColor(brand.textColor,    '#0A1628');
  const author  = brand.agencyName || 'InfoGenie';
  const showIG  = !brand.hideInfoGenieBranding;
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: report.title || 'Report', Author: author } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // Cover
  doc.rect(0, 0, doc.page.width, 200).fill(PRIMARY);
  // Optional logo (data URL: png/jpg only — pdfkit can't render svg)
  if (brand.logoDataUrl && /^data:image\/(png|jpeg|jpg);base64,/.test(brand.logoDataUrl)) {
    try {
      const b64 = brand.logoDataUrl.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      doc.image(buf, 36, 24, { fit: [120, 40] });
    } catch {}
  }
  doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold')
     .text(report.title || 'Report', 36, 70, { width: doc.page.width - 72 });
  if (brand.agencyName) {
    doc.fillColor('#FFFFFF').fontSize(13).font('Helvetica-Bold')
       .text(String(brand.agencyName), 36, 110);
  }
  doc.fillColor('#C4B5FD').fontSize(11).font('Helvetica')
     .text('Generated ' + new Date(report.generated_at || Date.now()).toLocaleString(), 36, brand.agencyName ? 150 : 130);
  doc.fillColor('#000000').moveDown(8);
  // Footer line under cover band
  const footer = brand.footerText || (showIG ? 'Powered by InfoGenie · AI Marketing Intelligence' : '');
  if (footer) {
    doc.fillColor(ACCENT).fontSize(9).font('Helvetica-Oblique')
       .text(footer, 36, 178, { width: doc.page.width - 72 });
    doc.fillColor('#000000');
  }

  for (const sec of report.sections || []) {
    if (doc.y > 720) doc.addPage();
    doc.fillColor(PRIMARY).fontSize(16).font('Helvetica-Bold').text(sec.title || 'Section', 36, doc.y);
    doc.moveDown(0.4);
    doc.fillColor('#000000').fontSize(9).font('Helvetica');

    if (sec.kind === 'table' && Array.isArray(sec.rows)) {
      const headers = sec.headers || [];
      const colCount = Math.max(headers.length, (sec.rows[0] || []).length, 1);
      const colW = (doc.page.width - 72) / colCount;
      const rowH = 16;
      const drawRow = (cells, isHeader) => {
        if (doc.y + rowH > doc.page.height - 36) {
          doc.addPage();
          doc.fillColor('#000000').fontSize(9).font('Helvetica');
        }
        const y = doc.y;
        if (isHeader) doc.rect(36, y, colW * colCount, rowH).fill(PRIMARY);
        doc.fillColor(isHeader ? '#FFFFFF' : TEXT)
           .font(isHeader ? 'Helvetica-Bold' : 'Helvetica');
        cells.forEach((c, i) => {
          const maxChars = Math.max(8, Math.floor(colW / 5.2));
          doc.text(_trunc(c, maxChars), 38 + i * colW, y + 3, { width: colW - 4, height: rowH - 4, ellipsis: true });
        });
        doc.fillColor('#000000');
        doc.y = y + rowH;
        if (!isHeader) doc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(36, doc.y).lineTo(36 + colW * colCount, doc.y).stroke();
      };
      if (headers.length) drawRow(headers, true);
      for (const r of sec.rows.slice(0, 200)) drawRow(r, false);
      if (sec.rows.length > 200) doc.fillColor('#6B7280').fontSize(8).text(`(+${sec.rows.length - 200} more rows in Excel export)`, 36, doc.y + 4);
      doc.moveDown(1.2);
    } else if (sec.kind === 'text') {
      doc.fillColor(TEXT).fontSize(11).font('Helvetica').text(String(sec.body || ''), { width: doc.page.width - 72 });
      doc.moveDown(1);
    }
  }

  doc.end();
}

module.exports = { streamPdf };
