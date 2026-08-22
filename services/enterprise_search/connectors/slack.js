'use strict';

async function _slackApi(token, method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    const err = new Error(j.error || `slack_${method}_failed`);
    err.status = 400;
    throw err;
  }
  return j;
}

/**
 * Pull recent messages from public channels the bot can see.
 * Returns normalized items: { id, title, text, url, meta }
 */
async function fetchSlackItems(token, { maxChannels = 8, maxMessages = 40 } = {}) {
  if (!token) throw Object.assign(new Error('slack_token_missing'), { status: 400 });

  const channels = await _slackApi(token, 'conversations.list', {
    types: 'public_channel',
    exclude_archived: 'true',
    limit: String(maxChannels),
  });
  const list = (channels.channels || []).slice(0, maxChannels);
  const items = [];

  for (const ch of list) {
    try {
      const hist = await _slackApi(token, 'conversations.history', {
        channel: ch.id,
        limit: String(Math.min(20, maxMessages)),
      });
      for (const msg of hist.messages || []) {
        const text = String(msg.text || '').trim();
        if (text.length < 20) continue;
        if (msg.subtype && msg.subtype !== 'thread_broadcast') continue;
        items.push({
          id: `${ch.id}:${msg.ts}`,
          title: `#${ch.name || ch.id}`,
          text: `Slack #${ch.name || ch.id}\n${text}`,
          url: null,
          meta: { channel: ch.name, ts: msg.ts, user: msg.user || null },
        });
        if (items.length >= maxMessages) return items;
      }
    } catch {
      // Skip channels the bot cannot read.
    }
  }
  return items;
}

module.exports = { fetchSlackItems };
