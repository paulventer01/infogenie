"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

function loadHelpers() {
  const source = fs.readFileSync(path.join(ROOT, "lib/agencyOpsDashboard.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  });
  const module = { exports: {} };
  new Function("exports", "require", "module", outputText)(module.exports, require, module);
  return module.exports;
}

const helpers = loadHelpers();


function loadDashboard(apiGet) {
  const source = fs.readFileSync(
    path.join(ROOT, "components/features/manage/AgencyOpsDashboard.tsx"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  });
  const module = { exports: {} };
  const fakeRequire = (request) => {
    if (request === "@/lib/api") return { apiGet };
    if (request === "@/lib/agencyOpsDashboard") return helpers;
    return require(request);
  };
  new Function("exports", "require", "module", outputText)(module.exports, fakeRequire, module);
  return module.exports.default;
}

test("agency ops helpers build an encoded selected-period query", () => {
  assert.equal(
    helpers.buildAgencyOpsQuery("2026-09-01", "2026-09-08"),
    "?from=2026-09-01&to=2026-09-08",
  );
});

test("agency ops helpers preserve honest unavailable formatting", () => {
  assert.equal(helpers.formatHours(null), "Unavailable");
  assert.equal(helpers.formatPercent(undefined), "Unavailable");
  assert.equal(helpers.formatMoney(100, null), "Unavailable");
  assert.match(helpers.formatMoney(100, "USD"), /\$?100(?:\.00)?/);
});

test("pricing completeness is unavailable without a meaningful denominator", () => {
  assert.equal(helpers.pricingCompleteness(0, 0), null);
  assert.equal(helpers.pricingCompleteness(8, 2), 75);
  assert.equal(helpers.pricingCompleteness(8, 20), 0);
});

test("scope statuses are explicit and unknown statuses stay unavailable", () => {
  assert.equal(helpers.scopeStatusLabel("over_scope"), "Over scope");
  assert.equal(helpers.scopeStatusLabel("change_budget_used"), "Change budget used");
  assert.equal(helpers.scopeStatusLabel("unexpected"), "Unavailable");
});

test("dashboard remains read-only and uses all merged data sources", () => {
  const source = fs.readFileSync(path.join(ROOT, "components/features/manage/AgencyOpsDashboard.tsx"), "utf8");
  assert.match(source, /\/api\/agency-ops\/summary/);
  assert.doesNotMatch(source, /\/api\/agency-ops\/scope-signals/);
  assert.match(source, /\/api\/agency-ops\/capacity-summary/);
  assert.doesNotMatch(source, /api(Post|Put|Patch|Delete)\s*\(/);
});


test("strict-data envelopes remain visibly unavailable", () => {
  assert.equal(
    helpers.isDataUnavailable({
      ok: true,
      data_unavailable: true,
      source: "data_unavailable",
      message: "This data is currently unavailable.",
    }),
    true,
  );
  assert.equal(helpers.isDataUnavailable({ ok: true, totals: {} }), false);
  assert.equal(
    helpers.dataUnavailableMessage({ message: "Administrator action required." }),
    "Administrator action required.",
  );
});

test("dashboard uses billing-authorized summary signals and aggregate capacity", () => {
  const dashboard = fs.readFileSync(path.join(ROOT, "components/features/manage/AgencyOpsDashboard.tsx"), "utf8");
  assert.ok(dashboard.includes("/api/agency-ops/capacity-summary"));
  assert.ok(!dashboard.includes("/api/capacity/summary"));
  assert.ok(!dashboard.includes("/api/agency-ops/scope-signals"));
  assert.ok(dashboard.includes("summary?.scope_signals"));
});

test("capacity projection includes only measured dashboard fields", () => {
  const agencyOpsApi = require("../services/agency_ops/api");
  assert.deepEqual(
    agencyOpsApi._dashboardCapacityTotals({
      members: 2,
      weekly_hours: 80,
      allocated_hours: 64,
      logged_hours: 58,
      utilization_pct: 80,
      open_agent_tasks: 3,
      unassigned_task_hours: 99,
      recommendations: [{ task_id: "hidden" }],
    }),
    {
      members: 2,
      weekly_hours: 80,
      allocated_hours: 64,
      logged_hours: 58,
      utilization_pct: 80,
      open_agent_tasks: 3,
    },
  );
});

test("capacity summary uses an uncapped, tenant-scoped task count", async () => {
  const db = require("../db");
  const capacity = require("../services/capacity/api");
  const queries = [];
  const detailedRows = Array.from({ length: 100 }, (_, index) => ({
    id: "task-" + index,
    title: "Open task " + index,
    status: "open",
    priority: 2,
    due_date: null,
    action_type: "review",
    goal_title: "Goal",
  }));
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM team_capacity")) {
        return { rows: [{ id: "member-1", weekly_hours: 40, allocated_hours: 0 }] };
      }
      if (sql.includes("FROM capacity_assignments")) return { rows: [] };
      if (sql.includes("COUNT(*)::int AS open_agent_tasks")) {
        return { rows: [{ open_agent_tasks: 150 }] };
      }
      if (sql.includes("FROM agent_tasks")) return { rows: detailedRows };
      if (sql.includes("FROM agency_time_entries")) return { rows: [] };
      throw new Error("unexpected capacity query: " + sql);
    },
  };
  const originalHasDb = db.hasDb;
  const originalGetPool = db.getPool;
  db.hasDb = () => true;
  db.getPool = () => pool;
  try {
    const summary = await capacity.buildSummary(4242, { strict: true });
    assert.equal(summary.agent_workload.length, 100);
    assert.equal(summary.totals.open_agent_tasks, 150);

    const countQueries = queries.filter((query) => query.sql.includes("COUNT(*)::int AS open_agent_tasks"));
    assert.equal(countQueries.length, 1);
    assert.deepEqual(countQueries[0].params, [4242]);
    assert.match(countQueries[0].sql, /g\.tenant_id = \$1/);
    assert.match(countQueries[0].sql, /t\.tenant_id = \$1/);

    const workloadQueries = queries.filter((query) => (
      query.sql.includes("FROM agent_tasks") && query.sql.includes("LIMIT 100")
    ));
    assert.equal(workloadQueries.length, 1);
    assert.deepEqual(workloadQueries[0].params, [4242]);
    assert.match(workloadQueries[0].sql, /g\.tenant_id = \$1/);
    assert.match(workloadQueries[0].sql, /t\.tenant_id = \$1/);
  } finally {
    db.hasDb = originalHasDb;
    db.getPool = originalGetPool;
  }
});

