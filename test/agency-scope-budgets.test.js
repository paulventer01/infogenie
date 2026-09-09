"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { JSDOM } = require("jsdom"), { act } = React;
const API = "/api/agency-ops/scope-baselines";
const grants = ["tenant.billing.manage", "manage.projects.view", "manage.projects.edit"];
const baseline = (extra = {}) => ({ id: "scope_1", client_ref: "Client A", project_ref: null, name: "Annual agreement",
  period_start: "2026-01-01T00:00:00.000Z", period_end: "2026-12-31", contracted_hours: "12.30",
  change_budget_hours: "0.00", contracted_value: "999.99", currency: "EUR", active: true, ...extra });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function loader() {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } });
    const mod = { exports: {} };
    new Function("exports", "require", "module", outputText)(mod.exports, (id) => id.startsWith("@/lib/") ? load(id.slice(2) + ".ts")
      : id === "next/link" ? { default: ({ children, ...props }) => React.createElement("a", props, children) } : require(id), mod);
    cache.set(file, mod.exports); return mod.exports;
  };
  return load;
}
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/agency-scope-budgets", pretendToBeVisual: true });
  const calls = [], state = { user: 999, tenant: 7, permissions: [...grants], admin: false, rows: [baseline()] };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
      let body = await handler(call, state, calls);
      if (body === undefined) {
        if (url === "/api/tenants/me") body = { ok: true, user: { id: state.user }, activeTenantId: state.tenant };
        else if (url === "/api/tenants/active") body = { ok: true, tenant: { id: state.tenant }, permissions: state.permissions, isPlatformAdmin: state.admin };
        else if (url.startsWith(API) && call.method === "GET") {
          const q = new URL(url, "http://localhost").searchParams;
          body = { ok: true, period: { from: q.get("from"), to: q.get("to") }, baselines: state.rows.filter((row) => row.active
            && row.period_start.slice(0, 10) <= q.get("to") && row.period_end.slice(0, 10) >= q.get("from")
            && (!q.get("client_ref") || row.client_ref === q.get("client_ref"))) };
        } else if (url === API && call.method === "POST") {
          const saved = baseline({ ...call.body, id: "scope_saved", tenant_id: state.tenant, created_at: "extra DB field",
            period_start: call.body.period_start + "T00:00:00.000Z", period_end: call.body.period_end + "T00:00:00.000Z",
            ...Object.fromEntries(["contracted_hours", "change_budget_hours", "contracted_value"].map((key) => [key, call.body[key].toFixed(2)])) });
          state.rows = [saved, ...state.rows]; body = { ok: true, baseline: saved };
        } else throw new Error("Unexpected request: " + url);
      }
      return { ok: !body.httpStatus || body.httpStatus < 400, status: body.httpStatus || 200, headers: { get: () => "application/json" }, json: async () => body };
    } };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(global, key, { configurable: true, writable: true, value }));
  let root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const unmount = async () => { if (root) { await act(async () => root.unmount()); root = null; } };
  t.after(async () => { await unmount(); dom.window.close(); previous.forEach((descriptor, key) => {
    if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key];
  }); });
  const query = (selector) => dom.window.document.querySelector(selector);
  const set = async (name, value) => act(async () => {
    const el = query(`[name="${name}"]`); assert.ok(el, "Missing field " + name);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const submit = async (label = "Review scope budget") => act(async () => {
    const form = query(`form[aria-label="${label}"]`); assert.ok(form, label);
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  const click = async (label, twice = false) => act(async () => {
    const el = [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label); assert.ok(el, label);
    el.click(); if (twice) el.click();
  });
  const fill = async (extra = {}) => { for (const [key, value] of Object.entries({ client_ref: " Client A ", name: " September agreement ",
    contracted_hours: "0", change_budget_hours: "1000000", contracted_value: "1000000000", currency: " usd ",
    period_start: "2026-09-01", period_end: "2026-09-30", ...extra })) await set(key, value); };
  const load = loader(); await act(async () => root.render(React.createElement(load("components/features/manage/AgencyScopeBudgets.tsx").default)));
  return { state, calls, query, set, submit, click, fill, unmount, load, text: () => dom.window.document.body.textContent,
    event: async (name = "focus") => act(async () => (name === "visibilitychange" ? dom.window.document : dom.window).dispatchEvent(new dom.window.Event(name))),
    resolve: async (pending, value) => act(async () => pending.resolve(value)),
    lists: () => calls.filter((c) => c.url.startsWith(API) && c.method === "GET"), writes: () => calls.filter((c) => c.method !== "GET") };
}

test("normalizes raw pg fields, labels coverage honestly and wires the React route", async (t) => {
  const h = await harness(t);
  assert.match(h.query("tbody").textContent, /Annual agreement.*Client A.*All client projects.*2026-01-01.*12\.30.*0\.00.*999\.99.*EUR/);
  assert.match(h.text(), /full baseline period/); assert.match(h.text(), /independently count/); assert.match(h.text(), /not automatic versions or replacements/);
  assert.equal(h.query("tfoot"), null); assert.equal(h.query("select"), null);
  assert.equal(h.query("a").getAttribute("href"), "/manage/agency-ops-dashboard");
  assert.equal(h.load("lib/viewRoutes.ts").viewToPath("agency-scope-budgets"), "/manage/agency-scope-budgets");
  assert.ok(h.calls.every((c) => c.url.startsWith(API) || c.url.startsWith("/api/tenants/"))); assert.equal(h.writes().length, 0);
});
test("local month-to-date defaults respect both sides of UTC midnight", () => {
  const lib = loader()("lib/agencyScopeBudgets.ts"), previous = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    assert.deepEqual(lib.newFilters(new Date("2026-09-01T01:00:00Z")), { from: "2026-08-01", to: "2026-08-31", client_ref: "" });
    process.env.TZ = "Pacific/Kiritimati";
    assert.deepEqual(lib.newFilters(new Date("2026-09-30T23:00:00Z")), { from: "2026-10-01", to: "2026-10-01", client_ref: "" });
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("filters require explicit Apply, encode exact business refs, and block invalid ranges", async (t) => {
  const h = await harness(t);
  await h.set("filter_client_ref", " R&D / A&B "); assert.equal(h.lists().length, 1); assert.equal(h.query("tbody"), null);
  await h.set("filter_from", "2026-09-01"); await h.set("filter_to", "2026-09-30"); await h.submit("Scope filters");
  assert.deepEqual(Object.fromEntries(new URL(h.lists().at(-1).url, "http://localhost").searchParams), { from: "2026-09-01", to: "2026-09-30", client_ref: "R&D / A&B" });
  assert.match(h.text(), /No active baselines overlap/);
  for (const [key, value] of [["filter_to", "2026-08-31"], ["filter_from", ""]]) {
    await h.set(key, value); await h.submit("Scope filters"); assert.equal(h.lists().length, 2); assert.ok(h.query('[role="alert"]'));
  }
});
test("review is separate from explicit save, locks duplicate submits and refreshes created client/period", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  for (const key of ["contracted_hours", "change_budget_hours", "contracted_value", "currency"]) assert.equal(h.query(`[name="${key}"]`).value, "");
  await h.fill({ client_ref: " New client ", project_ref: " Campaign / 2 ", period_start: "2027-02-01", period_end: "2027-02-28" });
  await h.submit(); assert.equal(h.writes().length, 0); assert.match(h.query('[aria-label="Review baseline"]').textContent, /1000000000\.00 USD/);
  await h.click("Save active baseline", true); assert.equal(h.writes().length, 1); assert.doesNotMatch(h.text(), /Saved\./);
  const body = h.writes()[0].body;
  assert.deepEqual(body, { client_ref: "New client", project_ref: "Campaign / 2", name: "September agreement", period_start: "2027-02-01", period_end: "2027-02-28",
    contracted_hours: 0, change_budget_hours: 1000000, contracted_value: 1000000000, currency: "USD", active: true });
  const saved = baseline({ ...body, id: "scope_saved", contracted_value: "1000000000.00", period_start: body.period_start + "T00:00:00.000Z", tenant_id: 7 });
  h.state.rows = [saved]; await h.resolve(pending, { ok: true, baseline: saved });
  assert.match(h.text(), /Saved\. The list was refreshed/); assert.match(h.query("tbody").textContent, /New client.*Campaign \/ 2/);
  for (const [key, value] of Object.entries({ filter_client_ref: body.client_ref, filter_from: body.period_start, filter_to: body.period_end, contracted_value: "" })) assert.equal(h.query(`[name="${key}"]`).value, value);
  assert.deepEqual(Object.fromEntries(new URL(h.lists().at(-1).url, "http://localhost").searchParams), { from: body.period_start, to: body.period_end, client_ref: body.client_ref });
});
test("loaded overlaps warn at review, with all-project coverage and inclusive boundary semantics", async (t) => {
  const h = await harness(t); await h.fill(); await h.submit();
  assert.match(h.text(), /1 loaded baseline\(s\) overlap/); assert.match(h.text(), /Filters may exclude other overlaps/);
  await h.click("Back to draft"); await h.set("contracted_hours", "10"); assert.equal(h.query('[aria-label="Review baseline"]'), null);
  const lib = h.load("lib/agencyScopeBudgets.ts"), row = lib.normalizeBaseline(baseline({ project_ref: "X" })), payload = { ...row, period_start: "2026-12-31", period_end: "2027-01-02" };
  assert.equal(lib.overlappingBaselines([row], payload).length, 1);
  assert.equal(lib.overlappingBaselines([row], { ...payload, project_ref: null }).length, 1);
  assert.equal(lib.overlappingBaselines([row], { ...payload, project_ref: "Y" }).length, 0);
  assert.equal(lib.overlappingBaselines([row], { ...payload, client_ref: "Other" }).length, 0);
  assert.equal(lib.overlappingBaselines([row], { ...payload, period_start: "2027-01-01" }).length, 0);
});
test("review blocks blanks, precision/range errors, invalid dates and overlong references/currency", async (t) => {
  const h = await harness(t); await h.fill();
  for (const [key, invalid, valid] of [["client_ref", " ", "Client A"], ["name", "", "Agreement"], ["project_ref", "x".repeat(201), ""],
    ["contracted_hours", "", "0"], ["contracted_hours", "0.001", "0.01"], ["change_budget_hours", " ", "0"],
    ["change_budget_hours", "1000000.01", "1000000"], ["contracted_value", "", "0"], ["contracted_value", "1000000000.01", "1000000000"],
    ["contracted_value", "-1", "0"], ["contracted_value", "1e3", "0"], ["currency", " ", "USD"], ["currency", "x".repeat(11), "USD"], ["period_end", "2026-08-31", "2026-09-30"]]) {
    await h.set(key, invalid); await h.submit(); assert.equal(h.query('[aria-label="Review baseline"]'), null, key + invalid);
    assert.equal(h.writes().length, 0); assert.ok(h.query('[role="alert"]')); await h.set(key, valid);
  }
  const lib = h.load("lib/agencyScopeBudgets.ts"), draft = { ...lib.newDraft(), client_ref: "A", name: "B", currency: "USD", contracted_hours: "0", change_budget_hours: "0", contracted_value: "0" };
  assert.ok(lib.draftError({ ...draft, period_start: "2026-02-30" })); assert.ok(lib.draftError({ ...draft, period_end: "2026-13-01" }));
  assert.ok(lib.filterError({ from: "2026-02-29", to: "2026-03-01", client_ref: "" }));
});
test("raw contract normalization rejects malformed dates, amounts, active flags, IDs and currency", () => {
  const lib = loader()("lib/agencyScopeBudgets.ts");
  for (const day of ["2026-02-30", "2026-09-09T01:00:00.000Z", "2026-09-09T00:00:00+01:00", "2026-09-09T00:00:00.001Z", "2026-09-09T00:00:00-08:00"]) assert.equal(lib.calendarDay(day), null, day);
  for (const day of ["2024-02-29", "2024-02-29T00:00:00Z", "2024-02-29T00:00:00.000Z"]) assert.equal(lib.calendarDay(day), "2024-02-29");
  for (const key of ["contracted_hours", "change_budget_hours", "contracted_value"]) {
    for (const value of [null, true, "", " ", "NaN", "Infinity", Infinity, NaN, "1e3", "0.001", -1, "1000000000.01"]) assert.equal(lib.normalizeBaseline(baseline({ [key]: value })), null, key + String(value));
  }
  for (const extra of [{ id: "" }, { id: 1 }, { active: false }, { active: "true" }, { currency: "" }, { currency: "X".repeat(11) }, { client_ref: null }, { project_ref: 9 }, { name: " " }]) assert.equal(lib.normalizeBaseline(baseline(extra)), null);
  const normalized = lib.normalizeBaseline(baseline({ currency: " usd " })); assert.equal(normalized.currency, "USD");
  assert.equal(lib.matchesPayload(normalized, { ...normalized, contracted_hours: 99 }), false);
});
for (const failure of [{ ok: false, error: "offline", httpStatus: 503 }, { ok: true }, { ok: true, baseline: baseline() },
  { ok: true, data_unavailable: true }, "network"]) test("uncertain POST retains draft without retry: " + JSON.stringify(failure), async (t) => {
  const h = await harness(t, (c) => { if (c.method === "POST") { if (failure === "network") throw new Error("offline"); return failure; } });
  await h.fill(); await h.submit(); await h.click("Save active baseline");
  assert.equal(h.writes().length, 1); assert.equal(h.lists().length, 1); assert.equal(h.query('[name="contracted_value"]').value, "1000000000");
  assert.match(h.text(), /Save not confirmed\. Draft retained\. Verify the list/); assert.doesNotMatch(h.text(), /Saved\./);
});
test("confirmed POST with failed refresh stays saved; manual refresh only GETs", async (t) => {
  let posted = false; const h = await harness(t, (c) => {
    if (c.method === "POST") posted = true; else if (c.url.startsWith(API) && posted) return { ok: false, error: "refresh offline" };
  });
  await h.fill(); await h.submit(); await h.click("Save active baseline");
  assert.match(h.text(), /Saved, but list refresh failed/); assert.equal(h.query('[name="contracted_value"]').value, "");
  await h.submit("Scope filters"); assert.equal(h.writes().length, 1); assert.equal(h.lists().length, 3);
});
test("empty and malformed lists are honest, with no inherited 500-row cap or mixed totals", async (t) => {
  let response = { ok: true, baselines: [] }; const h = await harness(t, (c) => c.url.startsWith(API) ? response : undefined);
  assert.match(h.text(), /No active baselines overlap/);
  for (const baselines of [[baseline(), baseline()], [baseline({ active: false })], [baseline({ period_end: "2026-01-01" })], [baseline({ _fabricated: true })]]) {
    response = { ok: true, baselines }; await h.submit("Scope filters"); assert.equal(h.query("tbody"), null); assert.ok(h.query('[role="alert"]'));
  }
  response = { ok: true, baselines: Array.from({ length: 501 }, (_, i) => baseline({ id: "scope_" + i, currency: i ? "USD" : "EUR" })) };
  await h.submit("Scope filters"); assert.equal(h.query("tbody").children.length, 501); assert.equal(h.query("tfoot"), null);
  assert.match(h.query("tbody").textContent, /EUR/); assert.match(h.query("tbody").textContent, /USD/);
});
test("read-only access hides creation and write revocation blocks a reviewed save", async (t) => {
  const h = await harness(t); await h.fill(); await h.submit(); h.state.permissions = grants.slice(0, 2); await h.click("Save active baseline");
  assert.equal(h.writes().length, 0); assert.match(h.text(), /Read-only access/); assert.equal(h.query('form[aria-label="Review scope budget"]'), null);
});
for (const event of ["focus", "pageshow", "storage", "visibilitychange"]) test("read revocation clears every financial surface on " + event, async (t) => {
  const h = await harness(t); await h.fill(); await h.submit(); h.state.permissions = [grants[2]]; await h.event(event);
  assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="contracted_value"]'), null); assert.equal(h.query('[aria-label="Review baseline"]'), null);
  assert.doesNotMatch(h.text(), /Annual agreement/); assert.match(h.text(), /Read access was revoked/);
});
for (const identity of ["user", "tenant"]) test("identity changes discard pending protected reads: " + identity, async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url.startsWith(API) ? pending.promise : undefined);
  h.state[identity]++; await h.resolve(pending, { ok: true, baselines: [baseline()] });
  assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="contracted_value"]'), null); assert.match(h.text(), /Account or workspace changed/);
});
test("verification outage hides financial state, retains draft and requires explicit recovery", async (t) => {
  let fail = false; const h = await harness(t, (c) => fail && c.url.endsWith("/me") ? { ok: false, error: "verification offline" } : undefined);
  await h.fill(); fail = true; await h.event(); assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="contracted_value"]'), null);
  assert.match(h.text(), /Scope data is hidden/); fail = false; await h.click("Retry access check");
  assert.equal(h.query('[name="contracted_value"]').value, "1000000000"); assert.equal(h.writes().length, 0);
});
test("pending filtered GET cannot overwrite a newer applied filter", async (t) => {
  const pending = deferred(); let slow = true; const h = await harness(t, (c) => c.url.startsWith(API) && slow ? pending.promise : undefined);
  await h.set("filter_client_ref", "Other"); slow = false; await h.submit("Scope filters");
  await h.resolve(pending, { ok: true, baselines: [baseline()] }); assert.equal(h.query("tbody"), null); assert.match(h.text(), /No active baselines overlap/);
});
test("focus detects account switch during POST and discards save completion", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  await h.fill(); await h.submit(); await h.click("Save active baseline"); h.state.user++; await h.event();
  await h.resolve(pending, { ok: true, baseline: baseline(h.writes()[0].body) });
  assert.equal(h.query("tbody"), null); assert.doesNotMatch(h.text(), /Saved\./); assert.equal(h.lists().length, 1);
});
test("unmount discards pending POST completion and never refreshes", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  await h.fill(); await h.submit(); await h.click("Save active baseline"); await h.unmount();
  await h.resolve(pending, { ok: true, baseline: baseline(h.writes()[0].body) }); assert.equal(h.text(), ""); assert.equal(h.lists().length, 1);
});
