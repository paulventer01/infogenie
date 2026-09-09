"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { act } = React;
const API = "/api/agency-ops/rates";
const grants = ["tenant.billing.manage", "manage.projects.view", "manage.projects.edit"];
const member = { id: "cap_7", member_name: "Alex", role: "Designer", active: true };
const rate = (extra = {}) => ({ id: "rate_1", member_id: "cap_7", role: null, cost_rate: 12.34, bill_rate: 56.78,
  currency: "EUR", effective_from: "2026-09-08", effective_to: null, active: true, ...extra });
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
// Small panel-only harness; restores descriptors, including Node 24's read-only navigator.
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/agency-rate-cards", pretendToBeVisual: true });
  const calls = [], state = { user: 999, tenant: 7, permissions: [...grants], admin: false, members: [member], rates: [rate()] };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
      let body = await handler(call, state, calls);
      if (body === undefined) {
        if (url === "/api/tenants/me") body = { ok: true, user: { id: state.user }, activeTenantId: state.tenant };
        else if (url === "/api/tenants/active") body = { ok: true, tenant: { id: state.tenant }, permissions: state.permissions, isPlatformAdmin: state.admin };
        else if (url === "/api/capacity/summary") body = { ok: true, members: state.members };
        else if (url.startsWith(API) && call.method === "GET") body = { ok: true, rates: state.rates };
        else if (url === API && call.method === "POST") { const saved = rate({ ...call.body, id: "rate_saved" }); state.rates = [saved, ...state.rates]; body = { ok: true, rate: saved }; }
        else throw new Error("Unexpected request: " + url);
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
    if (el.type === "checkbox") { if (el.checked !== value) el.click(); return; }
    const prototype = el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const submit = async (label = "Save rate", twice = false) => act(async () => {
    const form = query(`form[aria-label="${label}"]`); assert.ok(form, "Missing form " + label);
    for (let n = 0; n < (twice ? 2 : 1); n++) form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  const click = async (label) => act(async () => {
    const el = [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label); assert.ok(el, label); el.click();
  });
  const fill = async () => { for (const [key, value] of Object.entries({ member_id: "cap_7", cost_rate: "0", bill_rate: "1000000", currency: " usd ", effective_from: "2026-09-09" })) await set(key, value); };
  const load = loader(); await act(async () => root.render(React.createElement(load("components/features/manage/AgencyRateCards.tsx").default)));
  return { state, calls, query, set, submit, click, fill, unmount, load, text: () => dom.window.document.body.textContent,
    event: async (name = "focus") => act(async () => (name === "visibilitychange" ? dom.window.document : dom.window).dispatchEvent(new dom.window.Event(name))),
    resolve: async (pending, value) => act(async () => pending.resolve(value)),
    lists: () => calls.filter((c) => c.url.startsWith(API) && c.method === "GET"), writes: () => calls.filter((c) => c.method !== "GET") };
}

test("verifies user and tenant before protected reads; uses active roster, reliable labels and per-row currencies", async (t) => {
  const gate = deferred();
  const h = await harness(t, ({ url }) => url.endsWith("/active") ? gate.promise : undefined);
  assert.equal(h.lists().length, 0); assert.equal(h.calls.some((c) => c.url.includes("capacity")), false);
  await h.resolve(gate, { ok: true, tenant: { id: 7 }, permissions: grants, isPlatformAdmin: false });
  assert.match(h.query("tbody").textContent, /Alex \(cap_7\).*12\.34.*56\.78.*EUR/);
  assert.equal(h.calls.some((c) => c.url === "/api/capacity/members"), false);
  assert.equal(h.query('[name="member_id"] option[value="999"]'), null);
  assert.match(h.query("datalist").textContent + h.query("datalist").innerHTML, /Designer/);
  assert.equal(h.writes().length, 0);
  assert.equal(h.query("a").getAttribute("href"), "/manage/agency-ops-dashboard");
  assert.equal(h.load("lib/viewRoutes.ts").viewToPath("agency-rate-cards"), "/manage/agency-rate-cards");
});
for (const permissions of [[], [grants[0]], [grants[1]], [grants[0], grants[2]]]) {
  test("requires both read grants: " + permissions.join(","), async (t) => {
    const h = await harness(t, ({ url }, state) => { if (url.endsWith("/active")) state.permissions = permissions; });
    assert.match(h.text(), /Access denied/); assert.equal(h.lists().length, 0);
    assert.equal(h.query('form[aria-label="Save rate"]'), null); assert.equal(h.calls.some((c) => c.url.includes("capacity")), false);
  });
}
test("read-only access and explicit platform admin; revoked write permission blocks POST", async (t) => {
  const h = await harness(t); await h.fill(); h.state.permissions = grants.slice(0, 2); await h.submit();
  assert.equal(h.writes().length, 0); assert.match(h.text(), /Read-only access/);
  assert.equal(h.query('form[aria-label="Save rate"]'), null);
  h.state.admin = true; h.state.permissions = []; await h.event();
  assert.equal(h.query('[name="bill_rate"]').value, "1000000"); await h.submit(); assert.equal(h.writes().length, 1);
});
for (const envelope of [{ ok: true, activeTenantId: 7 }, { ok: true, activeTenantId: 7, user: { id: "999" } },
  { ok: true, activeTenantId: null, user: { id: 999 } }, { ok: false, error: "auth_required" }, { ok: true, data_unavailable: true }]) {
  test("fails closed on unverified membership: " + JSON.stringify(envelope), async (t) => {
    const h = await harness(t, ({ url }) => url.endsWith("/me") ? envelope : undefined);
    assert.equal(h.lists().length, 0); assert.ok(h.query('[role="alert"]'));
  });
}
test("rejects tenant disagreement, malformed grants and account changes across the permission check", async (t) => {
  let active = { ok: true, tenant: { id: 8 }, permissions: grants, isPlatformAdmin: true };
  const h = await harness(t, ({ url }, state) => { if (url.endsWith("/active")) { if (!active) state.user++; return active || undefined; } });
  assert.equal(h.lists().length, 0);
  active = { ok: true, tenant: { id: 7 }, permissions: "*", isPlatformAdmin: true };
  await h.click("Retry access"); assert.equal(h.lists().length, 0);
  active = null; await h.click("Retry access"); assert.equal(h.lists().length, 0); assert.match(h.text(), /Account or workspace changed/);
});
test("filters encode exact member or role; stale rows disappear before refresh", async (t) => {
  const h = await harness(t, (call) => call.url.startsWith(API) ? { ok: true, rates: [rate({ member_id: "cap_old" })] } : undefined);
  await h.set("filter_scope", "member"); await h.set("member_filter", "cap_old");
  assert.equal(h.query("tbody"), null); assert.equal(h.lists().length, 1);
  await h.submit("Rate filters"); assert.equal(h.lists().at(-1).url, API + "?member_id=cap_old");
  await h.set("filter_scope", "role"); await h.set("role_filter", " Design / R&D "); await h.submit("Rate filters");
  assert.deepEqual(Object.fromEntries(new URL(h.lists().at(-1).url, "http://localhost").searchParams), { role: "Design / R&D" });
  await h.set("role_filter", " "); await h.submit("Rate filters"); assert.equal(h.lists().length, 3); assert.ok(h.query('[role="alert"]'));
});
test("member save is explicit, locked against duplicates, adds history and refreshes persisted rates", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  assert.equal(h.query('[name="currency"]').value, ""); assert.equal(h.query('[name="cost_rate"]').value, "");
  await h.fill(); await h.set("effective_to", "2026-09-30"); await h.set("active", false); await h.submit("Save rate", true);
  assert.equal(h.writes().length, 1); assert.match(h.text(), /Saving…/); assert.doesNotMatch(h.text(), /Saved\./);
  const body = h.writes()[0].body;
  assert.deepEqual(body, { member_id: "cap_7", role: null, cost_rate: 0, bill_rate: 1000000, currency: "USD",
    effective_from: "2026-09-09", effective_to: "2026-09-30", active: false });
  assert.deepEqual(h.calls.slice(h.calls.indexOf(h.writes()[0]) - 3, h.calls.indexOf(h.writes()[0])).map((c) => c.url),
    ["/api/tenants/me", "/api/tenants/active", "/api/tenants/me"]);
  h.state.rates = [rate({ ...body, id: "rate_saved" }), rate()];
  await h.resolve(pending, { ok: true, rate: h.state.rates[0] });
  assert.equal(h.query("tbody").children.length, 2); assert.match(h.text(), /Saved\./);
  assert.equal(h.query('[name="cost_rate"]').value, ""); assert.equal(h.lists().length, 2);
});
test("scope switching clears opposite scope; arbitrary named roles work without roster availability", async (t) => {
  const h = await harness(t, ({ url }) => url.includes("capacity") ? { ok: false, error: "roster offline" } : undefined);
  assert.match(h.query("tbody").textContent, /cap_7 \(roster not verified\)/);
  await h.set("scope", "role"); await h.set("role", " Named specialist / A&B ");
  for (const [key, value] of Object.entries({ cost_rate: "12.30", bill_rate: "99.99", currency: "GBP" })) await h.set(key, value);
  await h.submit(); assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].body.member_id, null);
  assert.equal(h.writes()[0].body.role, "Named specialist / A&B"); assert.equal(h.writes()[0].body.effective_to, null);
  await h.set("scope", "role"); await h.set("role", "Designer"); await h.set("scope", "member"); await h.set("scope", "role");
  assert.equal(h.query('[name="role"]').value, "");
});
test("amount, currency, date and scope validation reject invalid inputs before POST", async (t) => {
  const h = await harness(t); await h.fill();
  for (const [key, invalid, valid] of [["member_id", "", "cap_7"], ["cost_rate", "", "0"], ["cost_rate", " ", "0"],
    ["cost_rate", "0.001", "0.01"], ["bill_rate", "-1", "1"], ["bill_rate", "1000000.01", "1000000"],
    ["bill_rate", "NaN", "1"], ["bill_rate", "Infinity", "1"], ["bill_rate", "1e3", "1"], ["currency", " ", "USD"],
    ["currency", "x".repeat(11), "USD"], ["effective_from", "", "2026-09-09"], ["effective_to", "2026-09-08", "2026-09-09"]]) {
    await h.set(key, invalid); await h.submit(); assert.equal(h.writes().length, 0, key + ":" + invalid); assert.ok(h.query('[role="alert"]')); await h.set(key, valid);
  }
  const lib = h.load("lib/agencyRateCards.ts"), draft = { ...lib.newDraft(), member_id: "cap_7", cost_rate: "0", bill_rate: "0", currency: "USD" };
  assert.ok(lib.draftError({ ...draft, role: "Designer" }, [member]));
  assert.ok(lib.draftError({ ...draft, effective_from: "2026-02-30" }, [member]));
  assert.ok(lib.draftError({ ...draft, scope: "role", member_id: "", role: "a".repeat(201) }, [member]));
});
test("writable default date follows local calendar on both sides of UTC midnight", () => {
  const lib = loader()("lib/agencyRateCards.ts"), previous = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles"; assert.equal(lib.localCalendarDate(new Date("2026-09-09T01:00:00Z")), "2026-09-08");
    process.env.TZ = "Pacific/Kiritimati"; assert.equal(lib.localCalendarDate(new Date("2026-09-09T23:00:00Z")), "2026-09-10");
    assert.equal(lib.newDraft().effective_from, lib.localCalendarDate());
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
for (const failure of [{ ok: false, error: "rate invalid", httpStatus: 400 }, { ok: false, error: "offline", httpStatus: 503 },
  { ok: true }, { ok: true, rate: rate() }, { ok: true, data_unavailable: true }, "network"]) {
  test("uncertain saves retain draft and never retry automatically: " + JSON.stringify(failure), async (t) => {
    const h = await harness(t, (c) => { if (c.method === "POST") { if (failure === "network") throw new Error("offline"); return failure; } });
    await h.fill(); await h.submit(); assert.equal(h.writes().length, 1); assert.equal(h.lists().length, 1);
    assert.equal(h.query('[name="bill_rate"]').value, "1000000"); assert.match(h.text(), /Save not confirmed.*Draft retained.*Check the list/);
  });
}
test("confirmed save with failed refresh clears draft, and explicit refresh only GETs", async (t) => {
  let saved = false;
  const h = await harness(t, (c) => { if (c.method === "POST") saved = true; else if (c.url.startsWith(API) && saved) return { ok: false, error: "refresh offline" }; });
  await h.fill(); await h.submit(); assert.match(h.text(), /Saved, but list refresh failed/);
  assert.equal(h.query('[name="bill_rate"]').value, ""); await h.submit("Rate filters");
  assert.equal(h.writes().length, 1); assert.equal(h.lists().length, 3);
});
test("empty, capped, mixed-currency, historical, malformed and withheld lists remain honest", async (t) => {
  let response = { ok: true, rates: [] };
  const h = await harness(t, (c) => c.url.startsWith(API) ? response : undefined);
  assert.match(h.text(), /No rate records match/);
  for (const rates of [[rate({ cost_rate: "12" })], [rate(), rate()], [rate({ _fabricated: true })]]) {
    response = { ok: true, rates }; await h.submit("Rate filters"); assert.equal(h.query("tbody"), null); assert.ok(h.query('[role="alert"]'));
  }
  response = { ok: true, data_unavailable: true, rates: [rate()] }; await h.submit("Rate filters"); assert.equal(h.query("tbody"), null);
  response = { ok: true, rates: Array.from({ length: 500 }, (_, i) => rate({ id: String(i), member_id: i ? "cap_old" : null, role: null, currency: i ? "EUR" : "USD", active: false })) };
  await h.submit("Rate filters"); assert.equal(h.query("tbody").children.length, 500);
  assert.match(h.text(), /500-record limit reached.*More records may exist/); assert.match(h.text(), /Default \(existing record\)/);
  assert.match(h.text(), /cap_old \(not in active roster\)/); assert.match(h.text(), /USD/); assert.match(h.text(), /EUR/);
  assert.equal(h.query("tfoot"), null);
});
for (const change of ["user", "tenant"]) {
  for (const action of ["save", "focus", "refresh"]) test(`${change} change on ${action} clears sensitive state and prevents stale actions`, async (t) => {
    const h = await harness(t); await h.fill(); h.state[change]++;
    if (action === "save") await h.submit(); else if (action === "focus") await h.event(); else await h.submit("Rate filters");
    assert.equal(h.writes().length, 0); assert.equal(h.lists().length, 1); assert.equal(h.query("tbody"), null);
    assert.equal(h.query('[name="bill_rate"]'), null); assert.doesNotMatch(h.text(), /Alex|cap_7/); assert.match(h.text(), /old draft and list were cleared/);
    await h.click("Retry access"); assert.equal(h.query('[name="bill_rate"]').value, "");
  });
}
for (const event of ["focus", "visibilitychange", "storage", "pageshow"]) test("revalidates read revocation on " + event, async (t) => {
  const h = await harness(t); await h.fill(); h.state.permissions = [grants[2]]; await h.event(event);
  assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="bill_rate"]'), null); assert.match(h.text(), /Read access was revoked/);
});
test("transient preflight failure retains draft and allows explicit access retry", async (t) => {
  let fail = false; const h = await harness(t, ({ url }) => fail && url.endsWith("/me") ? { ok: false, error: "verification offline" } : undefined);
  await h.fill(); fail = true; await h.submit(); assert.equal(h.writes().length, 0);
  assert.equal(h.query('[name="bill_rate"]').value, "1000000"); assert.match(h.text(), /Save not attempted.*Draft retained/);
  fail = false; await h.click("Retry access check"); await h.submit(); assert.equal(h.writes().length, 1);
});
for (const phase of ["focus", "POST", "GET", "roster"]) test("auth/permission loss clears sensitive state during " + phase, async (t) => {
  let fail = false;
  const h = await harness(t, (c) => fail && (phase === "focus" ? c.url.endsWith("/me") : phase === "roster" ? c.url.includes("capacity") : c.url.startsWith(API) && c.method === phase)
    ? { ok: false, error: "permission_denied", httpStatus: 403 } : undefined);
  await h.fill(); fail = true;
  if (phase === "focus") await h.event(); else if (phase === "POST") await h.submit(); else if (phase === "GET") await h.submit("Rate filters");
  else { h.state.user++; await h.event(); await h.click("Retry access"); }
  assert.equal(h.query("tbody"), null); assert.equal(h.query('[name="bill_rate"]'), null); assert.doesNotMatch(h.text(), /Alex|cap_7/);
});
test("stale list cannot overwrite changed filters, even before the next refresh", async (t) => {
  const pending = deferred(); let slow = true;
  const h = await harness(t, (c) => c.url.startsWith(API) && slow ? pending.promise : undefined);
  await h.set("filter_scope", "role"); await h.set("role_filter", "Designer"); slow = false;
  h.state.rates = [rate({ member_id: null, role: "Designer" })]; await h.submit("Rate filters");
  await h.resolve(pending, { ok: true, rates: [rate({ role: "Stale secret" })] });
  assert.match(h.query("tbody").textContent, /Role: Designer/); assert.doesNotMatch(h.text(), /Stale secret/);
});
test("account change while a protected read is pending is detected before rendering", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url.startsWith(API) ? pending.promise : undefined);
  h.state.user++; await h.resolve(pending, { ok: true, rates: [rate()] });
  assert.equal(h.query("tbody"), null); assert.match(h.text(), /Account or workspace changed/);
});
test("focus during pending POST still checks identity and discards stale save completion", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  await h.fill(); await h.submit(); h.state.user++; await h.event();
  await h.resolve(pending, { ok: true, rate: rate(h.writes()[0].body) });
  assert.equal(h.query("tbody"), null); assert.doesNotMatch(h.text(), /Saved\./); assert.equal(h.lists().length, 1);
});
for (const phase of ["preflight", "list", "POST"]) test("unmount guards pending " + phase, async (t) => {
  const pending = deferred(); let wait = phase === "list";
  const h = await harness(t, (c) => wait && (phase === "preflight" ? c.url.endsWith("/me") : c.url.startsWith(API) && c.method === (phase === "POST" ? "POST" : "GET")) ? pending.promise : undefined);
  if (phase !== "list") { await h.fill(); wait = true; await h.submit(); }
  await h.unmount(); await h.resolve(pending, { ok: true, user: { id: 999 }, activeTenantId: 7, rates: [rate()], rate: rate() });
  assert.equal(h.text(), ""); assert.equal(h.writes().length, phase === "POST" ? 1 : 0);
});
