'use strict';

const mammoth = require('mammoth');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 50000;

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', // some browsers send zip for .docx
]);
const DOC_MIMES = new Set(['application/msword']);

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function isWordUpload(file) {
  if (!file) return false;
  const ext = extOf(file.originalname);
  if (ext === 'docx') return true;
  if (ext === 'doc') return true;
  const mime = String(file.mimetype || '').toLowerCase();
  return DOCX_MIMES.has(mime) || DOC_MIMES.has(mime);
}

async function extractWordText(file) {
  if (!file || !file.buffer) {
    throw Object.assign(new Error('missing-file'), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    throw Object.assign(new Error('file-too-large'), { status: 413 });
  }
  if (!isWordUpload(file)) {
    throw Object.assign(new Error('unsupported-file-type'), { status: 415 });
  }

  const ext = extOf(file.originalname);
  if (ext === 'doc' || DOC_MIMES.has(String(file.mimetype || '').toLowerCase())) {
    throw Object.assign(
      new Error('legacy-doc-format'),
      {
        status: 415,
        message:
          'Legacy .doc files are not supported. Please save as .docx in Word and upload again.',
      },
    );
  }

  const { value } = await mammoth.extractRawText({ buffer: file.buffer });
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    throw Object.assign(new Error('empty-document'), {
      status: 422,
      message: 'No readable text was found in that document.',
    });
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    name: file.originalname || 'document.docx',
    text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
    chars: text.length,
    truncated,
  };
}

module.exports = { extractWordText, isWordUpload, MAX_BYTES };
