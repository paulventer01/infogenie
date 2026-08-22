'use strict';

async function _gapi(token, url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error?.message || `drive_http_${r.status}`);
    err.status = r.status === 401 ? 401 : 400;
    throw err;
  }
  return j;
}

async function _exportGoogleDoc(token, fileId, mime) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mime)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return '';
  return r.text();
}

async function _downloadText(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return '';
  return r.text();
}

/**
 * List recent Drive files and pull text for Docs / plain text / CSV.
 */
async function fetchDriveItems(token, { maxFiles = 20 } = {}) {
  if (!token) throw Object.assign(new Error('drive_token_missing'), { status: 400 });

  const q = encodeURIComponent(
    "trashed=false and (mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='text/csv' or mimeType='application/pdf')",
  );
  const list = await _gapi(
    token,
    `https://www.googleapis.com/drive/v3/files?pageSize=${Math.min(40, maxFiles)}&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,webViewLink,modifiedTime)&q=${q}`,
  );

  const items = [];
  for (const f of list.files || []) {
    let text = '';
    try {
      if (f.mimeType === 'application/vnd.google-apps.document') {
        text = await _exportGoogleDoc(token, f.id, 'text/plain');
      } else if (f.mimeType === 'text/plain' || f.mimeType === 'text/csv') {
        text = await _downloadText(token, f.id);
      } else if (f.mimeType === 'application/pdf') {
        // Binary PDFs need upload path; skip content here but index metadata.
        text = `Google Drive PDF: ${f.name}`;
      }
    } catch {
      text = '';
    }
    text = String(text || '').trim();
    if (text.length < 12) continue;
    items.push({
      id: f.id,
      title: f.name || f.id,
      text: `Google Drive: ${f.name}\n${text}`,
      url: f.webViewLink || null,
      meta: { mimeType: f.mimeType, modifiedTime: f.modifiedTime || null },
    });
    if (items.length >= maxFiles) break;
  }
  return items;
}

module.exports = { fetchDriveItems };
