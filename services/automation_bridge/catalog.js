'use strict';

/** Outbound events InfoGenie can push to Zapier / n8n / Make. */
const TRIGGERS = [
  {
    id: 'lead.created',
    label: 'Lead created',
    description: 'Fires when a new lead is captured in InfoGenie.',
    sample: { lead_id: 101, email: 'alex@acme.com', source: 'landing_page', score: 72 },
  },
  {
    id: 'campaign.launched',
    label: 'Campaign launched',
    description: 'Fires when an ad campaign is created or launched.',
    sample: { campaign: 'Q3 Brand', platform: 'meta', daily_budget: 150 },
  },
  {
    id: 'ask.answered',
    label: 'Ask InfoGenie answered',
    description: 'Fires after an Ask InfoGenie / boardroom answer is generated.',
    sample: { question: 'Why is ROAS down?', topic: 'roas', confidence: 78 },
  },
  {
    id: 'document.indexed',
    label: 'Document indexed',
    description: 'Fires when a PDF/DOCX/CSV is ingested into Document RAG.',
    sample: { title: 'Brand guidelines.pdf', kind: 'pdf', chunks: 12 },
  },
  {
    id: 'connector.synced',
    label: 'Enterprise connector synced',
    description: 'Fires after Slack / Notion / Drive sync completes.',
    sample: { connector: 'notion', items: 18, chunks: 54 },
  },
  {
    id: 'alert.raised',
    label: 'Alert raised',
    description: 'Fires for high-severity performance or brand alerts.',
    sample: { severity: 'high', message: 'ROAS dropped 28% WoW', channel: 'meta' },
  },
  {
    id: 'memory.ingested',
    label: 'Marketing memory written',
    description: 'Fires when a marketing memory node is ingested.',
    sample: { node_type: 'strategic_decision', summary: 'Paused TikTok prospecting' },
  },
];

/** Inbound actions Zapier / n8n can invoke on InfoGenie. */
const ACTIONS = [
  {
    id: 'memory.ingest',
    label: 'Ingest marketing memory',
    description: 'Write an observation into Marketing Memory.',
    params: ['summary', 'node_type?', 'importance?'],
  },
  {
    id: 'document.ingest_text',
    label: 'Index text into Document RAG',
    description: 'Index arbitrary text so Ask InfoGenie can retrieve it.',
    params: ['title', 'text'],
  },
  {
    id: 'task.create',
    label: 'Create officer task',
    description: 'Create a task for an AI executive officer.',
    params: ['officer', 'title', 'notes?'],
  },
  {
    id: 'webhook.echo',
    label: 'Echo (test)',
    description: 'Returns the payload — useful for connection tests.',
    params: ['any'],
  },
];

module.exports = { TRIGGERS, ACTIONS };
