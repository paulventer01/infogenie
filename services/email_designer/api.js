const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }
function _pool() { return _db.getPool(); }

const BLOCK_TYPES = ['text', 'image', 'button', 'divider', 'columns', 'spacer', 'header', 'footer'];

// Render blocks → HTML email
function renderHtml(blocks = [], styles = {}) {
  const bg = styles.bg_color || '#F9FAFB';
  const accent = styles.accent_color || '#0066FF';
  const font = styles.font_family || 'Arial, sans-serif';
  const maxW = styles.max_width || '600px';
  const textColor = styles.text_color || '#1E293B';

  const renderBlock = (block) => {
    const s = block.styles || {};
    switch (block.type) {
      case 'header':
        return `<table width="100%" style="background:${s.bg||accent};padding:32px 24px;margin-bottom:0"><tr><td align="center" style="color:${s.color||'#fff'};font-size:${s.size||'24px'};font-weight:700;font-family:${font}">${block.content||'Header'}</td></tr></table>`;
      case 'text':
        return `<table width="100%" style="padding:${s.padding||'16px 24px'}"><tr><td style="color:${s.color||textColor};font-size:${s.size||'15px'};line-height:1.6;font-family:${font}">${(block.content||'').replace(/\n/g,'<br>')}</td></tr></table>`;
      case 'image':
        return block.src ? `<table width="100%" style="padding:${s.padding||'12px 24px'}"><tr><td align="${s.align||'center'}"><img src="${block.src}" alt="${block.alt||''}" style="max-width:100%;border-radius:${s.radius||'8px'}"${s.width?` width="${s.width}"`:''}></td></tr></table>` : '';
      case 'button':
        return `<table width="100%" style="padding:${s.padding||'16px 24px'}"><tr><td align="${s.align||'center'}"><a href="${block.href||'#'}" style="display:inline-block;padding:${s.btn_padding||'12px 28px'};background:${s.bg||accent};color:${s.color||'#fff'};border-radius:${s.radius||'8px'};text-decoration:none;font-weight:700;font-size:${s.size||'15px'};font-family:${font}">${block.content||'Click Here'}</a></td></tr></table>`;
      case 'divider':
        return `<table width="100%" style="padding:${s.padding||'8px 24px'}"><tr><td><hr style="border:none;border-top:${s.thickness||'1px'} ${s.style||'solid'} ${s.color||'#E2E8F0'};margin:0"></td></tr></table>`;
      case 'spacer':
        return `<div style="height:${s.height||'24px'}"></div>`;
      case 'columns':
        const cols = block.columns || [{ content: 'Column 1' }, { content: 'Column 2' }];
        const w = Math.floor(100 / cols.length);
        return `<table width="100%" style="padding:${s.padding||'16px 24px'}"><tr>${cols.map(c=>`<td width="${w}%" valign="top" style="padding:8px;color:${textColor};font-family:${font};font-size:15px">${c.content||''}</td>`).join('')}</tr></table>`;
      case 'footer':
        return `<table width="100%" style="background:${s.bg||'#F1F5F9'};padding:20px 24px;margin-top:0"><tr><td align="center" style="color:${s.color||'#64748B'};font-size:12px;font-family:${font}">${block.content||'© 2026 Your Company. All rights reserved.'}</td></tr></table>`;
      default:
        return '';
    }
  };

  const bodyHtml = blocks.map(renderBlock).join('\n');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Preview</title></head>
<body style="margin:0;padding:20px;background:${bg};font-family:${font}">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="${maxW}" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)" cellpadding="0" cellspacing="0">
<tr><td>
${bodyHtml}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

