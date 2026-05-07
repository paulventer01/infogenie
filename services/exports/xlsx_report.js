const ExcelJS = require('exceljs');

async function streamXlsx(report, res, filename = 'infogenie-report.xlsx') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InfoGenie';
  wb.created = new Date();

  // Cover sheet
  const cover = wb.addWorksheet('Overview');
  cover.columns = [{ width: 30 }, { width: 80 }];
  cover.getCell('A1').value = report.title || 'InfoGenie Report';
  cover.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FF1E1B4B' } };
  cover.getCell('A3').value = 'Generated';
  cover.getCell('B3').value = new Date(report.generated_at || Date.now()).toLocaleString();
  cover.getCell('A4').value = 'Sections';
  cover.getCell('B4').value = (report.sections || []).map(s => s.title).join(' · ');

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
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
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
