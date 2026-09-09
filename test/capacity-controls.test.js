"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const React = require("react"), { act } = React, { JSDOM } = require("jsdom");
const grants = ["manage.projects.view", "manage.projects.edit"], API = "/api/capacity/";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const member = (extra = {}) => ({ id: "cap_a", member_name: "Ada", role: "Planner", weekly_hours: "0.00", allocated_hours: "7.25",
  active: true, skills: [" strategy "], notes: " original notes ", ...extra });
const task = { id: 17, title: "Campaign task", priority: "high", estimated_hours: 4, due_date: "2028-02-29T00:00:00.000Z" };
const summary = () => ({ ok: true, members: [{ ...member(), weekly_hours: 0, allocated_hours: 10.25, utilization_pct: 0,
  load: "overloaded", open_assignments: 1, assignments: [{ id: "asg_1", work_item: "Existing work", hours: "3.00", status: "open", due_date: null }] }],
  agent_workload: [task], recommendations: [{ task_id: 17, task_title: task.title, suggested_member_id: "cap_a", suggested_member_name: "Ada", estimated_hours: 4 }], alerts: [],
  totals: { members: 1, weekly_hours: 0, allocated_hours: 10.25, remaining_hours: 0, utilization_pct: 0, overloaded: 1, open_agent_tasks: 137, unassigned_task_hours: 4 } });
