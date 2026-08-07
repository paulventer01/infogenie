/**
 * Multi-destination publish: WordPress · Shopify · Webflow · generic webhook.
 */
const _db = require('../../db');

function _isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local')) return false;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch { return false; }
}

async function publishWordPress({ tenantId, siteId, title, content, status = 'draft', excerpt = '' }) {
  if (!siteId) return { ok: false, destination: 'wordpress', error: 'site_id required' };
  if (!_db.hasDb()) {
    return {
      ok: true,
      destination: 'wordpress',
      simulated: true,
      post_url: `https://example.com/?p=demo-${Date.now()}`,
      status,
      note: 'No DB — simulated WordPress publish',
    };
  }
  try {
    // Prefer internal WP module helpers by reusing REST path logic via HTTP to self is heavy;
    // call DB + WP request by requiring wordpress api internals is not exported.
    // Duplicate minimal publish using same tables.
    const crypto = require('crypto');
    const pool = _db.getPool();
    const sr = await pool.query(
      `SELECT * FROM wordpress_sites WHERE id=$1 AND tenant_id=$2 AND status='active'`,
      [siteId, tenantId],
    );
    if (!sr.rows[0]) return { ok: false, destination: 'wordpress', error: 'WordPress site not found' };
    const site = sr.rows[0];
    let password = site.app_password;
    const keyRaw = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (keyRaw) {
      try {
        const key = Buffer.from(keyRaw, 'base64');
        if (key.length === 32) {
          const buf = Buffer.from(password, 'base64');
          const iv = buf.slice(0, 12);
          const tag = buf.slice(12, 28);
          const enc = buf.slice(28);
          const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
          dec.setAuthTag(tag);
          password = dec.update(enc) + dec.final('utf8');
        }
      } catch (_) {}
    }
    const auth = Buffer.from(`${site.username}:${password}`).toString('base64');
    const url = `${String(site.site_url).replace(/\/$/, '')}/wp-json/wp/v2/posts`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, status, excerpt }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await resp.json().catch(() => ({}));
    if (resp.status !== 201) {
      return { ok: false, destination: 'wordpress', error: `WP ${resp.status}: ${JSON.stringify(j).slice(0, 180)}` };
    }
    const post_url = j.link || j.guid?.rendered || null;
    try {
      await pool.query(
        `INSERT INTO wordpress_publish_log (tenant_id, site_id, wp_post_id, title, status, post_url, source)
         VALUES ($1,$2,$3,$4,$5,$6,'seo_autopilot')`,
        [tenantId, siteId, j.id, title, status, post_url],
      );
    } catch (_) {}
    return { ok: true, destination: 'wordpress', post_url, wp_post_id: j.id, status, site_url: site.site_url };
  } catch (e) {
    return { ok: false, destination: 'wordpress', error: e.message };
  }
}

