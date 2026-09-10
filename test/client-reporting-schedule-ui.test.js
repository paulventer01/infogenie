"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { JSDOM } = require("jsdom"), { act } = React;

function domSetValue(document, selector, value) {
  const input = document.querySelector(selector);
  assert.ok(input, selector);
  const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  native.call(input, value);
  input.dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));
  input.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
}

async function harness(t, handler = () => undefined, initial = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/client-reporting", pretendToBeVisual: true });
  const calls = [], cleared = [], state = { clientId: 11, allowed: true, configured: false, paused: false, ...initial };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const c = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined };
      calls.push(c);
      let body = await handler(c, state);
      if (body === undefined) {
        if (url.endsWith("/schedule") && c.method === "PUT") {
          state.configured = true;
          body = { ok: true, configured: true, client: { id: state.clientId, name: "Client", slug: null, website: null, status: "active" },
            schedule: { client_id: state.clientId, cadence: c.body.cadence, timezone: c.body.timezone, send_time: c.body.send_time, format: c.body.format, opted_in: true, paused: false, next_due_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01" } };
        } else if (url.endsWith("/schedule/pause")) {
          state.paused = true;
          body = { ok: true, client: { id: state.clientId, name: "Client", slug: null, website: null, status: "active" },
            schedule: { client_id: state.clientId, cadence: "weekly", timezone: "UTC", send_time: "09:00", format: "pdf", opted_in: true, paused: true, next_due_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01" } };
        } else if (url.endsWith("/schedule/resume")) {
          state.paused = false;
          body = { ok: true, client: { id: state.clientId, name: "Client", slug: null, website: null, status: "active" },
            schedule: { client_id: state.clientId, cadence: "weekly", timezone: "UTC", send_time: "09:00", format: "pdf", opted_in: true, paused: false, next_due_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01" } };
        } else if (url.endsWith("/schedule")) {
          body = state.configured ? { ok: true, configured: true, client: { id: state.clientId, name: "Client", slug: null, website: null, status: "active" },
            schedule: { client_id: state.clientId, cadence: "weekly", timezone: "UTC", send_time: "09:00", format: "pdf", opted_in: true, paused: state.paused, next_due_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01" } }
            : { ok: true, configured: false, client: { id: state.clientId, name: "Client", slug: null, website: null, status: "active" }, schedule: null };
        } else if (url.endsWith("/delivery-history")) body = { ok: true, client: { id: state.clientId, name: "Client", slug: null, website: null, status: "active" }, deliveries: [], has_more: false, next_cursor: null };
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
  const Component = load("components/features/manage/ClientReportingSchedule.tsx").default;
  const root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const checkAccess = async () => state.allowed, clearContext = (message) => cleared.push(message);
  const render = async () => act(async () => root.render(React.createElement(Component, { clientId: state.clientId, defaultFormat: "pdf", checkAccess, clearContext })));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; }); });
  const button = (label) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label);
  const click = async (label) => act(async () => { const b = button(label); assert.ok(b, label); b.click(); });
  const checkbox = () => dom.window.document.querySelector('input[name="opt_in"]');
  await render();
  return { state, calls, cleared, button, click, checkbox, render, document: dom.window.document,
    text: () => dom.window.document.body.textContent, writes: () => calls.filter((c) => c.method !== "GET") };
}

test("schedule save requires explicit opt-in", async (t) => {
  const h = await harness(t);
  await act(async () => { domSetValue(h.document, 'input[name="send_time"]', "10:00"); });
  await h.click("Enable schedule");
  assert.match(h.text(), /Explicit opt-in is required/);
});

test("schedule save sends opt-in payload and shows confirmation", async (t) => {
  const h = await harness(t);
  await act(async () => { h.checkbox().click(); });
  await act(async () => { domSetValue(h.document, 'input[name="send_time"]', "10:00"); });
  await h.click("Enable schedule");
  const write = h.writes().find((c) => c.url.endsWith("/schedule"));
  assert.equal(write?.method, "PUT");
  assert.equal(write?.body.opt_in, true);
  assert.match(h.text(), /Scheduled delivery enabled/);
});

test("pause and resume call schedule endpoints", async (t) => {
  const h = await harness(t);
  await act(async () => { h.checkbox().click(); });
  await act(async () => { domSetValue(h.document, 'input[name="send_time"]', "10:00"); });
  await h.click("Enable schedule");
  await act(async () => {
    for (let attempt = 0; attempt < 50 && !h.button("Pause schedule"); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(h.button("Pause schedule"));
  await h.click("Pause schedule");
  await act(async () => {
    for (let attempt = 0; attempt < 50 && !h.writes().some((c) => c.url.endsWith("/schedule/pause")); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(h.writes().some((c) => c.url.endsWith("/schedule/pause")));
  await act(async () => {
    for (let attempt = 0; attempt < 50 && !h.button("Resume schedule"); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await h.click("Resume schedule");
  await act(async () => {
    for (let attempt = 0; attempt < 50 && !h.writes().some((c) => c.url.endsWith("/schedule/resume")); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(h.writes().some((c) => c.url.endsWith("/schedule/resume")));
});
