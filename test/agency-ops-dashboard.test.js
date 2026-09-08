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
