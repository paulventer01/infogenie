'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunkText, formatChunkContent } = require('../services/document_rag/chunk');
const { kindFromFile, extractDocumentText } = require('../services/document_rag/extract');

test('chunkText splits long text into overlapping pieces', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ${'word '.repeat(30)}`).join('\n\n');
  const chunks = chunkText(text, { size: 400, overlap: 40 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length > 0));
});

test('formatChunkContent includes provenance header', () => {
  const out = formatChunkContent({
    title: 'Brand.pdf',
    kind: 'pdf',
    sourceLabel: 'Uploaded document',
    chunk: 'Hello world',
    index: 0,
    total: 2,
  });
  assert.match(out, /Brand\.pdf/);
  assert.match(out, /Chunk 1\/2/);
  assert.match(out, /Hello world/);
});

test('kindFromFile detects pdf/docx/csv', () => {
  assert.equal(kindFromFile({ originalname: 'a.pdf', mimetype: 'application/pdf' }), 'pdf');
  assert.equal(kindFromFile({ originalname: 'a.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'docx');
  assert.equal(kindFromFile({ originalname: 'a.csv', mimetype: 'text/csv' }), 'csv');
});

test('extractDocumentText reads csv and txt', async () => {
  const csv = await extractDocumentText({
    buffer: Buffer.from('name,score\nA,1\nB,2\n'),
    size: 20,
    originalname: 'scores.csv',
    mimetype: 'text/csv',
  });
  assert.equal(csv.kind, 'csv');
  assert.match(csv.text, /name,score/);

  const txt = await extractDocumentText({
    buffer: Buffer.from('Brand voice is confident and clear.'),
    size: 40,
    originalname: 'voice.txt',
    mimetype: 'text/plain',
  });
  assert.equal(txt.kind, 'txt');
  assert.match(txt.text, /Brand voice/);
});

test('automation catalog exposes triggers and actions', () => {
  const { TRIGGERS, ACTIONS } = require('../services/automation_bridge/catalog');
  assert.ok(TRIGGERS.some((t) => t.id === 'document.indexed'));
  assert.ok(ACTIONS.some((a) => a.id === 'memory.ingest'));
});

test('safeUrl rejects localhost and private IPs', () => {
  const { _safeUrl } = require('../services/automation_bridge/dispatch');
  assert.equal(_safeUrl('http://127.0.0.1/hook'), null);
  assert.equal(_safeUrl('https://hooks.zapier.com/hooks/catch/1/abc'), 'https://hooks.zapier.com/hooks/catch/1/abc');
});
