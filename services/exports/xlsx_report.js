const ExcelJS = require('exceljs');

function _argb(c, fb) { return 'FF' + (/^#[0-9A-Fa-f]{6}$/.test(String(c||'')) ? String(c).slice(1).toUpperCase() : fb); }

async function streamXlsx(report, res, filename = 'infogenie-report.xlsx', brand) {
  brand = brand || {};
  const PRIMARY = _argb(brand.primaryColor, '1E1B4B');
  const wb = new ExcelJS.Workbook();
  wb.creator = brand.agencyName || 'InfoGenie';
  wb.created = new Date();

  // Cover sheet
  const cover = wb.addWorksheet('Overview');
  cover.columns = [{ width: 30 }, { width: 80 }];
  cover.getCell('A1').value = report.title || 'Report';
  cover.getCell('A1').font = { size: 18, bold: true, color: { argb: PRIMARY } };
  let row = 3;
  if (brand.agencyName) { cover.getCell('A' + row).value = 'Prepared by'; cover.getCell('B' + row).value = brand.agencyName; row++; }
  cover.getCell('A' + row).value = 'Generated'; cover.getCell('B' + row).value = new Date(report.generated_at || Date.now()).toLocaleString(); row++;
  cover.getCell('A' + row).value = 'Sections';  cover.getCell('B' + row).value = (report.sections || []).map(s => s.title).join(' · '); row++;
  if (brand.footerText) { cover.getCell('A' + row).value = 'Footer'; cover.getCell('B' + row).value = brand.footerText; }

  for (const sec of report.sections || []) {
    if (sec.kind !== 'table' || !Array.isArray(sec.rows)) continue;
    const safeName = String(sec.title || 'Sheet').replace(/[\\/?*[\]:]/g, '').slice(0, 30) || 'Sheet';
    let name = safeName, n = 1;
    while (wb.worksheets.find(w => w.name === name)) { name = (safeName + '_' + (++n)).slice(0, 30); }
    const ws = wb.addWorksheet(name);
    if (sec.headers && sec.headers.length) {
      ws.addRow(sec.headers);
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
      headerRow.alignment = { vertical: 'middle' };
    }
    for (const r of sec.rows) ws.addRow(r);
    ws.columns.forEach((col, i) => {
      let max = String((sec.headers || [])[i] || '').length;
      sec.rows.forEach(r => { const c = String(r[i] == null ? '' : r[i]); if (c.length > max) max = c.length; });
      col.width = Math.min(Math.max(max + 2, 12), 60);
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { streamXlsx };
