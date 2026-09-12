"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { act } = React;

function load(file) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const mod = { exports: {} };
  const cache = load.cache || (load.cache = new Map());
  if (cache.has(file)) return cache.get(file);
  new Function("exports", "require", "module", outputText)(mod.exports, (id) => {
    if (id.startsWith("@/")) {
      const rel = id.slice(2);
      const ext = rel.startsWith("components/") || rel.includes("/shared/") ? ".tsx" : ".ts";
      return load(rel + ext);
    }
    return require(id);
  }, mod);
  cache.set(file, mod.exports);
  return mod.exports;
}

async function goalsHarness(t, goals, suggestHandler) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/grow/goals", pretendToBeVisual: true });
  const calls = [];
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || "GET";
      calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
      let body;
      if (url.endsWith("/api/goals/check")) {
        body = { ok: true, goals, rootCause: {} };
      } else if (url.endsWith("/api/goals/suggest") && suggestHandler) {
        body = await suggestHandler(JSON.parse(options.body || "{}"));
      } else {
        throw new Error("Unexpected " + method + " " + url);
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => body,
      };
    },
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(global, key, { configurable: true, writable: true, value }));
  const Component = load("components/features/grow/Goals.tsx").default;
  const root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const render = async () => act(async () => root.render(React.createElement(Component)));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; });
  });
  await render();
  await act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.body.textContent.includes("Evaluating"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    for (let i = 0; i < 40 && dom.window.document.body.textContent.includes("Evaluating"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  const click = async (label) => act(async () => {
    const btn = [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
    assert.ok(btn, label);
    btn.click();
  });
  return { document: dom.window.document, text: () => dom.window.document.body.textContent, click, calls, render };
}

async function okrHarness(t, objectives, refreshHandler) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manage/marketing-okr", pretendToBeVisual: true });
  const state = { objectives };
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || "GET";
      if (url.endsWith("/api/okr/quarters")) {
        return json({ ok: true, quarters: ["2026-Q1"], current: "2026-Q1" });
      }
      if (url.endsWith("/api/okr/objectives?quarter=2026-Q1") && method === "GET") {
        return json({ ok: true, objectives: state.objectives });
      }
      if (url.includes("/api/okr/objectives/") && url.endsWith("/refresh") && method === "POST" && refreshHandler) {
        const body = await refreshHandler();
        state.objectives = state.objectives.map((obj) => ({
          ...obj,
          status: body.status || obj.status,
          key_results: obj.key_results.map((kr) => {
            const next = body.key_results.find((x) => x.id === kr.id);
            return next ? { ...kr, ...next } : kr;
          }),
        }));
        return json(body);
      }
      throw new Error("Unexpected " + method + " " + url);
    },
  };
  function json(body) {
    return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body };
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(global, key, { configurable: true, writable: true, value }));
  const Component = load("components/features/manage/MarketingOKR.tsx").default;
  const root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  const render = async () => act(async () => root.render(React.createElement(Component)));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; });
  });
  await render();
  await act(async () => {
    for (let i = 0; i < 60 && dom.window.document.body.textContent.includes("Loading"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  const click = async (label) => act(async () => {
    const btn = [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
    if (btn) {
      btn.click();
      return;
    }
    const row = [...dom.window.document.querySelectorAll("div")].find((el) =>
      el.textContent?.includes(label) && el.style?.cursor === "pointer");
    assert.ok(row, label);
    row.click();
  });
  return { document: dom.window.document, text: () => dom.window.document.body.textContent, click, state, render };
}

const baseGoal = {
  id: "g1",
  label: "Spend cap",
  metric: "ads.totalSpend",
  target: 1000,
  status: "on-track",
  pct: 80,
  current: 800,
  meta: { unit: "$", direction: "lte" },
};

test("Goals UI shows available zero as 0", async (t) => {
  const h = await goalsHarness(t, [{
    ...baseGoal,
    current: 0,
    pct: 0,
    status: "on-track",
    metric_availability: "available",
    metric_is_proxy: false,
  }]);
  assert.match(h.text(), /\$0/);
  assert.match(h.text(), /0%/);
});

test("Goals UI shows unavailable canonical metrics without zero progress", async (t) => {
  const h = await goalsHarness(t, [{
    ...baseGoal,
    current: null,
    pct: null,
    status: "unknown",
    metric_availability: "unavailable",
    metric_availability_reason: "source_query_failed",
  }]);
  assert.match(h.text(), /Unavailable \(source query failed\)/i);
  assert.match(h.text(), /\$1,000/);
  assert.match(h.text(), /Unverified/);
  assert.doesNotMatch(h.text(), /0%/);
});

test("Goals UI treats canonical metric without metadata as unverified", async (t) => {
  const h = await goalsHarness(t, [{
    ...baseGoal,
    metric: "ads.blendedRoas",
    target: 2,
    meta: { unit: "x", direction: "gte" },
    current: 1.5,
    pct: 75,
    status: "on-track",
  }]);
  assert.match(h.text(), /Unverified/);
  assert.match(h.text(), /Target2x|2x/);
  assert.doesNotMatch(h.text(), /75%/);
});

test("Goals UI preserves non-canonical metrics without availability metadata", async (t) => {
  const h = await goalsHarness(t, [{
    ...baseGoal,
    metric: "drip.bounceRate",
    meta: { unit: "%", direction: "lte" },
    current: 4.2,
    pct: 84,
    status: "on-track",
  }]);
  assert.match(h.text(), /On Track/);
  assert.match(h.text(), /84%/);
});

test("Goals UI keeps saved target visible when current measurement is unavailable", async (t) => {
  const h = await goalsHarness(t, [{
    ...baseGoal,
    target: 2500,
    current: null,
    pct: null,
    status: "unknown",
    metric_availability: "unavailable",
    metric_availability_reason: "source_query failed",
  }]);
  assert.match(h.text(), /Target\$2,500/);
  assert.match(h.text(), /target ≤ \$2,500/);
});

test("Goals UI qualifies partial progress", async (t) => {
  const h = await goalsHarness(t, [{
    ...baseGoal,
    current: 400,
    pct: 40,
    status: "off-track",
    metric_availability: "partial",
    metric_availability_reason: "input_unavailable:offline",
    metric_is_proxy: true,
  }]);
  assert.match(h.text(), /Partial/);
  assert.match(h.text(), /Proxy/);
  assert.match(h.text(), /40% \(Partial\)/);
});

test("Goals suggest insufficient_data leaves target unchanged", async (t) => {
  const h = await goalsHarness(t, [], async () => ({
    ok: true,
    insufficient_data: true,
    value: null,
    current: null,
    metric_availability: "partial",
    reason: "Insufficient data for a data-based target suggestion — canonical metric is partial (input unavailable offline). Enter a target manually.",
  }));
  await h.click("Add Goal");
  const target = h.document.querySelector('input[type="number"]');
  assert.ok(target);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(target, "250");
    target.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await h.click("AI suggest");
  await act(async () => {
    for (let i = 0; i < 40 && !h.text().includes("Insufficient data"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.equal(target.value, "250");
  assert.match(h.text(), /Insufficient data/i);
});

test("OKR objective summary shows Unverified when canonical KR is unavailable", async (t) => {
  const h = await okrHarness(t, [{
    id: "o2",
    title: "Stored on track",
    description: "",
    quarter: "2026-Q1",
    owner_email: "",
    status: "on_track",
    created_at: "2026-01-01",
    key_results: [{
      id: "kr2",
      title: "Canonical ROAS",
      metric_type: "roas",
      linked_channel: "",
      target_value: 2,
      current_value: null,
      unit: "x",
      updated_at: "2026-01-01",
      metric_availability: "unavailable",
      metric_availability_reason: "source_query_failed",
    }],
  }]);
  assert.match(h.text(), /Stored on track[\s\S]*❔ Unverified/);
});

test("OKR objective summary qualifies partial aggregate", async (t) => {
  const partial = await okrHarness(t, [{
    id: "o3",
    title: "Partial objective",
    description: "",
    quarter: "2026-Q1",
    owner_email: "",
    status: "on_track",
    created_at: "2026-01-01",
    key_results: [{
      id: "kr3",
      title: "Partial ROAS",
      metric_type: "roas",
      linked_channel: "",
      target_value: 2,
      current_value: 1,
      unit: "x",
      updated_at: "2026-01-01",
      metric_availability: "partial",
      metric_availability_reason: "input_unavailable:offline",
    }],
  }]);
  assert.match(partial.text(), /50% \(Partial\)/);
  assert.match(partial.text(), /Partial objective[\s\S]*❔ Unverified/);
  assert.match(partial.text(), /❔ 1 Unverified/);
  assert.doesNotMatch(partial.text(), /🟢 1 On Track/);
});

test("OKR objective summary preserves manual completion", async (t) => {
  const complete = await okrHarness(t, [{
    id: "o4",
    title: "Done objective",
    description: "",
    quarter: "2026-Q1",
    owner_email: "",
    status: "complete",
    created_at: "2026-01-01",
    key_results: [{
      id: "kr4",
      title: "Unavailable KR",
      metric_type: "roas",
      linked_channel: "",
      target_value: 2,
      current_value: null,
      unit: "x",
      updated_at: "2026-01-01",
      metric_availability: "unavailable",
      metric_availability_reason: "source_query_failed",
    }],
  }]);
  assert.match(complete.text(), /Done objective[\s\S]*✅ Complete/);
});

test("Marketing OKR refresh preserves availability metadata", async (t) => {
  const objectives = [{
    id: "o1",
    title: "Grow ROAS",
    description: "",
    quarter: "2026-Q1",
    owner_email: "",
    status: "on_track",
    created_at: "2026-01-01",
    key_results: [{
      id: "kr1",
      title: "Blended ROAS",
      metric_type: "roas",
      linked_channel: "",
      target_value: 2,
      current_value: 0,
      unit: "x",
      updated_at: "2026-01-01",
    }],
  }];
  const h = await okrHarness(t, objectives, async () => ({
    ok: true,
    status: "at_risk",
    key_results: [{
      id: "kr1",
      current_value: null,
      metric_availability: "unavailable",
      metric_availability_reason: "source_query_failed",
      metric_is_proxy: false,
    }],
  }));
  await h.click("Grow ROAS");
  await h.click("Refresh from campaigns");
  await act(async () => {
    for (let i = 0; i < 60 && !h.text().includes("Unavailable"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.match(h.text(), /Unavailable \(source query failed\)/i);
  assert.doesNotMatch(h.text(), /0%/);
});

test("metricAvailability helpers preserve valid zero and unavailable labels", () => {
  const lib = load("lib/metricAvailability.ts");
  assert.equal(lib.formatMetricValue(0, "$", { metric_availability: "available" }), "$0");
  assert.equal(lib.formatMetricTarget(2500, "$"), "$2,500");
  assert.equal(
    lib.formatMetricValue(null, "x", { metric_availability: "unavailable", metric_availability_reason: "no_data" }, true),
    "Unavailable (no data)",
  );
  assert.equal(lib.progressPctFromValues(50, 100, { metric_availability: "unavailable" }, true), null);
  assert.equal(lib.progressPctFromValues("", 100, { metric_availability: "available" }, true), null);
  assert.equal(lib.progressLabel(55, { metric_availability: "partial" }), "55% (Partial)");
  assert.equal(
    lib.summarizeObjective({
      status: "on_track",
      key_results: [{
        metric_type: "roas",
        linked_channel: "",
        target_value: 2,
        current_value: null,
        metric_availability: "unavailable",
      }],
    }).statusKey,
    "unverified",
  );
  assert.equal(
    lib.isUnverifiedCanonical({ metric_availability: null, metric_availability_reason: null, metric_is_proxy: false }, true),
    true,
  );
  assert.equal(lib.isCanonicalGoalMetric("ads.totalSpend"), true);
  assert.equal(lib.isCanonicalGoalMetric("drip.bounceRate"), false);
  assert.equal(lib.isCanonicalAutoKr({ metric_type: "blended_roas", linked_channel: "" }), true);
  assert.equal(lib.isCanonicalAutoKr({ metric_type: "true_roas", linked_channel: "" }), true);
  assert.equal(
    lib.summarizeObjective({
      status: "on_track",
      key_results: [{
        metric_type: "blended_roas",
        linked_channel: "",
        target_value: 2,
        current_value: 1,
        metric_availability: "partial",
        metric_availability_reason: "input_unavailable:offline",
      }],
    }).statusKey,
    "unverified",
  );
  assert.equal(
    lib.summarizeObjective({
      status: "on_track",
      key_results: [{
        metric_type: "blended_roas",
        linked_channel: "",
        target_value: 2,
        current_value: 1,
        metric_availability: "partial",
      }],
    }).avgLabel,
    "50% (Partial)",
  );
});