test("dashboard applies only the latest reporting-period response", () => {
  const applied = [];
  assert.equal(
    helpers.applyLatestAgencyOpsResults(
      1,
      2,
      { period: "stale" },
      (result) => applied.push(result.period),
    ),
    false,
  );
  assert.deepEqual(applied, []);

  assert.equal(
    helpers.applyLatestAgencyOpsResults(
      2,
      2,
      { period: "fresh" },
      (result) => applied.push(result.period),
    ),
    true,
  );
  assert.deepEqual(applied, ["fresh"]);
});

test("legacy capacity summary keeps project-view access and remains side-effect free", () => {
  const capacity = fs.readFileSync(path.join(ROOT, "services/capacity/api.js"), "utf8");
  assert.ok(capacity.includes("router.get('/summary', requirePermission('manage.projects.view')"));
  assert.doesNotMatch(capacity, /ensureCapacityMember/);
});

test("agency operations dashboard aligns component and GET API permissions", () => {
  const matrixSource = fs.readFileSync(path.join(ROOT, "services/tenants/permission_matrix.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const agencyApi = fs.readFileSync(path.join(ROOT, "services/agency_ops/api.js"), "utf8");
  const matrix = require("../services/tenants/permission_matrix");
  assert.ok(matrixSource.includes("'agency-ops-dashboard':  'tenant.billing.manage'"));
  assert.equal(matrix.requiredPermissionForRequest("/api/agency-ops/summary", "GET").permission, "tenant.billing.manage");
  assert.equal(matrix.requiredPermissionForRequest("/api/agency-ops/scope-signals", "GET").permission, "manage.projects.view");
  assert.equal(matrix.requiredPermissionForRequest("/api/agency-ops/capacity-summary", "GET").permission, "tenant.billing.manage");
  assert.equal(matrix.requiredPermissionForRequest("/api/capacity/summary", "GET").permission, "manage.projects.view");
  assert.equal(matrix.requiredPermissionForRequest("/api/capacity/members", "GET").permission, "manage.projects.view");
  assert.ok(agencyApi.includes("router.get('/capacity-summary'"));
  assert.ok(agencyApi.includes("capacityApi.buildSummary(tenantId, { strict: true })"));
  assert.ok(agencyApi.includes("totals: _dashboardCapacityTotals(summary.totals)"));
  assert.ok(server.includes("^\\/api\\/capacity\\/summary\\/?$"));
});


test("dashboard renders rejected and strict-data responses visibly", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
  });
  const previous = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    Node: global.Node,
    Text: global.Text,
    Element: global.Element,
    HTMLElement: global.HTMLElement,
    Event: global.Event,
    MouseEvent: global.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Text: dom.window.Text,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const calls = [];
  const apiGet = async (url) => {
    calls.push(url);
    if (url.includes("/api/agency-ops/summary")) {
      return { ok: false, error: "summary backend unavailable" };
    }
    return {
      ok: true,
      data_unavailable: true,
      source: "data_unavailable",
      message: "Capacity feed unavailable.",
    };
  };

  let root;
  try {
    const Dashboard = loadDashboard(apiGet);
    const { createRoot } = require("react-dom/client");
    const { act } = require("react-dom/test-utils");
    await act(async () => {
      root = createRoot(dom.window.document.getElementById("root"));
      root.render(React.createElement(Dashboard));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    assert.equal(calls.length, 2);
    const rendered = dom.window.document.body.textContent;
    assert.match(rendered, /Data unavailable: summary backend unavailable/);
    assert.match(rendered, /Data unavailable: Capacity feed unavailable./);
  } finally {
    if (root) {
      const { act } = require("react-dom/test-utils");
      await act(async () => root.unmount());
    }
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});
