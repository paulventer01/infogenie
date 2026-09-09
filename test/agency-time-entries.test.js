"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { act } = React;
const ROOT = path.join(__dirname, "..");
const API = "/api/agency-ops/time-entries";
const grants = ["tenant.billing.manage", "manage.projects.view", "manage.projects.edit"];
const roster = [{ id: "cap_7", member_name: "Alex", active: true }];
const entry = (extra = {}) => ({ id: "time_1", member_id: "cap_7", client_ref: "client-a", project_ref: null,
  work_item: "Existing work", work_date: "2026-09-08", hours: 2, billable: true, notes: "", ...extra });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function moduleLoader() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019,
    } });
    const module = { exports: {} };
    new Function("exports", "require", "module", outputText)(module.exports, (request) => {
      if (request.startsWith("@/lib/")) return load(request.slice(2) + ".ts");
      if (request === "next/link") return { default: ({ children, ...props }) => React.createElement("a", props, children) };
      return require(request);
    }, module);
    cache.set(file, module.exports);
    return module.exports;
  }
  return load;
}
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/manage/agency-time-entries", pretendToBeVisual: true });
  const calls = [];
  const state = { tenant: 7, permissions: [...grants], isPlatformAdmin: false, entries: [entry()], members: roster };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined };
      calls.push(call);
      let body = await handler(call, state, calls);
      if (body === undefined) {
        if (url === "/api/tenants/me") body = { ok: true, activeTenantId: state.tenant, user: { id: 999 } };
        else if (url === "/api/tenants/active") body = { ok: true, tenant: { id: state.tenant }, permissions: state.permissions, isPlatformAdmin: state.isPlatformAdmin };
        else if (url === "/api/capacity/summary") body = { ok: true, members: state.members };
        else if (url.startsWith(API) && call.method === "GET") body = { ok: true, entries: state.entries };
        else throw new Error("Unexpected request: " + call.method + " " + url);
      }
      return { ok: !body.httpStatus || body.httpStatus < 400, status: body.httpStatus || 200,
        headers: { get: () => "application/json" }, json: async () => body };
    } };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const load = moduleLoader();
  const { createRoot } = require("react-dom/client");
  let root = createRoot(dom.window.document.getElementById("root"));
  const mount = async (Component) => act(async () => root.render(React.createElement(Component)));
  const unmount = async () => { if (root) { await act(async () => root.unmount()); root = null; } };
  t.after(async () => {
    await unmount(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  const query = (selector) => dom.window.document.querySelector(selector);
  const set = async (name, value) => act(async () => {
    const element = query(`[name="${name}"]`);
    assert.ok(element, "Missing field " + name);
    if (element.type === "checkbox") element.click();
    else {
      const prototype = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype
        : element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }
  });
  const click = async (label) => act(async () => {
    const target = Array.from(dom.window.document.querySelectorAll("button")).find((element) => element.textContent === label);
    assert.ok(target, "Missing button " + label); target.click();
  });
  const submit = async (label = "Save time entry", twice = false) => act(async () => {
    const form = query(`form[aria-label="${label}"]`);
    assert.ok(form, "Missing form " + label);
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    if (twice) form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  const fill = async () => {
    for (const [key, value] of Object.entries({ member_id: "cap_7", client_ref: " client & a ", work_item: "New work", work_date: "2026-09-08", hours: "1.25" })) await set(key, value);
  };
  await mount(load("components/features/manage/AgencyTimeEntries.tsx").default);
  return { calls, state, query, set, click, submit, fill, mount, unmount, load,
    text: () => dom.window.document.body.textContent,
    resolve: async (pending, value) => act(async () => pending.resolve(value)),
    focus: async () => act(async () => dom.window.dispatchEvent(new dom.window.Event("focus"))),
    writes: () => calls.filter((call) => call.method !== "GET"),
    lists: () => calls.filter((call) => call.url.startsWith(API) && call.method === "GET") };
}

test("verifies /me then /active before any protected read; active roster IDs are not user IDs", async (t) => {
  const pending = deferred();
  const h = await harness(t, ({ url }) => url === "/api/tenants/active" ? pending.promise : undefined);
  assert.deepEqual(h.calls.map((call) => call.url), ["/api/tenants/me", "/api/tenants/active"]);
  assert.match(h.text(), /Verifying tenant/);
  await h.resolve(pending, { ok: true, tenant: { id: 7 }, permissions: grants, isPlatformAdmin: false });
  assert.match(h.text(), /Existing work/);
  assert.match(h.query('[name="member_filter"]').textContent, /Alex/);
  assert.equal(h.calls.some((call) => call.url === "/api/capacity/members"), false);
  assert.equal(h.query('[name="member_id"] option[value="999"]'), null);
  assert.equal(h.query('[name="member_id"] option[value="cap_old"]'), null);
  assert.equal(h.writes().length, 0);
});
for (const permissions of [[], [grants[0]], [grants[1]], [grants[2]]]) {
  test("denies incomplete read grants: " + permissions.join(","), async (t) => {
    const h = await harness(t, ({ url }) => url.endsWith("/active") ? { ok: true, tenant: { id: 7 }, permissions, isPlatformAdmin: false, isAdmin: true, role: { key: "owner" } } : undefined);
    assert.match(h.text(), /Access denied/); assert.equal(h.lists().length, 0);
    assert.equal(h.calls.some((call) => call.url.includes("capacity")), false);
    assert.equal(h.query('form[aria-label="Save time entry"]'), null);
  });
}
test("read-only managers cannot mutate; only explicit isPlatformAdmin bypasses grants", async (t) => {
  const h = await harness(t, ({ url }, state) => { if (url.endsWith("/active")) state.permissions = grants.slice(0, 2); });
  assert.match(h.text(), /Read-only access/); assert.equal(h.query('form[aria-label="Save time entry"]'), null);
  h.state.isPlatformAdmin = true; h.state.permissions = [];
  await h.focus(); assert.ok(h.query('form[aria-label="Save time entry"]'));
});
for (const response of [{ ok: false, error: "auth_required", httpStatus: 401 }, { ok: true }, { ok: true, activeTenantId: null }, { ok: true, data_unavailable: true }]) {
  test("bootstrap fails closed without protected reads: " + JSON.stringify(response), async (t) => {
    const h = await harness(t, ({ url }) => url.endsWith("/me") ? response : undefined);
    assert.equal(h.lists().length, 0); assert.ok(h.query('[role="alert"]'));
  });
}
test("mismatched tenant contexts and malformed permission envelopes fail closed", async (t) => {
  let response = { ok: true, tenant: { id: 8 }, permissions: grants, isPlatformAdmin: true };
  const h = await harness(t, ({ url }) => url.endsWith("/active") ? response : undefined);
  assert.match(h.text(), /changed during verification/); assert.equal(h.lists().length, 0);
  response = { ok: true, tenant: { id: 7 }, permissions: "*", isPlatformAdmin: true };
  await h.click("Retry permissions"); assert.equal(h.lists().length, 0);
  response = { ok: true, tenant: { id: 7 }, permissions: grants, isPlatformAdmin: false };
  await h.click("Retry permissions"); assert.equal(h.lists().length, 1);
});
test("explicit filters encode exact references, dates and capacity IDs; invalid ranges never fetch", async (t) => {
  const h = await harness(t, (call) => call.url.startsWith(API) ? { ok: true, entries: [entry({ member_id: "cap_old" })] } : undefined);
  await h.set("from", "2026-08-01"); await h.set("to", "2026-08-31");
  await h.set("client_filter", " a/b & c "); await h.set("member_filter", "cap_old");
  assert.equal(h.lists().length, 1); assert.equal(h.query("tbody"), null);
  await h.submit("Time-entry filters");
  const params = new URL(h.lists().at(-1).url, "http://localhost").searchParams;
  assert.deepEqual(Object.fromEntries(params), { from: "2026-08-01", to: "2026-08-31", client_ref: "a/b & c", member_id: "cap_old" });
  await h.set("from", "2026-09-01"); await h.submit("Time-entry filters");
  assert.equal(h.lists().length, 2); assert.match(h.text(), /From must be on or before To/);
});
test("create waits for verified save, suppresses duplicate submits and refreshes persisted entries", async (t) => {
  const pending = deferred();
  const h = await harness(t, (call) => call.method === "POST" ? pending.promise : undefined);
  await h.fill(); await h.set("project_ref", "project-9"); await h.set("notes", "Saved notes"); await h.set("billable", false);
  await h.submit("Save time entry", true);
  assert.equal(h.writes().length, 1); assert.doesNotMatch(h.text(), /Saved\./);
  assert.equal(h.query('[name="work_item"]').value, "New work");
  assert.deepEqual(h.writes()[0], { url: API, method: "POST", body: { member_id: "cap_7", client_ref: "client & a", project_ref: "project-9", work_item: "New work", work_date: "2026-09-08", hours: 1.25, billable: false, notes: "Saved notes" } });
  const beforeWrite = h.calls.slice(0, h.calls.indexOf(h.writes()[0]));
  assert.deepEqual(beforeWrite.slice(-2).map((call) => call.url), ["/api/tenants/me", "/api/tenants/active"]);
  h.state.entries = [entry(h.writes()[0].body)];
  await h.resolve(pending, { ok: true, entry: h.state.entries[0] });
  assert.equal(h.lists().length, 2); assert.match(h.query("tbody").textContent, /New work/);
  assert.equal(h.query('[name="work_item"]').value, ""); assert.match(h.text(), /Saved\./);
});
test("corrects an inactive roster member via PATCH with optional fields cleared", async (t) => {
  const old = entry({ id: "time/a", member_id: "cap_old", project_ref: "old-project", notes: "Old notes" });
  const h = await harness(t, (call, state) => {
    if (call.method === "PATCH") { state.entries = [{ ...old, ...call.body }]; return { ok: true, entry: state.entries[0] }; }
    if (call.url.startsWith(API)) return { ok: true, entries: [old] };
  });
  await h.click("Correct"); assert.equal(h.query('[name="member_id"]').value, "cap_old");
  assert.match(h.query('[name="member_id"]').textContent, /existing member \(not in active roster\)/);
  await h.set("hours", "24"); await h.set("project_ref", ""); await h.set("notes", ""); await h.set("billable", false);
  await h.submit();
  assert.equal(h.writes()[0].url, API + "/time%2Fa"); assert.equal(h.writes()[0].method, "PATCH");
  assert.equal(h.writes()[0].body.member_id, "cap_old"); assert.equal(h.writes()[0].body.project_ref, null);
  assert.equal(h.writes()[0].body.hours, 24); assert.equal(h.writes()[0].body.notes, "");
});
test("required fields, hour bounds and note/reference lengths reject invalid drafts without writes", async (t) => {
  const h = await harness(t); await h.fill();
  for (const [name, invalid, valid] of [["member_id", "", "cap_7"], ["client_ref", "  ", "client-a"], ["work_item", "", "Work"],
    ["hours", "0", "0.01"], ["hours", "24.01", "24"], ["hours", "", "1"], ["work_date", "", "2026-09-08"],
    ["notes", "n".repeat(2001), ""], ["project_ref", "p".repeat(201), ""]]) {
    await h.set(name, invalid); await h.submit(); assert.equal(h.writes().length, 0, name); assert.ok(h.query('[role="alert"]'));
    await h.set(name, valid);
  }
  assert.equal(h.query('[name="notes"]').maxLength, 2000);
});
for (const failure of [{ ok: false, error: "invalid hours", httpStatus: 400 }, { ok: false, error: "database unavailable", httpStatus: 503 },
  { ok: true, data_unavailable: true, message: "Strict data withheld" }, { ok: true }, "network"]) {
  test("failed save preserves draft with no automatic retry: " + JSON.stringify(failure), async (t) => {
    const h = await harness(t, (call) => { if (call.method === "POST") { if (failure === "network") throw new Error("offline"); return failure; } });
    await h.fill(); await h.submit();
    assert.equal(h.writes().length, 1); assert.equal(h.lists().length, 1);
    assert.equal(h.query('[name="work_item"]').value, "New work"); assert.match(h.text(), /Save not confirmed.*Draft retained/);
    await h.submit(); assert.equal(h.writes().length, 2);
  });
}
test("saved-but-refresh-failed is distinct, with explicit GET retry only", async (t) => {
  const h = await harness(t, (call, state) => {
    if (call.method === "POST") { state.entries = [entry(call.body)]; return { ok: true, entry: state.entries[0] }; }
    if (call.url.startsWith(API) && state.entries[0].work_item === "New work") return { ok: false, error: "refresh offline" };
  });
  await h.fill(); await h.submit(); assert.match(h.text(), /Saved, but list refresh failed/);
  assert.equal(h.query('[name="work_item"]').value, ""); await h.submit("Time-entry filters");
  assert.equal(h.writes().length, 1); assert.equal(h.lists().length, 3);
});
test("empty, strict, malformed and capped lists are honest and do not show totals", async (t) => {
  let response = { ok: true, entries: [] };
  const h = await harness(t, (call) => call.url.startsWith(API) ? response : undefined);
  assert.match(h.text(), /No time entries match/);
  for (const next of [{ ok: true }, { ok: true, entries: [entry({ hours: "2" })] },
    { ok: true, entries: [entry({ _fabricated: true })] }, { ok: true, data_unavailable: true, entries: [entry()] },
    { ok: false, error: "rate limit", httpStatus: 429 }]) {
    response = next; await h.submit("Time-entry filters"); assert.equal(h.query("tbody"), null);
    assert.ok(h.query('[role="alert"]')); assert.doesNotMatch(h.text(), /No time entries match/);
  }
  response = { ok: true, entries: Array.from({ length: 500 }, (_, id) => entry({ id: String(id) })) };
  await h.submit("Time-entry filters"); assert.equal(h.query("tbody").children.length, 500);
  assert.match(h.text(), /500-entry limit reached.*narrow.*No totals are shown/);
});
test("missing or unavailable roster never seeds members or invents choices", async (t) => {
  let response = { ok: false, error: "roster offline" };
  const h = await harness(t, ({ url }) => url.includes("capacity") ? response : undefined);
  assert.match(h.text(), /Capacity roster unavailable/); assert.ok(h.query("tbody"));
  response = { ok: true, members: [] }; await h.click("Retry roster"); assert.match(h.text(), /No capacity roster members exist/);
  await h.submit(); assert.equal(h.writes().length, 0);
  response = { ok: true, members: [{ id: "cap_bad", name: "Wrong contract" }] };
  await h.submit("Time-entry filters"); // A list refresh does not silently retry the roster.
  assert.equal(h.calls.filter((call) => call.url.includes("capacity")).length, 2);
});
test("stale list responses cannot overwrite current filters, even before Apply", async (t) => {
  const stale = deferred();
  let first = true;
  const h = await harness(t, (call) => { if (call.url.startsWith(API) && first) { first = false; return stale.promise; } });
  await h.set("client_filter", "fresh"); assert.match(h.text(), /Filters changed/);
  h.state.entries = [entry({ work_item: "Fresh filtered work" })]; await h.submit("Time-entry filters");
  await h.resolve(stale, { ok: true, entries: [entry({ work_item: "Stale work" })] });
  assert.match(h.text(), /Fresh filtered work/); assert.doesNotMatch(h.text(), /Stale work/);
});
test("unmount invalidates pending preflight so it cannot write", async (t) => {
  let gate;
  const h = await harness(t, ({ url }) => url.endsWith("/me") && gate ? gate.promise : undefined);
  await h.fill(); gate = deferred(); await h.submit(); await h.unmount();
  await h.resolve(gate, { ok: true, activeTenantId: 7 }); assert.equal(h.writes().length, 0);
});
test("tenant change at save clears old draft/list and requires fresh verification", async (t) => {
  const h = await harness(t); await h.fill(); h.state.tenant = 8; await h.submit();
  assert.equal(h.writes().length, 0); assert.match(h.text(), /Workspace changed.*old draft and list were cleared/);
  assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="work_item"]'), null);
  await h.click("Retry permissions"); assert.equal(h.query('[name="work_item"]').value, "");
});
test("focus rechecks workspace and save rechecks revoked permissions without bypass", async (t) => {
  const h = await harness(t); await h.fill(); h.state.permissions = grants.slice(0, 2); await h.submit();
  assert.equal(h.writes().length, 0); assert.match(h.text(), /Save not attempted/);
  h.state.permissions = [...grants]; await h.focus(); assert.equal(h.query('[name="work_item"]').value, "New work");
  h.state.tenant = 8; await h.focus(); assert.match(h.text(), /Workspace changed/); assert.equal(h.query("tbody"), null);
});
test("failed permission preflight preserves draft and makes no mutation", async (t) => {
  let fail = false;
  const h = await harness(t, ({ url }) => fail && url.endsWith("/me") ? { ok: false, error: "verification offline" } : undefined);
  await h.fill(); fail = true; await h.submit(); assert.equal(h.writes().length, 0);
  assert.match(h.text(), /Save not attempted.*verification offline/); assert.equal(h.query('[name="work_item"]').value, "New work");
});
for (const error of ["auth_required", "unauthorized", "permission_denied"]) {
  test("explicit authentication loss clears sensitive state on focus: " + error, async (t) => {
    let expired = false;
    const h = await harness(t, ({ url }) => expired && url.endsWith("/me") ? { ok: false, error } : undefined);
    await h.fill(); expired = true; await h.focus();
    assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="work_item"]'), null);
    assert.equal(h.query('[name="member_filter"]'), null); assert.doesNotMatch(h.text(), /Existing work|Alex/);
    assert.match(h.text(), new RegExp(error)); assert.equal(h.writes().length, 0);
  });
}
test("explicit authentication loss at save preflight prevents mutation", async (t) => {
  let expired = false;
  const h = await harness(t, ({ url }) => expired && url.endsWith("/active") ? { ok: false, error: "auth_required" } : undefined);
  await h.fill(); expired = true; await h.submit();
  assert.equal(h.query('[name="work_item"]'), null); assert.equal(h.writes().length, 0);
});
test("server mutation permission denial clears sensitive state rather than retaining an unauthorized draft", async (t) => {
  const h = await harness(t, (call) => call.method === "POST" ? { ok: false, error: "forbidden", httpStatus: 403 } : undefined);
  await h.fill(); await h.submit(); assert.equal(h.query("tbody"), null);
  assert.equal(h.query('[name="work_item"]'), null); assert.match(h.text(), /forbidden/);
});
test("dashboard return reads persisted data; navigation stays in the migrated manage route", async (t) => {
  const h = await harness(t, (call, state) => {
    if (call.method === "POST") { state.entries = [entry(call.body)]; return { ok: true, entry: state.entries[0] }; }
    if (call.url.startsWith("/api/agency-ops/summary")) return { ok: true, totals: { hours: state.entries[0].hours }, clients: [], scope_signals: [] };
    if (call.url.includes("/capacity-summary")) return { ok: true, totals: {} };
  });
  assert.equal(h.query('a').getAttribute("href"), "/manage/agency-ops-dashboard");
  await h.fill(); await h.submit();
  assert.equal(h.writes().length, 1);
  await h.mount(h.load("components/features/manage/AgencyOpsDashboard.tsx").default);
  assert.match(h.text(), /Logged time1\.25h/); assert.equal(h.calls.filter((call) => call.url.startsWith("/api/agency-ops/summary")).length, 1);
  const routes = h.load("lib/viewRoutes.ts"); assert.equal(routes.viewToPath("agency-time-entries"), "/manage/agency-time-entries");
});
test("list refresh after a workspace switch discards old state without reading the new workspace", async (t) => {
  const h = await harness(t); await h.fill(); h.state.tenant = 8;
  await h.submit("Time-entry filters"); assert.equal(h.lists().length, 1);
  assert.match(h.text(), /Workspace changed/); assert.equal(h.query('[name="work_item"]'), null);
});
test("unmount invalidates pending list data", async (t) => {
  const pending = deferred();
  const h = await harness(t, (call) => call.url.startsWith(API) ? pending.promise : undefined);
  await h.unmount(); await h.resolve(pending, { ok: true, entries: [entry()] });
  assert.equal(h.text(), ""); assert.equal(h.writes().length, 0);
});
test("an empty active roster permits correcting the unchanged verified historical member", async (t) => {
  const old = entry({ member_id: "cap_old" });
  const h = await harness(t, (call) => {
    if (call.url === "/api/capacity/summary") return { ok: true, members: [] };
    if (call.method === "PATCH") return { ok: true, entry: { ...old, ...call.body } };
    if (call.url.startsWith(API)) return { ok: true, entries: [old] };
  });
  await h.click("Correct"); await h.set("hours", "0.01"); await h.submit();
  assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].body.member_id, "cap_old");
  assert.equal(h.writes()[0].body.hours, 0.01);
});
