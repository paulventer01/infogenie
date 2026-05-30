// services/admin/enforcement.js — Data-mode enforcement layer (Task 10)
//
// Express middleware that wraps res.json for every /api response and inspects
// the payload for non-real-data markers (fabricated / estimated / placeholder
// data). Behaviour depends on the effective data mode for the request:
//
//   • demo   — the payload is allowed through but annotated so the frontend can
//              render an explicit "DEMO DATA" badge (_dataMode='demo').
//   • strict — the fabricated payload is REPLACED with a standardized
//              data_unavailable response and an issue is raised for the admin.
//
// Markers recognised (the existing fabrication convention in this codebase):
//   • source ∈ { placeholder, fallback, template, serp-fallback, demo, mock }
//   • _estimated === true   |   _fabricated === true
// Detected at the top level and one level into nested objects/arrays so a
// fabricated block inside an otherwise-real response is still caught.

const _dataMode = require('./data_mode');
const _issues = require('./issues');

const FAKE_SOURCES = new Set(['placeholder', 'fallback', 'template', 'serp-fallback', 'demo', 'mock', 'sample']);

function _markerIn(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth < 0) return null;
  if (typeof obj.source === 'string' && FAKE_SOURCES.has(obj.source)) return { kind: 'source', value: obj.source };
  if (obj._estimated === true) return { kind: '_estimated', value: true };
  if (obj._fabricated === true) return { kind: '_fabricated', value: true };
  if (depth > 0) {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) {
        for (let i = 0; i < Math.min(v.length, 50); i++) {
          const m = _markerIn(v[i], depth - 1);
          if (m) return Object.assign({ path: k }, m);
        }
      } else if (v && typeof v === 'object') {
        const m = _markerIn(v, depth - 1);
        if (m) return Object.assign({ path: k }, m);
      }
    }
  }
  return null;
}

// Decide whether a payload carries a fabrication marker. Scans 2 levels deep.
function detectFabrication(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return _markerIn(payload, 2);
}

function dataModeEnforcement(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  // Never touch the admin portal's own API (it must report the real config).
  if (req.path.startsWith('/api/admin/')) return next();

  const origJson = res.json.bind(res);
  res.json = (payload) => {
    try {
      const marker = detectFabrication(payload);
      if (!marker) return origJson(payload);

      // Resolve the effective mode lazily, only when fabrication is present.
      const clientId = _dataMode.clientIdFromReq(req);
      const tenantId = req.tenant ? req.tenant.id : null;
      _dataMode.resolveDataMode({ clientId, tenantId }).then((decided) => {
        if (decided.mode === 'demo') {
          // Allow through, badge it as demo data.
          if (payload && typeof payload === 'object') {
            payload._dataMode = 'demo';
            payload._demo = true;
          }
          return origJson(payload);
        }
        // strict — replace with honest unavailable response + raise an issue.
        _issues.raiseIssue({
          severity: 'warning',
          source: 'data-mode',
          code: `fabricated:${marker.kind}:${marker.value}`,
          title: `Data unavailable served in strict mode (${req.path})`,
          detail: `A response carried a non-real-data marker (${marker.kind}=${marker.value}${marker.path ? ' at ' + marker.path : ''}) and was withheld under strict data mode.`,
          context: { marker, method: req.method },
          route: req.path,
          tenantId,
          clientId,
        }).catch(() => {});
        return origJson({
          ok: true,
          data_unavailable: true,
          _dataMode: 'strict',
          source: 'data_unavailable',
          message: 'This data is currently unavailable. The issue has been reported to your administrator.',
        });
      }).catch((e) => {
        console.warn('[admin/enforcement] resolve failed:', e.message);
        return origJson(payload);
      });
    } catch (e) {
      console.warn('[admin/enforcement] interceptor error:', e.message);
      return origJson(payload);
    }
    return res;
  };
  next();
}

module.exports = { dataModeEnforcement, detectFabrication };
