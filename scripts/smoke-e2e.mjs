#!/usr/bin/env node
/**
 * Browser smoke test for the signed-in workflows.
 *
 * Not part of `npm test`: it needs a running dev server and writes to the DEV
 * database, so it stays a deliberate command rather than something that fires
 * in CI against whatever happens to be running.
 *
 *   npm run dev                 # in one terminal
 *   npx playwright install chromium
 *   node scripts/smoke-e2e.mjs  # in another
 *
 * It exists because a stale-state bug once let the board show zero tasks while
 * the database held three, and every non-browser check passed. Only driving the
 * real UI caught it.
 */

import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";

let failures = 0;

function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${expected}, got ${actual}`}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text());
});

try {
  console.log("\nsigned-out routing");
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  check("/today redirects to /login", new URL(page.url()).pathname, "/login");

  console.log("\nregistration");
  const email = `smoke-${Date.now()}@example.test`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "Smoke Test");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/today", { timeout: 30_000 });
  check("lands on /today after signup", new URL(page.url()).pathname, "/today");

  console.log("\ntask creation");
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.fill('input[name="title"]', "Smoke task");
  await page.click('.quick-add button[type="submit"]');
  await page.waitForTimeout(2000);
  const cards = await page.$$eval(".board-card", (els) => els.length);
  // Guards the stale-props bug: the card must appear without a manual reload.
  check("new task appears on the board without reload", cards, 1);

  console.log("\ndrag and drop");
  const before = await page.$$eval(".board-column > header b", (e) => e.map((x) => x.textContent).join("/"));
  check("starts in Todo", before, "1/0/0/0");

  const card = await page.$(".board-card");
  const target = (await page.$$(".board-column"))[1];
  const cb = await card.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 40, cb.y + cb.height / 2 + 10, { steps: 8 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 80, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(2500);

  const after = await page.$$eval(".board-column > header b", (e) => e.map((x) => x.textContent).join("/"));
  check("moves to In progress", after, "0/1/0/0");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const persisted = await page.$$eval(".board-column > header b", (e) => e.map((x) => x.textContent).join("/"));
  // A reload is the only proof the move reached the server rather than local state.
  check("move survives a hard reload", persisted, "0/1/0/0");

  console.log("\ntoday view");
  await page.goto(`${BASE}/today`, { waitUntil: "networkidle" });
  const hasTask = await page.locator("text=Smoke task").count();
  check("task shows on Today", hasTask > 0, true);

  console.log("\nplaceholders are honest");
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  check("projects says NOT BUILT YET", await page.locator("text=NOT BUILT YET").count() > 0, true);

  console.log("\nconsole");
  check("no page errors", pageErrors.length, 0);
  if (pageErrors.length) console.log(pageErrors.slice(0, 5));
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll smoke checks passed.\n" : `\n${failures} smoke check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
