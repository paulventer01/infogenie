'use strict';

// Authoritative source: Meta Graph API changelog — latest version v26.0 (introduced
// 2026-07-29). See https://developers.facebook.com/docs/graph-api/changelog/
// v19.0 expired 2026-05-21 per the same changelog.
const DEFAULT_GRAPH_VERSION = 'v26.0';
const GRAPH_VERSION_RE = /^v\d{1,2}\.\d{1,2}$/;

function metaGraphVersion() {
  const raw = process.env.META_GRAPH_API_VERSION;
  if (typeof raw === 'string' && GRAPH_VERSION_RE.test(raw.trim())) return raw.trim();
  return DEFAULT_GRAPH_VERSION;
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  GRAPH_VERSION_RE,
  metaGraphVersion,
};
