'use strict';

const mammoth = require('mammoth');

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 200000;

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function kindFromFile(file) {
  const ext = extOf(file?.originalname || file?.name);
  const mime = String(file?.mimetype || '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'csv' || mime === 'text/csv' || mime === 'application/vnd.ms-excel') return 'csv';
  if (ext === 'txt' || ext === 'md' || mime.startsWith('text/')) return 'txt';
  return null;
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return cleanText(data.text || '');
  } catch (e) {
    // Minimal fallback for text-heavy PDFs when pdf-parse fails.
    const raw = buffer.toString('latin1');
    const parts = [];
    const re = /\((?:\\.|[^\\)]){2,}\)(?=\s*(?:Tj|TJ))/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const s = m[0]
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[A-Za-z0-9]/.test(s)) parts.push(s);
    }
    const text = cleanText(parts.join(' '));
    if (!text) throw Object.assign(new Error('pdf-extract-failed'), { status: 422, cause: e });
    return text;
  }
}

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return cleanText(value);
}

function extractCsv(buffer) {
  const text = cleanText(buffer.toString('utf8'));
  // Keep CSV readable for embedding — prefix with a short header note.
  return text ? `CSV document\n${text}` : '';
}

function extractTxt(buffer) {
  return cleanText(buffer.toString('utf8'));
}

async function extractDocumentText(file) {
  if (!file || !file.buffer) {
    throw Object.assign(new Error('missing-file'), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    throw Object.assign(new Error('file-too-large'), { status: 413, message: `Max upload size is ${MAX_BYTES / (1024 * 1024)}MB` });
  }
  const kind = kindFromFile(file);
  if (!kind) {
    throw Object.assign(new Error('unsupported-file-type'), {
      status: 415,
      message: 'Supported types: PDF, DOCX, CSV, TXT, MD',
    });
  }

  let text = '';
  if (kind === 'pdf') text = await extractPdf(file.buffer);
  else if (kind === 'docx') text = await extractDocx(file.buffer);
  else if (kind === 'csv') text = extractCsv(file.buffer);
  else text = extractTxt(file.buffer);

  if (!text) {
    throw Object.assign(new Error('empty-document'), {
      status: 422,
      message: 'No readable text was found in that file.',
    });
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    kind,
    name: file.originalname || file.name || `document.${kind}`,
    text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
    chars: text.length,
    truncated,
    dataType: `document_${kind === 'md' ? 'txt' : kind}`,
  };
}

module.exports = {
  extractDocumentText,
  kindFromFile,
  MAX_BYTES,
  MAX_TEXT_CHARS,
};
