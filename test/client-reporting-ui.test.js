"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { act } = React;
const API = "/api/client-reporting/clients";
const grants = ["tenant.settings.manage"];
const client = (id = 11, name = "Acme") => ({ id, name, slug: null, website: null, status: "active" });
const profile = (extra = {}) => ({ client_id: 11, report_source: "search-intel", default_format: "pdf",
  report_title: "Monthly review", branding_mode: "workspace", branding_overrides: {},
  selected_metrics: ["runs", "successful_runs", "brand_mentions", "mapped_queries", "recent_search_runs"],
  reporting_period: "last_30_days", reporting_timezone: "UTC", version: 1,
  created_at: "2026-09-10T10:00:00.000Z", updated_at: "2026-09-10T10:00:00.000Z", ...extra });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function loader() {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } });
    const mod = { exports: {} };
    new Function("exports", "require", "module", outputText)(mod.exports, (id) => id.startsWith("@/lib/") ? load(id.slice(2) + ".ts")
      : id.startsWith("@/components/") ? load(id.slice(2) + ".tsx")
      : id === "next/link" ? { default: ({ children, ...props }) => React.createElement("a", props, children) } : require(id), mod);
    cache.set(file, mod.exports); return mod.exports;
  };
  return load;
}
// Exercise the actual panel and same-origin API wrapper, with deterministic transport fixtures.
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/client-reporting-profiles", pretendToBeVisual: true });
  const calls = [], state = { user: 999, tenant: 7, permissions: [...grants], admin: false,
    clients: [client(), client(22, "Beta")], profiles: new Map() };
  const me = () => ({ ok: true, user: { id: state.user }, activeTenantId: state.tenant, memberships: [{ tenantId: state.tenant }] });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined,
        credentials: options.credentials }; calls.push(call);
      let body = await handler(call, state, calls);
      if (body === undefined) {
        if (url === "/api/tenants/me") body = me();
        else if (url === "/api/tenants/active") body = { ok: true, tenant: { id: state.tenant, status: "active" }, permissions: state.permissions, isPlatformAdmin: state.admin };
        else if (url.startsWith(API + "?")) body = { ok: true, clients: state.clients, has_more: false, next_cursor: null };
        else if (/\/clients\/\d+$/.test(url)) body = { ok: true, client: state.clients.find((c) => c.id === Number(url.split("/").at(-1))) };
        else if (url.includes("/sources/")) body = { ok: true, source: url.split("/")[4], records: [], has_more: false, next_cursor: null };
        else if (/\/clients\/\d+\/profile$/.test(url)) {
          const id = Number(url.split("/").at(-2));
          if (call.method === "PUT") {
            const { expected_version, ...fields } = call.body;
            const saved = profile({ ...fields, client_id: id, version: expected_version + 1 });
            state.profiles.set(id, saved); body = { ok: true, configured: true, profile: saved };
          } else body = { ok: true, client: state.clients.find((c) => c.id === id), configured: state.profiles.has(id), profile: state.profiles.get(id) || null };
        } else throw new Error("Unexpected request: " + url);
      }
      return { ok: !body.httpStatus || body.httpStatus < 400, status: body.httpStatus || 200,
        headers: { get: () => "application/json" }, json: async () => body };
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
    const prototype = el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const submit = async (twice = false) => act(async () => {
    const form = query('form[aria-label="Reporting profile"]'); assert.ok(form, "Reporting profile form");
    for (let n = 0; n < (twice ? 2 : 1); n++) form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  const button = (label) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label);
  const click = async (label) => act(async () => { const el = button(label); assert.ok(el, label); el.click(); });
  const fill = async () => { for (const [name, value] of Object.entries({ report_source: "campaigns", default_format: "xlsx", report_title: " Acme monthly " })) await set(name, value); };
  const load = loader(); await act(async () => root.render(React.createElement(load("components/features/manage/ClientReportingProfiles.tsx").default)));
  return { state, calls, query, set, submit, button, click, fill, unmount, load, me,
    visible: (selector) => !!query(selector) && !query(selector).closest("[hidden]"),
    select: () => set("client_id", "11"), text: () => dom.window.document.body.textContent,
    event: async (name = "focus") => act(async () => (["visibilitychange", "ig:navperms-ready"].includes(name) ? dom.window.document : dom.window).dispatchEvent(new dom.window.Event(name))),
    resolve: async (pending, value) => act(async () => pending.resolve(value)),
    lists: () => calls.filter((c) => c.url.startsWith(API + "?")),
    reads: () => calls.filter((c) => c.url.startsWith(API) && c.method === "GET"), writes: () => calls.filter((c) => c.method !== "GET") };
}