async function publishShopify({ title, content, status = 'draft', shop, token }) {
  const shopHost = String(shop || process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const adminToken = token || process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shopHost || !adminToken || /^_DUMMY/i.test(adminToken)) {
    return {
      ok: true,
      destination: 'shopify',
      simulated: true,
      post_url: `https://${shopHost || 'demo-shop.myshopify.com'}/blogs/news/${slugify(title)}`,
      status,
      note: 'Set SHOPIFY_SHOP + SHOPIFY_ADMIN_TOKEN for live blog publish',
    };
  }
  try {
    // Find first blog
    const blogsResp = await fetch(`https://${shopHost}/admin/api/2024-01/blogs.json`, {
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const blogsJ = await blogsResp.json().catch(() => ({}));
    const blogId = blogsJ.blogs?.[0]?.id;
    if (!blogId) return { ok: false, destination: 'shopify', error: 'No Shopify blog found' };
    const published = status === 'publish' || status === 'published';
    const resp = await fetch(`https://${shopHost}/admin/api/2024-01/blogs/${blogId}/articles.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article: {
          title,
          body_html: content,
          published,
          published_at: published ? new Date().toISOString() : null,
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, destination: 'shopify', error: j.errors ? JSON.stringify(j.errors).slice(0, 200) : `HTTP ${resp.status}` };
    const article = j.article || {};
    return {
      ok: true,
      destination: 'shopify',
      post_url: article.handle ? `https://${shopHost}/blogs/news/${article.handle}` : null,
      article_id: article.id,
      status: published ? 'publish' : 'draft',
    };
  } catch (e) {
    return { ok: false, destination: 'shopify', error: e.message };
  }
}

async function publishWebflow({ title, content, status = 'draft', siteId, collectionId, token }) {
  const apiToken = token || process.env.WEBFLOW_API_TOKEN;
  const collection = collectionId || process.env.WEBFLOW_COLLECTION_ID;
  if (!apiToken || !collection || /^_DUMMY/i.test(apiToken)) {
    return {
      ok: true,
      destination: 'webflow',
      simulated: true,
      post_url: null,
      status,
      note: 'Set WEBFLOW_API_TOKEN + WEBFLOW_COLLECTION_ID for live CMS items',
      siteId: siteId || process.env.WEBFLOW_SITE_ID || null,
    };
  }
  try {
    const isDraft = status !== 'publish' && status !== 'published';
    const resp = await fetch(`https://api.webflow.com/v2/collections/${collection}/items`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        isArchived: false,
        isDraft,
        fieldData: {
          name: title,
          slug: slugify(title).slice(0, 100),
          post_body: content,
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, destination: 'webflow', error: j.message || `HTTP ${resp.status}` };
    return { ok: true, destination: 'webflow', item_id: j.id, status: isDraft ? 'draft' : 'publish' };
  } catch (e) {
    return { ok: false, destination: 'webflow', error: e.message };
  }
}

async function publishWebhook({ title, content, keyword, status = 'draft', url, secret }) {
  const hook = url || process.env.SEO_PUBLISH_WEBHOOK_URL;
  if (!hook || !_isSafeUrl(hook)) {
    return {
      ok: true,
      destination: 'webhook',
      simulated: true,
      note: 'Set destination.url or SEO_PUBLISH_WEBHOOK_URL for live webhook publish',
      status,
    };
  }
  try {
    const resp = await fetch(hook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-InfoGenie-Secret': secret } : {}),
        'User-Agent': 'InfoGenie-SEO-Autopilot/1.0',
      },
      body: JSON.stringify({
        event: 'seo_autopilot.publish',
        title,
        content,
        keyword,
        status,
        published_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await resp.text().catch(() => '');
    if (!resp.ok) return { ok: false, destination: 'webhook', error: `HTTP ${resp.status}: ${text.slice(0, 160)}` };
    return { ok: true, destination: 'webhook', status, response_preview: text.slice(0, 200) };
  } catch (e) {
    return { ok: false, destination: 'webhook', error: e.message };
  }
}

function slugify(s) {
  return String(s || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'post';
}

/**
 * @param {Array<{type:string, site_id?:number, url?:string, shop?:string, token?:string, collection_id?:string, secret?:string, enabled?:boolean}>} destinations
 */
async function publishAll(destinations, payload, { tenantId, publishStatus = 'draft' } = {}) {
  const list = (Array.isArray(destinations) ? destinations : []).filter((d) => d && d.enabled !== false);
  if (!list.length) {
    // Default: simulate wordpress if nothing configured
    return [await publishWordPress({
      tenantId,
      siteId: null,
      title: payload.title,
      content: payload.content,
      status: publishStatus,
    })];
  }
  const results = [];
  for (const d of list) {
    const type = String(d.type || '').toLowerCase();
    if (type === 'wordpress') {
      results.push(await publishWordPress({
        tenantId,
        siteId: d.site_id || d.siteId,
        title: payload.title,
        content: payload.content,
        status: d.status || publishStatus,
        excerpt: payload.excerpt || '',
      }));
    } else if (type === 'shopify') {
      results.push(await publishShopify({
        title: payload.title,
        content: payload.content,
        status: d.status || publishStatus,
        shop: d.shop,
        token: d.token,
      }));
    } else if (type === 'webflow') {
      results.push(await publishWebflow({
        title: payload.title,
        content: payload.content,
        status: d.status || publishStatus,
        siteId: d.site_id || d.siteId,
        collectionId: d.collection_id || d.collectionId,
        token: d.token,
      }));
    } else if (type === 'webhook') {
      results.push(await publishWebhook({
        title: payload.title,
        content: payload.content,
        keyword: payload.keyword,
        status: d.status || publishStatus,
        url: d.url,
        secret: d.secret,
      }));
    } else {
      results.push({ ok: false, destination: type || 'unknown', error: 'unsupported destination type' });
    }
  }
  return results;
}

module.exports = {
  publishAll,
  publishWordPress,
  publishShopify,
  publishWebflow,
  publishWebhook,
  slugify,
};