function loader() {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), { reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } });
    assert.equal(diagnostics.length, 0);
    const mod = { exports: {} };
    new Function("exports", "require", "module", outputText)(mod.exports, (id) => id.startsWith("@/lib/") ? load(id.slice(2) + ".ts") : require(id), mod);
    cache.set(file, mod.exports); return mod.exports;
  }; return load;
}
async function harness(t, handler = () => undefined) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/capacity", pretendToBeVisual: true });
  const calls = [], state = { user: 9, tenant: 7, permissions: [...grants], admin: false,
    roster: [member(), member({ id: "cap_b", member_name: "Ben", weekly_hours: "40.00" }), member({ id: "cap_c", member_name: "Cy", active: false })], summary: summary() };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, fetch: async (url, options = {}) => {
      const call = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
      let body = await handler(call, state, calls);
      if (body === undefined) {
        if (url === "/api/tenants/me") body = { ok: true, user: { id: state.user }, activeTenantId: state.tenant };
        else if (url === "/api/tenants/active") body = { ok: true, tenant: { id: state.tenant }, permissions: state.permissions, isPlatformAdmin: state.admin };
        else if (call.method === "GET" && url === API + "members") body = { ok: true, members: state.roster };
        else if (call.method === "GET" && url === API + "summary") body = state.summary;
        else if (call.method !== "GET" && url.startsWith(API)) body = url.endsWith("seed-from-users") ? { ok: true, seeded: 1, added: ["New teammate"] } : { ok: true, id: "saved_1" };
        else throw new Error("Unexpected request " + url);
      }
      return { ok: !body.httpStatus || body.httpStatus < 400, status: body.httpStatus || 200, headers: { get: () => "application/json" }, json: async () => body };
    } };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(global, key, { configurable: true, writable: true, value }));
  let root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const unmount = async () => { if (root) { await act(async () => root.unmount()); root = null; } };
  t.after(async () => { await unmount(); dom.window.close(); previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; }); });
  const query = (s) => dom.window.document.querySelector(s);
  const set = async (name, value) => act(async () => {
    const el = query(`[name="${name}"]`); assert.ok(el, name);
    Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const click = async (label, twice = false, scope = "body") => act(async () => {
    const el = [...query(scope).querySelectorAll("button")].find((b) => b.textContent === label); assert.ok(el, label);
    el.click(); if (twice) el.click();
  });
  const submit = async (label) => act(async () => query(`form[aria-label="${label}"]`).dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  const load = loader(); await act(async () => root.render(React.createElement(load("components/features/aiteam/Capacity.tsx").default)));
  return { state, calls, query, set, click, submit, unmount, load, text: () => dom.window.document.body.textContent,
    writes: () => calls.filter((c) => c.method !== "GET"), resolve: async (p, v) => act(async () => p.resolve(v)),
    event: async (name = "focus") => act(async () => (name === "visibilitychange" ? dom.window.document : dom.window).dispatchEvent(new dom.window.Event(name))) };
}

test("reads full roster and honest workload with project grants alone; zero capacity and queue subset stay explicit", async (t) => {
  const h = await harness(t);
  assert.match(h.text(), /Cy.*Inactive/); assert.match(h.text(), /N\/A \(0 capacity\)/);
  assert.match(h.text(), /Showing 1 listed tasks of 137 total open tasks/); assert.match(h.text(), /Priority-based hours are estimates/);
  assert.equal(h.query("tbody tr td").textContent, task.title); assert.equal(h.writes().length, 0);
  assert.deepEqual(h.calls.slice(0, 3).map((c) => c.url), ["/api/tenants/me", "/api/tenants/active", "/api/tenants/me"]);
  assert.equal(h.calls.filter((c) => c.url === "/api/tenants/me").length, 4);
  assert.equal(h.load("lib/viewRoutes.ts").viewToPath("capacity"), "/manage/capacity");
});
test("edits raw base allocation, retains zero, inactive flag and hidden metadata; never saves the summary sum", async (t) => {
  const h = await harness(t); await h.click("Edit Ada");
  assert.equal(h.query('[name="allocated_hours"]').value, "7.25"); assert.equal(h.query('[name="weekly_hours"]').value, "0.00");
  await h.set("member_name", "Ada updated"); await h.submit("Roster details"); assert.equal(h.writes().length, 0);
  await h.click("Save change");
  assert.deepEqual(h.writes()[0].body, { id: "cap_a", member_name: "Ada updated", role: "Planner", weekly_hours: 0, allocated_hours: 7.25,
    active: true, skills: [" strategy "], notes: " original notes " });
  await h.click("Edit Cy"); await h.submit("Roster details"); await h.click("Save change"); assert.equal(h.writes()[1].body.active, false);
});
test("member inputs block blanks, excess precision/ranges and allow explicit boundary hours", async (t) => {
  const h = await harness(t); await h.set("member_name", "New");
  for (const [key, value, valid] of [["weekly_hours", "", "0"], ["weekly_hours", "168.01", "168"], ["weekly_hours", "1e2", "0"],
    ["allocated_hours", "0.001", "0"], ["allocated_hours", "10000", "9999.99"], ["role", " ", "Planner"]]) {
    await h.set(key, value); await h.submit("Roster details"); assert.equal(h.query('[aria-label="Review capacity change"]'), null); await h.set(key, valid);
  }
  await h.submit("Roster details"); await h.click("Save change"); assert.equal(h.writes().length, 1);
  assert.equal(h.writes()[0].body.allocated_hours, 9999.99); assert.equal(h.writes()[0].body.weekly_hours, 0);
});
test("recommendation and queue prefill exact task/person estimates, then save the reviewed person without assign-best", async (t) => {
  const h = await harness(t); await h.click("Review assignment");
  assert.equal(h.writes().length, 0); assert.equal(h.query('[name="member_id"]').value, "cap_a"); assert.equal(h.query('[name="hours"]').value, "4");
  assert.equal(h.query('[name="due_date"]').value, "2028-02-29"); assert.match(h.text(), /prefilled hours are priority-based estimates/);
  await h.set("member_id", "cap_b"); await h.set("hours", "6.25"); await h.submit("Assignment details");
  assert.match(h.query('[aria-label="Review capacity change"]').textContent, /Ben.*cap_b.*6.25h/); assert.equal(h.writes().length, 0);
  await h.click("Save change"); assert.deepEqual(h.writes()[0], { url: API + "assignments", method: "POST", body: {
    member_id: "cap_b", work_item: task.title, hours: 6.25, due_date: "2028-02-29", source: "agent_tasks", source_ref: "agent_task:17", status: "open" } });
  await h.click("Review assignment", false, "tbody"); assert.equal(h.query('[name="member_id"]').value, "cap_a");
  assert.ok(h.calls.every((c) => c.url.startsWith(API) || c.url.startsWith("/api/tenants/")));
});
test("manual assignment requires active person, work, positive decimal hours and real calendar dates", async (t) => {
  const h = await harness(t);
  assert.equal(h.query('select option[value="cap_c"]'), null);
  await h.set("member_id", "cap_b"); await h.set("work_item", "Manual work"); await h.set("hours", "0");
  for (const value of ["0", "", "-1", "1e2", "0.001", "10000"]) {
    await h.set("hours", value); await h.submit("Assignment details"); assert.equal(h.query('[aria-label="Review capacity change"]'), null);
  }
  await h.set("hours", "9999.99");
  for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2028-02-29T00:00:00Z"]) {
    await h.set("due_date", value); await h.submit("Assignment details"); assert.equal(h.query('[aria-label="Review capacity change"]'), null);
  }
  await h.set("due_date", ""); await h.submit("Assignment details"); await h.click("Save change");
  assert.equal(h.writes()[0].body.source, "manual"); assert.equal(h.writes()[0].body.source_ref, null); assert.equal(h.writes()[0].body.due_date, null);
});
test("deactivation, reactivation, done and cancelled require confirmation and exact mutation targets", async (t) => {
  const h = await harness(t);
  for (const label of ["Deactivate Ada", "Reactivate Cy", "Mark done", "Mark cancelled"]) {
    const before = h.writes().length; await h.click(label); assert.equal(h.writes().length, before);
    await h.click("Save change"); assert.equal(h.writes().length, before + 1);
  }
  assert.equal(h.writes()[0].method, "DELETE"); assert.equal(h.writes()[0].url, API + "members/cap_a");
  assert.equal(h.writes()[1].body.active, true); assert.equal(h.writes()[1].body.id, "cap_c");
  assert.deepEqual(h.writes().slice(2).map((c) => [c.method, c.url, c.body]), [["PATCH", API + "assignments/asg_1", { status: "done" }], ["PATCH", API + "assignments/asg_1", { status: "cancelled" }]]);
  assert.match(h.text(), /not the underlying agent task/);
});
test("API 409 and 404 failures are reported and never become success", async (t) => {
  const h = await harness(t, (c) => c.method === "DELETE" ? { ok: false, httpStatus: 409, error: "Open work still assigned" }
    : c.method === "PATCH" ? { ok: false, httpStatus: 404, error: "assignment_not_found" } : undefined);
  await h.click("Deactivate Ada"); await h.click("Save change"); assert.match(h.text(), /Open work still assigned/); assert.doesNotMatch(h.text(), /Saved\./);
  await h.click("Mark done"); await h.click("Save change"); assert.match(h.text(), /assignment_not_found/);
});
test("seed is explicit review with cap/default/no invites; failure is partial or uncertain without retry", async (t) => {
  let fail = true; const h = await harness(t, (c) => fail && c.method === "POST" ? { ok: false, error: "seed unavailable" } : undefined);
  assert.equal(h.writes().length, 0); await h.click("Seed from workspace users");
  assert.match(h.query('[aria-label="Review capacity change"]').textContent, /up to 40 workspace users.*default 40 weekly hours.*sends no invitations/);
  assert.equal(h.writes().length, 0); await h.click("Save change"); assert.match(h.text(), /Seeding may be partial or uncertain/); assert.equal(h.writes().length, 1);
  fail = false; await h.click("Seed from workspace users"); await h.click("Save change"); assert.match(h.text(), /Added 1 teammate\(s\): New teammate/);
});
test("shared synchronous lock blocks duplicate and cross-action submissions while a write is pending", async (t) => {
  const pending = deferred(), h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  await h.set("member_name", "Draft"); await h.submit("Roster details"); await h.click("Save change", true);
  assert.equal(h.writes().length, 1); await h.click("Mark done"); await h.click("Seed from workspace users"); assert.equal(h.writes().length, 1);
  await h.resolve(pending, { ok: false, error: "Connection lost" }); assert.match(h.text(), /Verify the roster and assignments before retrying/);
  assert.equal(h.query('[name="member_name"]').value, "Draft"); assert.equal(h.writes().length, 1);
});
test("confirmed save followed by failed refresh is reported separately", async (t) => {
  let wrote = false; const h = await harness(t, (c) => {
    if (c.method === "POST") wrote = true;
    if (wrote && c.url === API + "summary") return { ok: false, error: "refresh outage" };
  });
  await h.set("member_name", "Draft"); await h.submit("Roster details"); await h.click("Save change");
  assert.match(h.text(), /Saved, but refresh failed/); assert.match(h.text(), /do not resubmit/); assert.equal(h.writes().length, 1);
});
test("confirmed write followed by verification outage hides data and retains draft without suggesting resubmission", async (t) => {
  let outage = false; const h = await harness(t, (c) => {
    if (c.method === "POST") outage = true;
    if (outage && c.url === "/api/tenants/me") return { ok: false, error: "temporary outage" };
  });
  await h.set("member_name", "Draft"); await h.submit("Roster details"); await h.click("Save change"); assert.equal(h.query("input"), null);
  outage = false; await h.click("Refresh capacity"); assert.match(h.text(), /Saved, but access verification and refresh failed/);
  assert.match(h.text(), /do not resubmit/); assert.equal(h.query('[name="member_name"]').value, "Draft"); assert.equal(h.writes().length, 1);
});
test("failed and malformed reads stay unavailable, never render invented empty/zero data", async (t) => {
  let fail = true; const h = await harness(t, (c) => fail && c.url === API + "summary" ? { ok: false, error: "database unavailable" } : undefined);
  assert.match(h.text(), /Workload unavailable/); assert.doesNotMatch(h.text(), /No open agent tasks\./); assert.doesNotMatch(h.text(), /N\/A \(0 capacity\)/);
  fail = false; h.state.summary.totals.allocated_hours = null; await h.click("Refresh capacity"); assert.match(h.text(), /Invalid summary response/);
  h.state.summary = summary(); h.state.roster[0].allocated_hours = ""; await h.click("Refresh capacity"); assert.match(h.text(), /Roster unavailable/);
});
test("read-only grants render data but prohibit writes; missing read grant clears everything", async (t) => {
  const h = await harness(t); await h.set("member_name", "Private draft"); h.state.permissions = ["manage.projects.view"]; await h.event();
  assert.match(h.text(), /Read-only access/); await h.click("Seed from workspace users"); assert.equal(h.writes().length, 0);
  h.state.permissions = ["manage.projects.edit"]; await h.event("visibilitychange"); assert.doesNotMatch(h.text(), /Private draft|Existing work|Campaign task/);
  h.state.permissions = [...grants]; await h.click("Refresh capacity"); assert.equal(h.query('[name="member_name"]').value, "");
});
test("temporary verification outage hides rows and drafts, then restores the unsaved draft", async (t) => {
  let outage = false; const h = await harness(t, (c) => outage && c.url === "/api/tenants/active" ? { ok: false, error: "temporary outage" } : undefined);
  await h.set("member_name", "Private draft"); outage = true; await h.event("visibilitychange");
  assert.equal(h.query("input"), null); assert.doesNotMatch(h.text(), /Existing work|Campaign task/);
  outage = false; await h.click("Refresh capacity"); assert.equal(h.query('[name="member_name"]').value, "Private draft");
});
for (const key of ["user", "tenant"]) test(`${key} switch during a pending read discards its response and drafts`, async (t) => {
  let hold = false; const pending = deferred(), h = await harness(t, (c) => hold && c.url === API + "summary" ? pending.promise : undefined);
  await h.set("member_name", "Private draft"); hold = true; await h.click("Refresh capacity"); h.state[key] += 1;
  await h.event(); await h.resolve(pending, summary()); assert.equal(h.query("input"), null); assert.doesNotMatch(h.text(), /Existing work|Campaign task/);
  hold = false; await h.click("Refresh capacity"); assert.equal(h.query('[name="member_name"]').value, "");
});
test("same-tenant user switch between me and active is detected before sensitive reads", async (t) => {
  const h = await harness(t, (c, state) => { if (c.url === "/api/tenants/active") state.user += 1; });
  assert.equal(h.calls.filter((c) => c.url.startsWith(API)).length, 0); assert.match(h.text(), /Account or workspace changed/);
});
test("post-read identity check withholds a switched response even without a focus event", async (t) => {
  const pending = deferred(), h = await harness(t, (c) => c.url === API + "summary" ? pending.promise : undefined);
  h.state.user += 1; await h.resolve(pending, summary()); assert.match(h.text(), /Account or workspace changed/); assert.equal(h.query("tbody"), null);
});
test("context switch during a write suppresses success and clears drafts", async (t) => {
  const pending = deferred(), h = await harness(t, (c) => c.method === "POST" ? pending.promise : undefined);
  await h.set("member_name", "Private draft"); await h.submit("Roster details"); await h.click("Save change");
  h.state.user += 1; await h.event(); await h.resolve(pending, { ok: true, id: "saved" });
  assert.doesNotMatch(h.text(), /Saved\.|Private draft|Existing work/); assert.equal(h.query("input"), null);
});
test("confirmation revalidates editing rights, member activity and open task state before mutation", async (t) => {
  const h = await harness(t); await h.click("Review assignment"); await h.submit("Assignment details");
  h.state.roster[0].active = false; await h.click("Save change"); assert.match(h.text(), /Choose an active person/); assert.equal(h.writes().length, 0);
  h.state.roster[0].active = true; await h.click("Review assignment"); await h.submit("Assignment details"); h.state.summary.agent_workload = [];
  await h.click("Save change"); assert.match(h.text(), /Task is no longer/); assert.equal(h.writes().length, 0);
  await h.set("member_name", "Draft"); await h.submit("Roster details"); h.state.permissions = ["manage.projects.view"];
  await h.click("Save change"); assert.match(h.text(), /Project editing access is required/); assert.equal(h.writes().length, 0);
});
test("unmount during pending read has no mutation or stale state work", async (t) => {
  const pending = deferred(), h = await harness(t, (c) => c.url === API + "summary" ? pending.promise : undefined);
  assert.match(h.text(), /Loading roster and workload/); await h.unmount(); await h.resolve(pending, summary()); assert.equal(h.writes().length, 0);
});
