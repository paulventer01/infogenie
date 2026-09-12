"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { JSDOM } = require("jsdom"), { act } = React;
const BASE = "/api/client-reporting";
const client = (id) => ({ id, name: "Client", slug: null, website: null, status: "active" });
const profile = (s) => ({ client_id: s.clientId, version: s.version, report_source: "search-intel", default_format: s.format, report_title: "Saved report", branding_mode: "workspace", branding_overrides: {},
  selected_metrics: ["runs", "successful_runs", "brand_mentions", "mapped_queries", "recent_search_runs"],
  reporting_period: "last_30_days", reporting_timezone: "UTC", created_at: "2026-01-01", updated_at: "2026-01-01" });
const preview = (s) => ({ ok: true, client: client(s.clientId), profile_version: s.version, format: s.format, can_generate: true, brand: {}, report: { title: "Saved report", generated_at: "2026-01-01", sections: [{ kind: "table", title: "Mapped records", headers: ["Name"], rows: [["Client record"]] }] } });
const mime = { pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const TOKEN = "11111111-1111-4111-8111-111111111111";
const record = (id, client_id = null) => ({ id, label: "Record " + id, client_id, mapping_id: client_id === null ? null : TOKEN });
const page = (records, source = "search-intel", extra = {}) => ({ ok: true, source, records, has_more: false, next_cursor: null, ...extra });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
// Render the actual mapping component and same-origin API transport with deterministic responses.
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/client-reporting", pretendToBeVisual: true });
  const calls = [], cleared = [], state = { clientId: 11, allowed: true, version: 1, format: "pdf", records: [record(1), record(2, 11), record(3, 22)] };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const c = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined, credentials: options.credentials };
      calls.push(c); let body = await handler(c, state);
      if (body === undefined) {
        if (url.endsWith("/profile")) body = { ok: true, configured: true, client: client(state.clientId), profile: profile(state) };
        else if (url.endsWith("/report-preview")) body = preview(state);
        else if (url.endsWith("/report")) body = { binary: new Blob([state.format === "pdf" ? "%PDF-test" : "PK\x03\x04test"], { type: mime[state.format] }) };
        else throw new Error("Unexpected request " + url);
      }
      if (body.binary) return { ok: true, status: 200, blob: async () => body.binary };
      return { ok: !body.httpStatus || body.httpStatus < 400, status: body.httpStatus || 200, headers: { get: () => "application/json" }, json: async () => body };
    } };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(global, key, { configurable: true, writable: true, value }));
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } });
    const mod = { exports: {} };
    new Function("exports", "require", "module", outputText)(mod.exports, (id) => id.startsWith("@/")
      ? load(id.slice(2) + (id.startsWith("@/components/") ? ".tsx" : ".ts")) : require(id), mod);
    cache.set(file, mod.exports); return mod.exports;
  };
  const Component = load("components/features/manage/ClientReportingReport.tsx").default;
  const root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const checkAccess = async () => state.check ? state.check() : state.allowed, clearContext = (message) => cleared.push(message);
  const render = async () => act(async () => root.render(React.createElement(Component, {
    key: `${state.clientId}:${state.version}:${state.format}`, clientId: state.clientId, version: state.version,
    format: state.format, timezone: state.timezone || "UTC", checkAccess, clearContext })));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); previous.forEach((d, k) => {
    if (d) Object.defineProperty(global, k, d); else delete global[k];
  }); });
  const query = (selector) => dom.window.document.querySelector(selector);
  const row = (id) => query(`[data-record-id="${id}"]`);
  const button = (label, id) => [...(id === undefined ? dom.window.document : row(id)).querySelectorAll("button")].find((b) => b.textContent === label);
  const click = async (label, id, twice = false) => act(async () => { const b = button(label, id); assert.ok(b, label); b.click(); if (twice) b.click(); });
  const downloads = [], revoked = [];
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:test"; }; URL.revokeObjectURL = (url) => revoked.push(url);
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  t.after(() => { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; });
  await render();
  return { state, calls, cleared, downloads, revoked, query, row, button, click, render, text: () => dom.window.document.body.textContent,
    writes: () => calls.filter((c) => c.method !== "GET"), lists: () => calls.filter((c) => c.url.includes("/sources/")),
    resolve: async (pending, value) => act(async () => pending.resolve(value)),
    source: async (value) => act(async () => { const el = query('[name="mapping_source"]'); assert.ok(el);
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }) };
}
for (const format of Object.keys(mime)) test("explicit saved-profile preview then valid download: " + format, async (t) => {
  const h = await harness(t); h.state.format = format; await h.render();
  assert.equal(h.calls.length, 0); assert.ok(h.button("Generate & download " + format.toUpperCase()).disabled);
  await h.click("Preview report"); assert.match(h.text(), /Client record/); assert.equal(h.writes().length, 0);
  await h.click("Generate & download " + format.toUpperCase(), undefined, true);
  assert.equal(h.writes().length, 1); assert.deepEqual(h.writes()[0].body, { expected_version: 1 });
  assert.equal(h.downloads.length, 1); assert.equal(h.revoked.length, 1); assert.ok(h.calls.every((c) => c.credentials === "same-origin"));
});
test("empty mapping preview cannot generate", async (t) => {
  const h = await harness(t, (c, s) => c.url.endsWith("/report-preview") ? { ...preview(s), can_generate: false } : undefined);
  await h.click("Preview report"); assert.match(h.text(), /No mapped records/); assert.ok(h.button("Generate & download PDF").disabled);
});
for (const bad of ["version", "client", "markup", "rows"]) test("rejects malformed preview " + bad, async (t) => {
  const h = await harness(t, (c, s) => { if (!c.url.endsWith("/report-preview")) return;
    const p = preview(s); if (bad === "version") p.profile_version = 9; if (bad === "client") p.client.id = 22;
    if (bad === "markup") p.brand.primaryColor = "url(https://evil.test)"; if (bad === "rows") p.report.sections[0].rows = [[{}]]; return p;
  });
  await h.click("Preview report"); assert.ok(h.query('[role="alert"]')); assert.equal(h.query("article"), null);
});
test("React escapes report text", async (t) => {
  const h = await harness(t, (c, s) => { if (!c.url.endsWith("/report-preview")) return;
    const p = preview(s); p.report.sections[0].rows = [["<img src=x onerror=alert(1)>"]]; return p; });
  await h.click("Preview report"); assert.equal(h.query("img"), null); assert.match(h.text(), /<img/);
});
for (const stage of ["preview", "download"]) test("late " + stage + " discarded after client switch", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url.endsWith(stage === "preview" ? "/report-preview" : "/report") ? pending.promise : undefined);
  await h.click("Preview report"); if (stage === "download") await h.click("Generate & download PDF");
  h.state.clientId = 22; await h.render();
  await h.resolve(pending, stage === "preview" ? preview({ clientId: 11, version: 1, format: "pdf" }) : { binary: new Blob(["%PDF-test"], { type: mime.pdf }) });
  assert.equal(h.downloads.length, 0); assert.equal(h.query("article"), null);
});
for (const failure of [new Blob(["{\"ok\":false}"], { type: "application/json" }), new Blob(["not a PDF"], { type: mime.pdf }), "network"])
  test("invalid or uncertain binary requires explicit new preview: " + String(failure), async (t) => {
    const h = await harness(t, (c) => { if (!c.url.endsWith("/report")) return; if (failure === "network") throw Error("offline"); return { binary: failure }; });
    await h.click("Preview report"); await h.click("Generate & download PDF");
    assert.equal(h.downloads.length, 0); assert.ok(h.button("Generate & download PDF").disabled); assert.ok(h.query('[role="alert"]'));
  });
