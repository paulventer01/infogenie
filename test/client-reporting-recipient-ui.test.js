"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { JSDOM } = require("jsdom"), { act } = React;
const BASE = "/api/client-reporting";
const client = (id) => ({ id, name: "Client", slug: null, website: null, status: "active" });
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/client-reporting", pretendToBeVisual: true });
  const calls = [], cleared = [], state = { clientId: 11, allowed: true };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const c = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined, credentials: options.credentials };
      calls.push(c); let body = await handler(c, state);
      if (body === undefined) {
        if (url.endsWith("/recipient")) body = c.method === "PUT"
          ? { ok: true, configured: true, client: client(state.clientId), recipient: { client_id: state.clientId, email: c.body.email, enabled: c.body.enabled, updated_at: "2026-01-02" } }
          : { ok: true, configured: true, client: client(state.clientId), recipient: { client_id: state.clientId, email: "client@example.com", enabled: true, updated_at: "2026-01-01" } };
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
  const Component = load("components/features/manage/ClientReportingRecipient.tsx").default;
  const root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const checkAccess = async () => state.allowed, clearContext = (message) => cleared.push(message);
  const render = async () => act(async () => root.render(React.createElement(Component, { clientId: state.clientId, checkAccess, clearContext })));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; }); });
  const input = (name) => dom.window.document.querySelector(`[name="${name}"]`);
  const setInput = (name, value) => act(async () => {
    const el = input(name); assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const button = (label) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label);
  const click = async (label) => act(async () => { const b = button(label); assert.ok(b, label); b.click(); });
  await render();
  return { calls, cleared, input, setInput, click, text: () => dom.window.document.body.textContent, writes: () => calls.filter((c) => c.method !== "GET") };
}
test("recipient UI loads, edits and saves an enabled address", async (t) => {
  const h = await harness(t);
  assert.equal(h.input("recipient_email").value, "client@example.com");
  await h.setInput("recipient_email", "new@example.com");
  await h.click("Save recipient");
  assert.deepEqual(h.writes()[0].body, { email: "new@example.com", enabled: true });
  assert.match(h.text(), /Delivery recipient saved/);
});
test("recipient UI can deactivate delivery", async (t) => {
  const h = await harness(t);
  await act(async () => { h.input("recipient_enabled").click(); });
  await h.click("Save recipient");
  assert.deepEqual(h.writes()[0].body, { email: "client@example.com", enabled: false });
  assert.match(h.text(), /deactivated/);
});
