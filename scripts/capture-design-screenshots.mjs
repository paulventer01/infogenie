import puppeteer from "puppeteer";
import { mkdirSync } from "fs";

const shots = "/workspace/design-reference/screenshots";
mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  protocolTimeout: 120000,
});

const page = await browser.newPage();
page.setDefaultTimeout(60000);

async function shot(name, w = 1440, h = 900) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${shots}/${name}`, fullPage: false });
  console.log("ok", name, page.url());
}

try {
  await page.goto("http://127.0.0.1:5000/login", { waitUntil: "networkidle2", timeout: 60000 });
  await shot("01-login-desktop.png", 1440, 900);
  await shot("08-login-mobile.png", 390, 844);

  // Authenticate via same-origin fetch so the session cookie is set in the browser
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:5000/login", { waitUntil: "domcontentloaded" });
  const loginResult = await page.evaluate(async () => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "demo@infogenie.local",
        password: "preview123",
      }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  console.log("loginResult", JSON.stringify(loginResult));
  if (!loginResult.body?.ok) {
    throw new Error("Login failed: " + JSON.stringify(loginResult));
  }

  await page.goto("http://127.0.0.1:5000/", { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));
  console.log("after login", page.url());
  await shot("02-shell-dashboard.png", 1440, 900);

  const routes = [
    ["03-ai-team.png", "http://127.0.0.1:5000/ai-team"],
    ["04-technical-manager.png", "http://127.0.0.1:5000/technical-manager"],
    ["05-goals-hub.png", "http://127.0.0.1:5000/manage/goals"],
    ["06-metrics-ssot.png", "http://127.0.0.1:5000/manage/canonical-metrics"],
    ["07-contribution.png", "http://127.0.0.1:5000/grow/contribution-record"],
  ];

  for (const [name, url] of routes) {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await shot(name, 1440, 900);
  }

  await page.goto("http://127.0.0.1:5000/", { waitUntil: "networkidle2", timeout: 60000 });
  await shot("09-shell-mobile.png", 390, 844);

  console.log("done");
} catch (e) {
  console.error("capture failed", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