test("revoked access prevents generation", async (t) => {
  const h = await harness(t); await h.click("Preview report"); h.state.allowed = false; await h.click("Generate & download PDF");
  assert.equal(h.writes().length, 0); assert.equal(h.downloads.length, 0);
});
test("profile changed while binary pending prevents download", async (t) => {
  let changed = false; const h = await harness(t, (c, s) => {
    if (c.url.endsWith("/report")) { changed = true; return { binary: new Blob(["%PDF-test"], { type: mime.pdf }) }; }
    if (changed && c.url.endsWith("/profile")) return { ok: true, configured: true, client: client(s.clientId), profile: { ...profile(s), version: 2 } };
  });
  await h.click("Preview report"); await h.click("Generate & download PDF"); assert.equal(h.downloads.length, 0); assert.match(h.text(), /Reload the profile/);
});
test("binary permission denial clears protected context", async (t) => {
  const h = await harness(t, (c) => c.url.endsWith("/report") ? { ok: false, httpStatus: 403 } : undefined);
  await h.click("Preview report"); await h.click("Generate & download PDF"); assert.equal(h.cleared.length, 1); assert.equal(h.downloads.length, 0);
});
test("custom dates require both values and invalidate preview before generation", async (t) => {
  const h = await harness(t, (c, s) => {
    if (!c.url.includes("/report-preview")) return;
    const query = new URL("http://local" + c.url).searchParams;
    return { ...preview(s), reporting_dates: { start: query.get("start_date"), end: query.get("end_date"), timezone: "UTC" } };
  });
  const change = (selector, value) => act(async () => {
    const el = h.query(selector); assert.ok(el);
    const setter = Object.getOwnPropertyDescriptor(global.window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new global.window.Event("change", { bubbles: true }));
  });
  await act(async () => { h.query('input[type="checkbox"]').click(); });
  assert.ok(h.button("Preview report").disabled);
  assert.match(h.text(), /Enter both custom start and end dates/);
  await change('input[name="start_date"]', "2026-03-01");
  assert.ok(h.button("Generate & download PDF").disabled);
  await change('input[name="end_date"]', "2026-03-10");
  await h.click("Preview report");
  assert.match(h.text(), /2026-03-01 to 2026-03-10/);
  assert.ok(!h.button("Generate & download PDF").disabled);
  await change('input[name="end_date"]', "");
  assert.equal(h.query("article"), null);
  assert.ok(h.button("Generate & download PDF").disabled);
});
