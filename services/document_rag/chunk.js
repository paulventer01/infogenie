'use strict';

/**
 * Split long text into overlapping chunks suitable for embedding.
 * Targets ~900 chars with ~120 overlap — small enough for retrieval precision.
 */
function chunkText(text, opts = {}) {
  const size = Math.max(200, Math.min(2000, opts.size || 900));
  const overlap = Math.max(0, Math.min(400, opts.overlap || 120));
  const source = String(text || '').trim();
  if (!source) return [];

  const paragraphs = source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const blocks = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) blocks.push(buf.trim());
    buf = '';
  };

  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length <= size) {
      buf = buf ? `${buf}\n\n${p}` : p;
      continue;
    }
    if (buf) flush();
    if (p.length <= size) {
      buf = p;
      continue;
    }
    // Hard-split long paragraphs by sentence-ish boundaries.
    let i = 0;
    while (i < p.length) {
      let end = Math.min(p.length, i + size);
      if (end < p.length) {
        const slice = p.slice(i, end);
        const soft = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
        if (soft > size * 0.4) end = i + soft + 1;
      }
      blocks.push(p.slice(i, end).trim());
      i = Math.max(end - overlap, i + 1);
    }
  }
  flush();

  // Second pass: merge tiny trailing chunks.
  const out = [];
  for (const b of blocks) {
    if (!b) continue;
    if (out.length && out[out.length - 1].length + b.length < size * 0.55) {
      out[out.length - 1] = `${out[out.length - 1]}\n\n${b}`;
    } else {
      out.push(b);
    }
  }
  return out.slice(0, opts.maxChunks || 80);
}

function formatChunkContent({ title, kind, sourceLabel, chunk, index, total }) {
  const header = [
    `Document: ${title || 'Untitled'}`,
    kind ? `Type: ${kind}` : null,
    sourceLabel ? `Source: ${sourceLabel}` : null,
    `Chunk ${index + 1}/${total}`,
  ].filter(Boolean).join(' | ');
  return `${header}\n${chunk}`;
}

module.exports = { chunkText, formatChunkContent };
