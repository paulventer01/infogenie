'use strict';

async function _notion(token, path, body) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.message || j.code || `notion_http_${r.status}`);
    err.status = r.status === 401 ? 401 : 400;
    throw err;
  }
  return j;
}

function _richText(arr) {
  return (arr || []).map((t) => t.plain_text || '').join('');
}

function _blockPlain(block) {
  const type = block.type;
  const node = block[type];
  if (!node) return '';
  if (node.rich_text) return _richText(node.rich_text);
  if (node.text) return _richText(node.text);
  if (type === 'child_page') return node.title || '';
  return '';
}

async function _pagePlainText(token, pageId, { maxBlocks = 40 } = {}) {
  const parts = [];
  let cursor;
  let n = 0;
  do {
    const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
    const page = await _notion(token, `/blocks/${pageId}/children${qs}`);
    for (const b of page.results || []) {
      const t = _blockPlain(b).trim();
      if (t) parts.push(t);
      n++;
      if (n >= maxBlocks) break;
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && n < maxBlocks);
  return parts.join('\n');
}

/**
 * Search Notion workspace and pull page text for indexing.
 */
async function fetchNotionItems(token, { maxPages = 20, query = '' } = {}) {
  if (!token) throw Object.assign(new Error('notion_token_missing'), { status: 400 });

  const search = await _notion(token, '/search', {
    query: query || undefined,
    page_size: Math.min(25, maxPages),
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });

  const items = [];
  for (const page of search.results || []) {
    if (page.object !== 'page') continue;
    const titleProp = Object.values(page.properties || {}).find((p) => p.type === 'title');
    const title = _richText(titleProp?.title) || page.id;
    let body = '';
    try {
      body = await _pagePlainText(token, page.id);
    } catch {
      body = '';
    }
    const text = [title, body].filter(Boolean).join('\n\n').trim();
    if (text.length < 20) continue;
    items.push({
      id: page.id,
      title,
      text: `Notion page: ${title}\n${text}`,
      url: page.url || null,
      meta: { last_edited_time: page.last_edited_time || null },
    });
    if (items.length >= maxPages) break;
  }
  return items;
}

module.exports = { fetchNotionItems };
