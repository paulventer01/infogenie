const PptxGenJS = require('pptxgenjs');

function _truncCell(v, max = 60) {
  const s = (v == null ? '' : String(v));
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function _hex(c, fb) { return /^#[0-9A-Fa-f]{6}$/.test(String(c||'')) ? String(c).slice(1).toUpperCase() : fb; }

function buildPptx(report, brand) {
  brand = brand || {};
  const PRIMARY = _hex(brand.primaryColor, '1E1B4B');
  const ACCENT  = _hex(brand.accentColor,  '7C3AED');
  const TEXT    = _hex(brand.textColor,    '0A1628');
  const showIG  = !brand.hideInfoGenieBranding;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';        // 13.33 x 7.5
  pres.title = report.title || 'Report';

  // Title slide
  const cover = pres.addSlide();
  cover.background = { color: PRIMARY };
  // Optional logo (data URL) — top-left
  if (brand.logoDataUrl) {
    try { cover.addImage({ data: brand.logoDataUrl, x: 0.5, y: 0.4, w: 1.6, h: 1.0, sizing: { type: 'contain', w: 1.6, h: 1.0 } }); } catch {}
  }
  cover.addText(report.title || 'Report', {
    x: 0.6, y: 2.4, w: 12, h: 1.6, fontSize: 44, bold: true, color: 'FFFFFF',
    fontFace: 'Calibri',
  });
  if (brand.agencyName) {
    cover.addText(String(brand.agencyName), {
      x: 0.6, y: 1.6, w: 12, h: 0.6, fontSize: 18, bold: true, color: 'FFFFFF',
    });
  }
  cover.addText('Generated ' + new Date(report.generated_at || Date.now()).toLocaleString(), {
    x: 0.6, y: 4.2, w: 12, h: 0.5, fontSize: 16, color: 'C4B5FD',
  });
  const footer = brand.footerText
    || (showIG ? 'Powered by InfoGenie · AI Marketing Intelligence' : '');
  if (footer) {
    cover.addText(footer, { x: 0.6, y: 6.6, w: 12, h: 0.4, fontSize: 12, color: ACCENT, italic: true });
  }

  // Section slides
  for (const sec of report.sections || []) {
    const s = pres.addSlide();
    s.addText(sec.title || 'Section', {
      x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: PRIMARY,
    });

    if (sec.kind === 'table' && Array.isArray(sec.rows)) {
      const headerRow = (sec.headers || []).map(h => ({
        text: String(h),
        options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'left' },
      }));
      const dataRows = sec.rows.slice(0, 22).map(r => r.map(c => ({
        text: _truncCell(c, 70),
        options: { color: TEXT, fill: { color: 'FFFFFF' }, align: 'left' },
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
        x: 0.5, y: 1.2, w: 12.3, h: 5.8, fontSize: 14, color: TEXT,
      });
    }
  }

  return pres;
}

async function streamPptx(report, res, filename = 'infogenie-report.pptx', brand) {
  const pres = buildPptx(report, brand);
  const buf = await pres.write({ outputType: 'nodebuffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

module.exports = { buildPptx, streamPptx };
