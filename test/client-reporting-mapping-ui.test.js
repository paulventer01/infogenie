"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { JSDOM } = require("jsdom"), { act } = React;
const BASE = "/api/client-reporting";
const TOKEN = "11111111-1111-4111-8111-111111111111";
const record = (id, client_id = null) => ({ id, label: "Record " + id, client_id, mapping_id: client_id === null ? null : TOKEN });
const page = (records, source = "search-intel", extra = {}) => ({ ok: true, source, records, has_more: false, next_cursor: null, ...extra });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
// Render the actual mapping component and same-origin API transport with deterministic responses.
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/client-reporting", pretendToBeVisual: true });
  const calls = [], cleared = [], state = { clientId: 11, allowed: true, records: [record(1), record(2, 11), record(3, 22)] };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const c = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined, credentials: options.credentials };
      calls.push(c); let body = await handler(c, state);
      if (body === undefined) {
        if (/\/clients\/\d+$/.test(url)) body = { ok: true, client: { id: Number(url.split("/").at(-1)), name: "Client", slug: null, website: null, status: "active" } };
        else if (url.includes("/sources/")) body = page(state.records, url.split("/")[4]);
        else if (c.method === "POST") {
          const id = Number(url.split("/").at(-1)); state.records = state.records.map((r) => r.id === id ? record(id, state.clientId) : r);
          body = { ok: true, source: url.split("/").at(-2), mapping: { record_id: id, client_id: state.clientId, mapping_id: TOKEN } };
        } else if (c.method === "DELETE") {
          const id = Number(url.split("/").at(-1)); state.records = state.records.map((r) => r.id === id ? record(id) : r);
          body = { ok: true, source: url.split("/").at(-2), deleted: true };
        } else throw new Error("Unexpected request " + url);
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
  const Component = load("components/features/manage/ClientReportingMappings.tsx").default;
  const root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const checkAccess = async () => state.check ? state.check() : state.allowed, clearContext = (message) => cleared.push(message);
  const render = async () => act(async () => root.render(React.createElement(Component, { key: state.clientId, clientId: state.clientId, checkAccess, clearContext })));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); previous.forEach((d, k) => {
    if (d) Object.defineProperty(global, k, d); else delete global[k];
  }); });
  const query = (selector) => dom.window.document.querySelector(selector);
  const row = (id) => query(`[data-record-id="${id}"]`);
  const button = (label, id) => [...(id === undefined ? dom.window.document : row(id)).querySelectorAll("button")].find((b) => b.textContent === label);
  const click = async (label, id, twice = false) => act(async () => { const b = button(label, id); assert.ok(b, label); b.click(); if (twice) b.click(); });
  await render();
  return { state, calls, cleared, query, row, button, click, render, text: () => dom.window.document.body.textContent,
    writes: () => calls.filter((c) => c.method !== "GET"), lists: () => calls.filter((c) => c.url.includes("/sources/")),
    resolve: async (pending, value) => act(async () => pending.resolve(value)),
    source: async (value) => act(async () => { const el = query('[name="mapping_source"]'); assert.ok(el);
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }) };
}
test("lists explicit ownership states; only unassigned records may be assigned and owned records removed", async (t) => {
  const h = await harness(t);
  assert.equal(h.lists()[0].url, BASE + "/sources/search-intel/records?limit=50");
  assert.ok(h.button("Assign to client", 1)); assert.ok(h.button("Remove mapping", 2));
  assert.equal(h.button("Remove mapping", 1), undefined); assert.equal(h.button("Assign to client", 3), undefined);
  assert.equal(h.button("Remove mapping", 3), undefined); assert.equal(h.writes().length, 0);
  assert.ok(h.calls.every((c) => c.credentials === "same-origin"));
});
test("assignment is explicit and duplicate clicks issue one write with no ownership fields", async (t) => {
  const h = await harness(t); await h.click("Assign to client", 1, true);
  assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].url, BASE + "/clients/11/mappings/search-intel/1");
  assert.equal(h.writes()[0].method, "POST"); assert.deepEqual(h.writes()[0].body, {});
  assert.ok(h.button("Remove mapping", 1));
});
test("removal requires confirmation, supports cancel and sends the exact observed mapping token", async (t) => {
  const h = await harness(t); await h.click("Remove mapping", 2); assert.equal(h.writes().length, 0);
  await h.click("Cancel removal"); assert.equal(h.writes().length, 0);
  await h.click("Remove mapping", 2); await h.click("Confirm removal", undefined, true);
  assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].method, "DELETE");
  assert.deepEqual(h.writes()[0].body, { mapping_id: TOKEN }); assert.ok(h.button("Assign to client", 2));
});
test("source selection is independent and late old-source data cannot replace the selected source", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url.includes("/sources/search-intel/") ? pending.promise : undefined);
  await h.source("campaigns"); await h.resolve(pending, page([{ ...record(99), label: "Stale secret" }]));
  assert.equal(h.query('[name="mapping_source"]').value, "campaigns"); assert.doesNotMatch(h.text(), /Stale secret/);
  assert.ok(h.lists().some((c) => c.url === BASE + "/sources/campaigns/records?limit=50"));
});
test("changing clients discards pending responses and removal confirmation", async (t) => {
  const h = await harness(t); await h.click("Remove mapping", 2); h.state.clientId = 22; await h.render();
  assert.equal(h.button("Confirm removal"), undefined); assert.equal(h.writes().length, 0);
  assert.equal(h.button("Remove mapping", 2), undefined); assert.ok(h.button("Remove mapping", 3));
});
test("late assignment result cannot update another client", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  await h.click("Assign to client", 1); h.state.clientId = 22; await h.render();
  await h.resolve(pending, { ok: true, source: "search-intel", mapping: { record_id: 1, client_id: 11, mapping_id: TOKEN } });
  assert.ok(h.button("Assign to client", 1)); assert.equal(h.writes().length, 1);
});
for (const switchTo of ["source", "client"]) test("switch during pending mutation preflight prevents old write: " + switchTo, async (t) => {
  const h = await harness(t), pending = deferred(); h.state.check = () => pending.promise;
  await h.click("Assign to client", 1); delete h.state.check;
  if (switchTo === "source") await h.source("campaigns"); else { h.state.clientId = 22; await h.render(); }
  await h.resolve(pending, true); assert.equal(h.writes().length, 0);
});
test("leaving and returning to an uncertain source reloads before enabling actions", async (t) => {
  let reload = false; const pending = deferred();
  const h = await harness(t, (c) => c.method === "POST" ? { ok: false, error: "mapping_conflict", httpStatus: 409 }
    : reload && c.url.includes("/sources/search-intel/") ? pending.promise : undefined);
  await h.click("Assign to client", 1); await h.source("campaigns"); reload = true; await h.source("search-intel");
  assert.equal(h.button("Assign to client"), undefined);
  await h.resolve(pending, page([record(1, 22)])); assert.equal(h.button("Assign to client", 1), undefined);
  assert.equal(h.writes().length, 1); assert.equal(h.lists().filter((c) => c.url.includes("/search-intel/")).length, 2);
});
test("pagination uses server cursor and preserves earlier records", async (t) => {
  const h = await harness(t, (c) => c.url.includes("/sources/") ? c.url.includes("cursor=") ? page([record(51)])
    : page(Array.from({ length: 50 }, (_, i) => record(i + 1)), "search-intel", { has_more: true, next_cursor: 50 }) : undefined);
  await h.click("Load more records"); assert.equal(h.lists()[1].url, BASE + "/sources/search-intel/records?limit=50&cursor=50");
  assert.ok(h.row(1)); assert.ok(h.row(51)); assert.equal(h.button("Load more records"), undefined);
});
for (const bad of [page([record(2), record(1)]), page([record(1), record(1)]), page([record(1)], "campaigns"),
  page([record(1)], "search-intel", { has_more: true, next_cursor: 1 }), page([{ ...record(1), mapping_id: TOKEN }]),
  page([{ ...record(1, 11), mapping_id: "invalid" }]), page([], "search-intel", { next_cursor: 9 })]) {
  test("malformed candidates are withheld: " + JSON.stringify(bad), async (t) => {
    const h = await harness(t, (c) => c.url.includes("/sources/") ? bad : undefined);
    assert.equal(h.query("[data-record-id]"), null); assert.ok(h.query('[role="alert"]')); assert.equal(h.writes().length, 0);
  });
}
for (const failure of [{ ok: false, error: "mapping_conflict", httpStatus: 409 }, { ok: false, error: "database_unavailable", httpStatus: 503 },
  { ok: true, source: "campaigns", mapping: { record_id: 1, client_id: 11, mapping_id: TOKEN } },
  ...[{ client_id: 22 }, { record_id: 2 }, { mapping_id: "invalid" }].map((extra) => ({ ok: true, source: "search-intel",
    mapping: { record_id: 1, client_id: 11, mapping_id: TOKEN, ...extra } })), "network"]) {
  test("uncertain assignment locks further writes until explicit reload: " + JSON.stringify(failure), async (t) => {
    const h = await harness(t, (c) => { if (c.method === "POST") { if (failure === "network") throw new Error("offline"); return failure; } });
    await h.click("Assign to client", 1); assert.equal(h.writes().length, 1); assert.ok(h.query('[role="alert"]'));
    const assign = h.button("Assign to client", 1); assert.ok(!assign || assign.disabled);
    await h.click("Reload mappings"); assert.ok(!h.button("Assign to client", 1).disabled); assert.equal(h.writes().length, 1);
  });
}
test("access revocation before a mutation prevents the write", async (t) => {
  const h = await harness(t); h.state.allowed = false; await h.click("Assign to client", 1); assert.equal(h.writes().length, 0);
});
test("ambiguous removal requires reload and cannot silently retry an observed mapping token", async (t) => {
  const h = await harness(t, (c) => c.method === "DELETE" ? { ok: true, source: "search-intel", deleted: false } : undefined);
  await h.click("Remove mapping", 2); await h.click("Confirm removal");
  assert.equal(h.writes().length, 1); assert.ok(h.query('[role="alert"]'));
  const remove = h.button("Remove mapping", 2); assert.ok(!remove || remove.disabled);
  await h.click("Reload mappings"); assert.ok(!h.button("Remove mapping", 2).disabled); assert.equal(h.writes().length, 1);
});
test("a repeated pagination cursor cannot append duplicates or leave records writable", async (t) => {
  const h = await harness(t, (c) => c.url.includes("/sources/") ? c.url.includes("cursor=") ? page([record(50)])
    : page(Array.from({ length: 50 }, (_, i) => record(i + 1)), "search-intel", { has_more: true, next_cursor: 50 }) : undefined);
  await h.click("Load more records"); assert.ok(h.query('[role="alert"]'));
  assert.ok(!h.button("Assign to client", 1) || h.button("Assign to client", 1).disabled); assert.equal(h.writes().length, 0);
});
for (const status of [401, 403]) test("server denial clears protected parent context: " + status, async (t) => {
  const h = await harness(t, (c) => c.url.includes("/sources/") ? { ok: false, error: status === 401 ? "auth_required" : "permission_denied", httpStatus: status } : undefined);
  assert.equal(h.cleared.length, 1); assert.equal(h.query("[data-record-id]"), null);
});
test("archived or missing client cannot expose candidates", async (t) => {
  const h = await harness(t, (c) => /\/clients\/\d+$/.test(c.url) ? { ok: false, error: "client_not_found", httpStatus: 404 } : undefined);
  assert.equal(h.lists().length, 0); assert.equal(h.query("[data-record-id]"), null); assert.equal(h.writes().length, 0);
});
test("an empty source remains empty and never fabricates assignment actions", async (t) => {
  const h = await harness(t, (c) => c.url.includes("/sources/") ? page([]) : undefined);
  assert.equal(h.query("[data-record-id]"), null); assert.equal(h.button("Assign to client"), undefined); assert.equal(h.writes().length, 0);
});
