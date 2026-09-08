"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

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
  assert.match(source, /\/api\/agency-ops\/scope-signals/);
  assert.match(source, /\/api\/capacity\/summary/);
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

test("dashboard guards read-only capacity and stale reporting-period responses", () => {
  const source = fs.readFileSync(path.join(ROOT, "components/features/manage/AgencyOpsDashboard.tsx"), "utf8");
  assert.match(source, /\/api\/capacity\/summary\?read_only=true/);
  assert.match(source, /requestIdRef/);
  assert.match(source, /requestId !== requestIdRef\.current/);
});

test("capacity summary is tenant-authorized and side-effect free in read-only mode", () => {
  const source = fs.readFileSync(path.join(ROOT, "services/capacity/api.js"), "utf8");
  assert.match(source, /router\.get\('\/summary', requirePermission\('manage\.projects\.view'\)/);
  assert.match(source, /req\.query\?\.read_only === 'true'/);
});

test("agency operations dashboard has a billing permission and narrow capacity owner exemption", () => {
  const matrix = fs.readFileSync(path.join(ROOT, "services/tenants/permission_matrix.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(matrix, /'agency-ops-dashboard'\s*:\s*'tenant\.billing\.manage'/);
  assert.match(server, /\/\^\\\/api\\\/capacity\\\/summary\$\//);
});