for (const change of ["user", "tenant"]) test("mapping responses cannot expose previous context after " + change + " switch", async (t) => {
  const pending = deferred();
  const h = await harness(t, (c) => c.url.includes("/sources/") ? pending.promise : undefined);
  await h.select(); h.state[change]++;
  await h.resolve(pending, { ok: true, source: "search-intel", records: [{ id: 1, label: "Old mapping secret", client_id: null, mapping_id: null }], has_more: false, next_cursor: null });
  assert.doesNotMatch(h.text(), /Old mapping secret|Acme|Beta/); assert.equal(h.query("[data-record-id]"), null);
  assert.equal(h.writes().length, 0); assert.equal(h.visible('[name="client_id"]'), false);
});
test("mapping source selection leaves the unsaved reporting profile intact", async (t) => {
  const h = await harness(t); await h.select(); await h.set("report_title", "Unsaved title"); await h.set("mapping_source", "campaigns");
  assert.equal(h.query('[name="report_source"]').value, "search-intel"); assert.equal(h.query('[name="report_title"]').value, "Unsaved title");
  assert.equal(h.writes().length, 0);
});
test("checks identity and membership before listing real clients; never auto-selects or auto-saves", async (t) => {
  const pending = deferred();
  const h = await harness(t, (c) => c.url.endsWith("/active") ? pending.promise : undefined);
  assert.equal(h.reads().length, 0); assert.equal(h.visible('[name="client_id"]'), false);
  await h.resolve(pending, { ok: true, tenant: { id: 7, status: "active" }, permissions: grants, isPlatformAdmin: false });
  assert.equal(h.lists()[0].url, API + "?limit=50"); assert.equal(h.reads().length, 1);
  assert.match(h.query('[name="client_id"]').textContent, /Acme.*Beta/);
  assert.equal(h.query('[name="report_title"]'), null); assert.equal(h.writes().length, 0);
  assert.ok(h.calls.every((c) => c.credentials === "same-origin"));
  await h.select(); assert.equal(h.query('[name="report_title"]').value, "");
  assert.match(h.text(), /Not configured.*unsaved/); assert.equal(h.writes().length, 0);
});
test("saves an explicit full profile, blocks duplicate submit, and uses persisted versions on updates", async (t) => {
  const h = await harness(t); await h.select(); await h.fill(); await h.submit(true);
  assert.equal(h.writes().length, 1);
  assert.deepEqual(h.writes()[0].body.report_source, "campaigns");
  assert.deepEqual(h.writes()[0].body.default_format, "xlsx");
  assert.equal(h.writes()[0].body.report_title, "Acme monthly");
  assert.equal(h.writes()[0].body.reporting_period, "last_30_days");
  assert.ok(Array.isArray(h.writes()[0].body.selected_metrics) && h.writes()[0].body.selected_metrics.length > 0);
  assert.equal(h.writes()[0].body.expected_version, 0);
  assert.equal(h.writes()[0].url, API + "/11/profile"); assert.equal(h.writes()[0].method, "PUT");
  const saveIndex = h.calls.indexOf(h.writes()[0]);
  assert.deepEqual(h.calls.slice(saveIndex - 3, saveIndex).map((c) => c.url), ["/api/tenants/me", "/api/tenants/active", "/api/tenants/me"]);
  assert.match(h.text(), /Profile saved/); await h.set("default_format", "pptx"); await h.submit();
  assert.equal(h.writes()[1].body.expected_version, 1); assert.equal(h.state.profiles.get(11).version, 2);
  await h.click("Reload profile"); assert.equal(h.query('[name="default_format"]').value, "pptx"); assert.equal(h.writes().length, 2);
});
test("loads custom branding and persists only allowed overrides; workspace inheritance removes overrides", async (t) => {
  const h = await harness(t); h.state.profiles.set(11, profile({ version: 4, branding_mode: "custom", branding_overrides: { agencyName: "Agency", primaryColor: "#112233" } }));
  await h.select(); assert.equal(h.query('[name="agencyName"]').value, "Agency");
  for (const [name, value] of Object.entries({ agencyName: " Acme Agency ", footerText: " Confidential ", primaryColor: "#ABCDEF", accentColor: "#123456", textColor: "#000000" })) await h.set(name, value);
  await h.submit(); assert.equal(h.writes()[0].body.expected_version, 4);
  assert.deepEqual(h.writes()[0].body.branding_overrides, { agencyName: "Acme Agency", footerText: "Confidential", primaryColor: "#ABCDEF", accentColor: "#123456", textColor: "#000000" });
  await h.set("branding_mode", "workspace"); await h.submit();
  assert.deepEqual(h.writes()[1].body.branding_overrides, {}); assert.equal(h.query('[name="agencyName"]'), null);
});
test("invalid titles and branding stay local and cannot produce a write", async (t) => {
  const h = await harness(t); await h.select(); await h.set("report_title", "Title");
  for (const title of ["", " ", "x".repeat(161)]) { await h.set("report_title", title); await h.submit(); assert.equal(h.writes().length, 0); assert.ok(h.query('[role="alert"]')); }
  await h.fill(); await h.set("branding_mode", "custom");
  for (const [name, invalid] of [["agencyName", "x".repeat(81)], ["footerText", "x".repeat(201)], ["primaryColor", "red"], ["accentColor", "#123"], ["textColor", "https://example.test"]]) {
    await h.set(name, invalid); await h.submit(); assert.equal(h.writes().length, 0, name); assert.ok(h.query('[role="alert"]')); await h.set(name, "");
  }
});
test("loads additional clients using the server cursor and preserves the current selected client", async (t) => {
  const h = await harness(t, (c) => c.url.startsWith(API + "?") ? c.url.includes("cursor=")
    ? { ok: true, clients: [client(51, "Last client")], has_more: false, next_cursor: null }
    : { ok: true, clients: Array.from({ length: 50 }, (_, i) => client(i + 1, i === 10 ? "Acme" : "Client " + (i + 1))), has_more: true, next_cursor: 50 } : undefined);
  await h.select(); await h.click("Load more clients");
  assert.equal(h.lists()[1].url, API + "?limit=50&cursor=50"); assert.match(h.query('[name="client_id"]').textContent, /Acme.*Last client/);
  assert.equal(h.query('[name="client_id"]').value, "11"); assert.equal(h.button("Load more clients"), undefined);
});
test("empty clients show an honest empty state and retry recovers from list failure", async (t) => {
  let response = { ok: false, error: "database_unavailable", httpStatus: 503 };
  const h = await harness(t, (c) => c.url.startsWith(API + "?") ? response : undefined);
  assert.ok(h.query('[role="alert"]')); assert.equal(h.query('[name="report_title"]'), null);
  response = { ok: true, clients: [], has_more: false, next_cursor: null }; await h.click("Retry clients");
  assert.match(h.text(), /No active clients/); assert.equal(h.writes().length, 0);
});
for (const permissions of [[], ["reports.view", "reports.export"]]) test("report access alone cannot expose settings: " + permissions.join(","), async (t) => {
  const h = await harness(t, (c, state) => { if (c.url.endsWith("/active")) state.permissions = permissions; });
  assert.equal(h.reads().length, 0); assert.equal(h.visible('[name="client_id"]'), false); assert.ok(h.query('[role="alert"]'));
});
for (const envelope of [{ ok: true, activeTenantId: 7, user: { id: 999 }, memberships: [] },
  { ok: true, activeTenantId: 7, user: { id: "999" }, memberships: [{ tenantId: 7 }] },
  { ok: true, activeTenantId: 7, user: { id: 999 }, memberships: [{ tenantId: 8 }] }, { ok: false, error: "auth_required" }]) {
  test("fails closed on unverified membership: " + JSON.stringify(envelope), async (t) => {
    const h = await harness(t, (c) => c.url.endsWith("/me") ? envelope : undefined);
    assert.equal(h.reads().length, 0); assert.ok(h.query('[role="alert"]'));
  });
}
test("platform admin still requires a real matching membership and stable identity", async (t) => {
  const h = await harness(t, (c, state) => { if (c.url.endsWith("/active")) { state.admin = true; state.permissions = []; state.user++; } });
  assert.equal(h.reads().length, 0); assert.ok(h.query('[role="alert"]'));
});
test("explicit platform admin may manage profiles only with verified membership", async (t) => {
  const h = await harness(t, (c, state) => { if (c.url.endsWith("/active")) { state.admin = true; state.permissions = []; } });
  await h.select(); await h.fill(); await h.submit(); assert.equal(h.writes().length, 1);
});
for (const failure of [{ ok: false, error: "version_conflict", httpStatus: 409 }, { ok: false, error: "database_unavailable", httpStatus: 503 },
  { ok: true, configured: true, profile: profile({ version: 99 }) }, "network"]) {
  test("conflicting or uncertain saves preserve draft and require reload before another write: " + JSON.stringify(failure), async (t) => {
    const h = await harness(t, (c) => { if (c.method === "PUT") { if (failure === "network") throw new Error("offline"); return failure; } });
    await h.select(); await h.fill(); await h.submit();
    assert.equal(h.writes().length, 1); assert.equal(h.query('[name="report_title"]').value, " Acme monthly ");
    assert.ok(h.query('[role="alert"]')); assert.ok(h.button("Save profile").disabled);
    await h.submit(); assert.equal(h.writes().length, 1);
    h.state.profiles.set(11, profile({ report_title: "Latest persisted", version: 7 })); await h.click("Discard changes and reload");
    assert.equal(h.query('[name="report_title"]').value, "Latest persisted"); assert.equal(h.writes().length, 1);
  });
}
test("missing or archived client and malformed profile never expose a writable fabricated profile", async (t) => {
  let response = { ok: false, error: "client_not_found", httpStatus: 404 };
  const h = await harness(t, (c) => c.url.endsWith("/profile") ? response : undefined); await h.select();
  assert.equal(h.query('[name="report_title"]'), null); assert.ok(h.query('[role="alert"]'));
  response = { ok: true, client: client(), configured: true, profile: profile({ client_id: 22 }) };
  await h.click("Reload profile"); assert.equal(h.query('[name="report_title"]'), null); assert.equal(h.writes().length, 0);
});
test("failed access verification after a write withholds success and requires explicit reload", async (t) => {
  let fail = false;
  const h = await harness(t, (c) => {
    if (c.method === "PUT") fail = true;
    if (fail && c.url.endsWith("/me")) return { ok: false, error: "verification_unavailable", httpStatus: 503 };
  });
  await h.select(); await h.fill(); await h.submit(); assert.equal(h.writes().length, 1);
  assert.equal(h.visible('[name="report_title"]'), false); assert.doesNotMatch(h.text(), /Profile saved/);
  fail = false; await h.click("Retry access"); assert.equal(h.query('[name="report_title"]').value, " Acme monthly ");
  assert.ok(h.button("Save profile").disabled); await h.submit(); assert.equal(h.writes().length, 1);
  await h.click("Discard changes and reload"); assert.equal(h.query('[name="report_title"]').value, "Acme monthly");
});
for (const phase of ["profile", "save"]) test("server access denial clears protected data during " + phase, async (t) => {
  let denied = false;
  const h = await harness(t, (c) => denied && c.url.endsWith("/profile") && c.method === (phase === "save" ? "PUT" : "GET")
    ? { ok: false, error: "permission_denied", httpStatus: 403 } : undefined);
  if (phase === "profile") { denied = true; await h.select(); }
  else { await h.select(); await h.fill(); denied = true; await h.submit(); }
  assert.equal(h.query('[name="report_title"]'), null); assert.equal(h.visible('[name="client_id"]'), false); assert.doesNotMatch(h.text(), /Acme|Beta/);
});
test("client switching asks before discarding edits; cancel preserves the draft", async (t) => {
  const h = await harness(t); await h.select(); await h.fill(); await h.set("client_id", "22");
  await h.click("Keep editing"); assert.equal(h.query('[name="report_title"]').value, " Acme monthly ");
  await h.set("client_id", "22"); await h.click("Discard changes and switch");
  assert.equal(h.query('[name="client_id"]').value, "22"); assert.equal(h.query('[name="report_title"]').value, ""); assert.equal(h.writes().length, 0);
});
test("late profile results cannot overwrite a newly selected client", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url === API + "/11/profile" ? pending.promise : undefined);
  await h.select(); await h.set("client_id", "22");
  await h.resolve(pending, { ok: true, client: client(), configured: true, profile: profile({ report_title: "Stale Acme secret" }) });
  assert.equal(h.query('[name="client_id"]').value, "22"); assert.equal(h.query('[name="report_title"]').value, ""); assert.doesNotMatch(h.text(), /Stale Acme secret/);
});
for (const change of ["user", "tenant"]) test("identity change immediately before save clears protected state and blocks the write: " + change, async (t) => {
  const h = await harness(t); await h.select(); await h.fill(); h.state[change]++; await h.submit();
  assert.equal(h.writes().length, 0); assert.equal(h.query('[name="report_title"]'), null); assert.doesNotMatch(h.text(), /Acme|Beta/);
});
for (const event of ["focus", "visibilitychange", "storage", "pageshow", "ig:navperms-ready"]) test("permission revocation clears the client and draft on " + event, async (t) => {
  const h = await harness(t); await h.select(); await h.fill(); h.state.permissions = []; await h.event(event);
  assert.equal(h.query('[name="report_title"]'), null); assert.equal(h.visible('[name="client_id"]'), false); assert.equal(h.writes().length, 0);
});
test("protected content is withheld while event verification is pending, then restored only for the same account", async (t) => {
  const pending = deferred(); let wait = false;
  const h = await harness(t, (c) => wait && c.url.endsWith("/me") ? pending.promise : undefined);
  await h.select(); await h.fill(); wait = true; await h.event();
  assert.equal(h.visible('[name="report_title"]'), false); assert.equal(h.visible('[name="client_id"]'), false);
  await h.resolve(pending, h.me()); assert.equal(h.query('[name="report_title"]').value, " Acme monthly "); assert.equal(h.writes().length, 0);
});
test("account switch while a read is pending is detected before rendering its result", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url.endsWith("/profile") ? pending.promise : undefined);
  await h.select(); h.state.user++;
  await h.resolve(pending, { ok: true, client: client(), configured: true, profile: profile() });
  assert.equal(h.query('[name="report_title"]'), null); assert.doesNotMatch(h.text(), /Acme|Beta/);
});
for (const change of ["user", "tenant"]) test("overlapping initial access checks cannot adopt another context while the first client list is pending: " + change, async (t) => {
  const first = deferred(), second = deferred(), oldList = deferred(); let membershipReads = 0;
  const h = await harness(t, (c) => {
    if (c.url.endsWith("/me") && ++membershipReads <= 2) return membershipReads === 1 ? first.promise : second.promise;
    if (c.url.startsWith(API + "?")) return oldList.promise;
  });
  await h.event(); assert.equal(membershipReads, 2); assert.equal(h.reads().length, 0);
  await h.resolve(first, h.me()); assert.equal(h.lists().length, 1);
  assert.equal(h.visible('[name="client_id"]'), false);
  h.state[change]++; await h.resolve(second, h.me());
  await h.resolve(oldList, { ok: true, clients: [client(11, "Previous context secret")], has_more: false, next_cursor: null });
  assert.equal(h.visible('[name="client_id"]'), false); assert.doesNotMatch(h.text(), /Previous context secret/);
  assert.match(h.text(), /Account or workspace changed/); assert.equal(h.writes().length, 0);
});
test("account switch during a pending save discards the late completion without claiming success", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.method === "PUT" ? pending.promise : undefined);
  await h.select(); await h.fill(); await h.submit(); h.state.user++; await h.event();
  const { expected_version, ...fields } = h.writes()[0].body;
  await h.resolve(pending, { ok: true, configured: true, profile: profile(fields) });
  assert.equal(h.query('[name="report_title"]'), null); assert.doesNotMatch(h.text(), /Saved|Acme|Beta/); assert.equal(h.writes().length, 1);
});
for (const phase of ["preflight", "profile", "save"]) test("unmount prevents late state updates and requests during " + phase, async (t) => {
  const pending = deferred(); let wait = false;
  const h = await harness(t, (c) => wait && (phase === "preflight" ? c.url.endsWith("/me") : c.url.endsWith("/profile") && c.method === (phase === "save" ? "PUT" : "GET")) ? pending.promise : undefined);
  if (phase === "profile") { wait = true; await h.select(); } else { await h.select(); await h.fill(); wait = true; await h.submit(); }
  await h.unmount(); const readCount = h.reads().length;
  await h.resolve(pending, phase === "preflight" ? h.me() : { ok: true, client: client(), configured: true, profile: profile() });
  assert.equal(h.text(), ""); assert.equal(h.reads().length, readCount); assert.equal(h.writes().length, phase === "save" ? 1 : 0);
});
test("report generation is unavailable for unsaved or dirty profiles and restored only after save", async (t) => {
  const h = await harness(t); await h.select(); assert.equal(h.button("Preview report"), undefined);
  await h.fill(); await h.submit(); assert.ok(h.button("Preview report"));
  await h.set("report_title", "Changed title"); assert.equal(h.button("Preview report"), undefined);
  await h.click("Discard changes and reload"); assert.ok(h.button("Preview report"));
  assert.equal(h.calls.filter((c) => /\/report(-preview)?$/.test(c.url)).length, 0);
});
for (const change of ["user", "tenant"]) test("pending report preview cannot survive " + change + " switch", async (t) => {
  const pending = deferred(); const h = await harness(t, (c) => c.url.endsWith("/report-preview") ? pending.promise : undefined);
  h.state.profiles.set(11, profile()); await h.select(); await h.click("Preview report"); h.state[change]++;
  await h.resolve(pending, { ok: true, client: client(), profile_version: 1, format: "pdf", can_generate: true, brand: {},
    report: { title: "Private report", generated_at: "2026-01-01", sections: [{ kind: "table", title: "Private", headers: ["Name"], rows: [["Private data"]] }] } });
  assert.doesNotMatch(h.text(), /Private report|Private data/); assert.equal(h.button("Preview report"), undefined);
});
