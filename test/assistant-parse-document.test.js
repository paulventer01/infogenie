'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { extractWordText } = require('../services/assistant_ops/parse_document');

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('extractWordText reads .docx content', async () => {
  const buffer = await makeDocx('Follow these campaign instructions.');
  const result = await extractWordText({
    buffer,
    size: buffer.length,
    originalname: 'brief.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.equal(result.name, 'brief.docx');
  assert.match(result.text, /Follow these campaign instructions/);
  assert.equal(result.truncated, false);
});

test('extractWordText rejects legacy .doc', async () => {
  const buffer = Buffer.from('fake');
  await assert.rejects(
    () => extractWordText({
      buffer,
      size: buffer.length,
      originalname: 'old.doc',
      mimetype: 'application/msword',
    }),
    (err) => err.message.includes('.docx'),
  );
});
