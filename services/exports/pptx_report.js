const PptxGenJS = require('pptxgenjs');

function _truncCell(v, max = 60) {
  const s = (v == null ? '' : String(v));
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildPptx(report) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';        // 13.33 x 7.5
  pres.title = report.title || 'InfoGenie Report';

  // Title slide
  const cover = pres.addSlide();
  cover.background = { color: '1E1B4B' };
  cover.addText(report.title || 'InfoGenie Report', {
    x: 0.6, y: 2.4, w: 12, h: 1.6, fontSize: 44, bold: true, color: 'FFFFFF',
    fontFace: 'Calibri',
  });
  cover.addText('Generated ' + new Date(report.generated_at || Date.now()).toLocaleString(), {
    x: 0.6, y: 4.2, w: 12, h: 0.5, fontSize: 16, color: 'C4B5FD',
  });
  cover.addText('Powered by InfoGenie · AI Marketing Intelligence', {
    x: 0.6, y: 6.6, w: 12, h: 0.4, fontSize: 12, color: '7C3AED', italic: true,
  });

  // Section slides
  for (const sec of report.sections || []) {
    const s = pres.addSlide();
    s.addText(sec.title || 'Section', {
      x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: '1E1B4B',
    });

    if (sec.kind === 'table' && Array.isArray(sec.rows)) {
      const headerRow = (sec.headers || []).map(h => ({
        text: String(h),
        options: { bold: true, color: 'FFFFFF', fill: { color: '1E1B4B' }, align: 'left' },
      }));
      const dataRows = sec.rows.slice(0, 22).map(r => r.map(c => ({
        text: _truncCell(c, 70),
        options: { color: '0A1628', fill: { color: 'FFFFFF' }, align: 'left' },
      })));
      s.addTable([headerRow, ...dataRows], {
        x: 0.4, y: 1.1, w: 12.5, h: 5.8,
        fontSize: 10, fontFace: 'Calibri',
        border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
        rowH: 0.28,
      });
      if (sec.rows.length > 22) {
        s.addText(`(+${sec.rows.length - 22} more rows — see Excel export)`, {
          x: 0.4, y: 7.0, w: 12, h: 0.3, fontSize: 9, italic: true, color: '6B7280',
        });
      }
    } else if (sec.kind === 'text') {
      s.addText(String(sec.body || ''), {
        x: 0.5, y: 1.2, w: 12.3, h: 5.8, fontSize: 14, color: '0A1628',
      });
    }
  }

  return pres;
}

async function streamPptx(report, res, filename = 'infogenie-report.pptx') {
  const pres = buildPptx(report);
  const buf = await pres.write({ outputType: 'nodebuffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

module.exports = { buildPptx, streamPptx };
