'use strict';

const { PassThrough } = require('node:stream');
const { finished } = require('node:stream/promises');
const reports = require('./report');

const MIME = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function clientRecipient(pool, tenantId, clientId) {
  const { rows } = await pool.query(
    `SELECT email FROM client_reporting_recipients
     WHERE tenant_id=$1 AND client_id=$2 AND enabled=true`,
    [tenantId, clientId],
  );
  return rows[0]?.email || null;
}

async function bufferReport(snapshot) {
  const pass = new PassThrough();
  const chunks = [];
  pass.on('data', (chunk) => chunks.push(chunk));
  const res = Object.assign(pass, {
    setHeader() {},
    type(value) { this.contentType = value; },
  });
  await reports.streamReport(snapshot, res);
  await finished(pass);
  const format = snapshot.format;
  const { client, report } = snapshot;
  const filename = `client-${client.id}-report-${report.generated_at.slice(0, 10)}.${format}`;
  return { buffer: Buffer.concat(chunks), filename, contentType: MIME[format] || res.contentType };
}

async function sendReportEmail({ to, subject, html, text, filename, content, contentType }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw Object.assign(new Error('RESEND_API_KEY missing'), { code: 'mail_unconfigured' });
  const from = process.env.RESEND_FROM_EMAIL || 'InfoGenie <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [to], subject, html, text: text || '',
      attachments: [{ filename, content: content.toString('base64'), content_type: contentType }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Resend ${response.status}: ${detail.slice(0, 240)}`), { code: 'mail_failed', status: response.status });
  }
  return response.json().catch(() => ({}));
}

module.exports = { clientRecipient, bufferReport, sendReportEmail, MIME };
