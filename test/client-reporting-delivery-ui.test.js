"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { JSDOM } = require("jsdom"), { act } = React;
const client = (id) => ({ id, name: "Client", slug: null, website: null, status: "active" });
const profile = (s) => ({ client_id: s.clientId, version: s.version, report_source: "search-intel", default_format: s.format, report_title: "Saved report", branding_mode: "workspace", branding_overrides: {},
  selected_metrics: ["runs", "successful_runs", "brand_mentions", "mapped_queries", "recent_search_runs"],
  reporting_period: "last_30_days", reporting_timezone: "UTC", created_at: "2026-01-01", updated_at: "2026-01-01" });
const preview = (s) => ({ ok: true, client: client(s.clientId), profile_version: s.version, format: s.format, can_generate: true, brand: {}, report: { title: "Saved report", generated_at: "2026-01-01", sections: [{ kind: "table", title: "Mapped records", headers: ["Name"], rows: [["Client record"]] }] } });
const recipient = (s) => ({ ok: true, client: client(s.clientId), profile_version: s.version, format: s.format, recipient: { email: "client@example.com", source: "client_reporting_recipient", enabled: true } });
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/client-reporting", pretendToBeVisual: true });
  const calls = [], cleared = [], state = { clientId: 11, allowed: true, version: 1, format: "pdf" };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const c = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined, credentials: options.credentials };
      calls.push(c); let body = await handler(c, state);
      if (body === undefined) {
        if (url.endsWith("/profile")) body = { ok: true, configured: true, client: client(state.clientId), profile: profile(state) };
        else if (url.endsWith("/report-preview")) body = preview(state);
        else if (url.endsWith("/report-recipient")) body = recipient(state);
        else if (url.endsWith("/report-email")) body = { ok: true, sent: true, recipient: "client@example.com", format: state.format, profile_version: state.version };
        else if (url.endsWith("/report")) body = { binary: new Blob(["%PDF-test"], { type: "application/pdf" }) };
        else throw new Error("Unexpected request " + url);
      }
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
  const checkAccess = async () => state.allowed, clearContext = (message) => cleared.push(message);
  const render = async () => act(async () => root.render(React.createElement(Component, { key: `${state.clientId}:${state.version}:${state.format}`, clientId: state.clientId, version: state.version, format: state.format, checkAccess, clearContext })));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; }); });
  const button = (label) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label);
  const click = async (label) => act(async () => { const b = button(label); assert.ok(b, label); b.click(); });
  await render();
  return { state, calls, cleared, button, click, render, text: () => dom.window.document.body.textContent,
    writes: () => calls.filter((c) => c.method !== "GET") };
}
test("email report requires preview, confirmation and expected version", async (t) => {
  const h = await harness(t);
  assert.ok(h.button("Email report").disabled);
  await h.click("Preview report");
  await h.click("Email report");
  assert.match(h.text(), /client@example.com/);
  await h.click("Confirm email");
  assert.deepEqual(h.writes().find((c) => c.url.endsWith("/report-email"))?.body, { expected_version: 1, confirm: true });
  assert.match(h.text(), /Report emailed to client@example.com/);
});
test("missing recipient shows actionable error", async (t) => {
  const h = await harness(t, (c) => c.url.endsWith("/report-recipient") ? { ok: false, error: "no_recipient", httpStatus: 409 } : undefined);
  await h.click("Preview report");
  await h.click("Email report");
  assert.match(h.text(), /delivery recipient/);
});
test("mail failure shows actionable error after confirmation", async (t) => {
  const h = await harness(t, (c) => c.url.endsWith("/report-email") ? { ok: false, error: "mail_failed", httpStatus: 502 } : undefined);
  await h.click("Preview report");
  await h.click("Email report");
  await h.click("Confirm email");
  assert.match(h.text(), /could not be emailed/);
});
