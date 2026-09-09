"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");

test("AEO report buttons navigate to the canonical tools and update the legacy bridge", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/reach/aeo" });
  const pushes = [];
  const legacyViews = [];
  const router = { push: (url) => pushes.push(url) };
  dom.window.navigateTo = (view) => legacyViews.push(view);
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });

  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019,
    } });
    const module = { exports: {} };
    new Function("exports", "require", "module", outputText)(module.exports, (request) => {
      if (request === "next/navigation") return { useRouter: () => router };
      // Navigation settling is outside this test; keep its timers out of the fixture.
      if (request === "@/lib/navPending") return { markNavPending() {} };
      if (request.startsWith("@/lib/")) return load(request.slice(2) + ".ts");
      return require(request);
    }, module);
    cache.set(file, module.exports);
    return module.exports;
  }
  const requests = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    let body;
    if (url === "/api/aeo/principles") body = { ok: true, principles: [] };
    else if (url === "/api/aeo/runs") body = { ok: true, runs: [] };
    else if (url === "/api/aeo/run" && options.method === "POST") {
      assert.deepEqual(JSON.parse(options.body), { url: "https://example.test/page" });
      body = { ok: true, id: "fixture-run", url: "https://example.test/page", score: 75, grade: "B" };
    } else throw new Error("Unexpected request: " + url);
    return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body };
  };
  t.after(() => { global.fetch = previousFetch; });

  const AeoOptimizer = load("components/features/reach/AeoOptimizer.tsx").default;
  root = require("react-dom/client").createRoot(dom.window.document.getElementById("root"));
  await React.act(async () => root.render(React.createElement(AeoOptimizer)));
  await React.act(async () => {
    const input = dom.window.document.querySelector("input");
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "https://example.test/page");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const click = async (label) => React.act(async () => {
    const button = Array.from(dom.window.document.querySelectorAll("button")).find((node) => node.textContent === label);
    assert.ok(button, "Missing button: " + label);
    button.click();
  });
  await click("Analyze page");
  const beforeNavigation = requests.length;
  await click("Open Schema Generator");
  await click("Citation check (GEO)");

  assert.deepEqual(pushes, ["/create/schema-generator", "/analyse/geo-audit"]);
  assert.deepEqual(legacyViews, ["schema-generator", "geo-audit"]);
  assert.equal(requests.length, beforeNavigation, "navigation does not run another audit or generate content");
});