router.get('/', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:list');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    const r = await p.query(
      `SELECT id,name,description,subject,status,tags,spam_score,version,created_at,updated_at,
              jsonb_array_length(blocks) as block_count
       FROM email_templates WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 100`, [tid]
    );
    res.json({ ok: true, templates: r.rows, block_types: BLOCK_TYPES });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:get');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    const r = await p.query(`SELECT * FROM email_templates WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, template: r.rows[0] });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:create');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { name, description, subject, blocks = [], global_styles = {}, tags } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
    const rendered = renderHtml(blocks, global_styles);
    const p = _pool();
    const r = await p.query(
      `INSERT INTO email_templates(tenant_id,name,description,subject,blocks,global_styles,rendered_html,tags)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, name, description || null, subject || null,
       JSON.stringify(blocks), JSON.stringify(global_styles), rendered, tags || null]
    );
    res.json({ ok: true, template: r.rows[0] });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:update');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { name, description, subject, blocks, global_styles, status, tags } = req.body || {};
    const p = _pool();
    const cur = await p.query(`SELECT blocks,global_styles,version FROM email_templates WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    const savedBy = req.user?.email || null;
    const newBlocks = blocks != null ? blocks : cur.rows[0].blocks;
    const newStyles = global_styles != null ? global_styles : cur.rows[0].global_styles;
    const rendered = renderHtml(newBlocks, newStyles);
    const nextVersion = (cur.rows[0].version || 1) + 1;
    // Save version history
    await p.query(
      `INSERT INTO email_template_versions(template_id,tenant_id,version,blocks,global_styles,rendered_html,saved_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, tid, cur.rows[0].version, JSON.stringify(cur.rows[0].blocks),
       JSON.stringify(cur.rows[0].global_styles), rendered, savedBy]
    );
    const r = await p.query(
      `UPDATE email_templates SET
         name=COALESCE($1,name), description=COALESCE($2,description),
         subject=COALESCE($3,subject), blocks=COALESCE($4::jsonb,blocks),
         global_styles=COALESCE($5::jsonb,global_styles), rendered_html=$6,
         status=COALESCE($7,status), tags=COALESCE($8,tags),
         version=$9, updated_at=NOW()
       WHERE id=$10 AND tenant_id=$11 RETURNING *`,
      [name||null, description||null, subject||null,
       blocks!=null?JSON.stringify(blocks):null,
       global_styles!=null?JSON.stringify(global_styles):null,
       rendered, status||null, tags||null, nextVersion, req.params.id, tid]
    );
    res.json({ ok: true, template: r.rows[0] });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:delete');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    await p.query(`DELETE FROM email_templates WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Preview rendered HTML
router.post('/:id/preview', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:preview');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    const r = await p.query(`SELECT rendered_html,blocks,global_styles FROM email_templates WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(r.rows[0].rendered_html || '');
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Re-render with fresh block data (live preview)
router.post('/render', async (req, res) => {
  try {
    const { blocks = [], global_styles = {} } = req.body || {};
    const html = renderHtml(blocks, global_styles);
    res.json({ ok: true, html });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// AI-generate blocks from a prompt
router.post('/ai-generate', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:ai-generate');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const { prompt, brand_name, accent_color, goal } = req.body || {};
    if (!prompt && !goal) return res.status(400).json({ ok: false, error: 'prompt or goal required' });

    let blocks = null;
    try {
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
      const r = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `You are an email designer. Generate a block-based email for:
Brand: ${brand_name || 'Our Brand'}
Goal: ${goal || prompt}
Accent color: ${accent_color || '#0066FF'}

Return blocks array. Block types available: header(content), text(content), image(src,alt), button(content,href), divider, spacer, columns(columns:[{content}]), footer(content).
Each block has: type, content (for text/header/button/footer), and optional styles object.
Keep it concise and conversion-focused. Include: header, 2-3 text blocks, 1-2 buttons, footer.
Return strict JSON: {"subject":"...","blocks":[...],"global_styles":{"accent_color":"...","text_color":"#1E293B"}}` }]
      });
      const parsed = JSON.parse(r.choices[0].message.content);
      if (!parsed._DUMMY && Array.isArray(parsed.blocks)) blocks = parsed;
    } catch(e2) {}

    if (!blocks) {
      blocks = {
        subject: goal || 'Our latest update',
        blocks: [
          { type: 'header', content: brand_name || 'Our Brand' },
          { type: 'text', content: `Hi there,\n\nWe wanted to reach out about ${goal || 'something important'}.` },
          { type: 'button', content: 'Learn More', href: '#' },
          { type: 'footer', content: '© 2026. Unsubscribe at any time.' }
        ],
        global_styles: { accent_color: accent_color || '#0066FF' }
      };
    }
    res.json({ ok: true, ...blocks });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Check spam score (basic heuristics)
router.post('/:id/spam-check', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:spam-check');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    const r = await p.query(`SELECT subject,rendered_html,blocks FROM email_templates WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    const { subject = '', rendered_html = '' } = r.rows[0];
    const flags = [];
    const spamWords = ['free','urgent','limited time','act now','guaranteed','winner','cash','prize','click here','buy now'];
    const subjectLower = subject.toLowerCase();
    if (spamWords.some(w => subjectLower.includes(w))) flags.push({ issue: 'Spam trigger word in subject', severity: 'high' });
    if (subject.includes('!!!') || subject.includes('???')) flags.push({ issue: 'Excessive punctuation in subject', severity: 'medium' });
    if (/[A-Z]{5,}/.test(subject)) flags.push({ issue: 'All-caps in subject', severity: 'medium' });
    if (!rendered_html.includes('unsubscribe') && !rendered_html.includes('Unsubscribe')) flags.push({ issue: 'Missing unsubscribe link', severity: 'high' });
    const imgCount = (rendered_html.match(/<img/gi) || []).length;
    const textLen = rendered_html.replace(/<[^>]+>/g, '').length;
    if (imgCount > 3 && textLen < 200) flags.push({ issue: 'High image-to-text ratio', severity: 'medium' });
    const score = Math.max(0, 10 - flags.filter(f=>f.severity==='high').length * 3 - flags.filter(f=>f.severity==='medium').length);
    await p.query(`UPDATE email_templates SET spam_score=$1 WHERE id=$2 AND tenant_id=$3`, [score, req.params.id, tid]);
    res.json({ ok: true, score, max: 10, grade: score >= 8 ? 'A' : score >= 6 ? 'B' : score >= 4 ? 'C' : 'D', flags });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Get version history
router.get('/:id/versions', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:versions');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    const r = await p.query(
      `SELECT id,version,saved_by,note,created_at FROM email_template_versions
       WHERE template_id=$1 AND tenant_id=$2 ORDER BY version DESC LIMIT 20`,
      [req.params.id, tid]
    );
    res.json({ ok: true, versions: r.rows });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Restore a version
router.post('/:id/versions/:vid/restore', async (req, res) => {
  try {
    const tid = await _tid(req, 'email-designer:restore');
    if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
    const p = _pool();
    const v = await p.query(`SELECT * FROM email_template_versions WHERE id=$1 AND template_id=$2 AND tenant_id=$3`, [req.params.vid, req.params.id, tid]);
    if (!v.rows.length) return res.status(404).json({ ok: false, error: 'version not found' });
    const { blocks, global_styles, rendered_html } = v.rows[0];
    const r = await p.query(
      `UPDATE email_templates SET blocks=$1::jsonb, global_styles=$2::jsonb, rendered_html=$3,
              version=version+1, updated_at=NOW() WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [JSON.stringify(blocks), JSON.stringify(global_styles), rendered_html, req.params.id, tid]
    );
    res.json({ ok: true, template: r.rows[0] });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = { router, renderHtml };
