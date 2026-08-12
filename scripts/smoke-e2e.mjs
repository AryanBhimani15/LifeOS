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
  await page.waitForURL("**/onboarding", { timeout: 30_000 });
  check("a new account is sent to setup", new URL(page.url()).pathname, "/onboarding");

  console.log("\nonboarding");
  // Name is prefilled from the account, so the first step only needs Continue.
  await page.waitForSelector(".ob-input");
  await page.click(".ob-primary");
  await page.waitForTimeout(700);

  // What their week looks like, then what they want out of it. Both advance on
  // selection, and both feed the plan generated at the end.
  await page.click('.ob-level:has-text("Studying")');
  await page.waitForTimeout(1000);
  await page.click('.ob-level:has-text("Build strength")');
  await page.waitForTimeout(1000);

  await page.fill(".ob-input-short", "");
  await page.click(".ob-primary");
  await page.waitForTimeout(300);
  check(
    "an empty age is refused with a readable message",
    await page.locator(".ob-error").innerText(),
    "Enter your age.",
  );

  await page.fill(".ob-input-short", "24");
  await page.click(".ob-primary");
  await page.waitForTimeout(700);

  await page.click(".ob-choice >> nth=0"); // sex — advances on its own
  await page.waitForTimeout(900);


  await page.fill(".ob-input-short", "180");
  await page.click(".ob-primary");
  await page.waitForTimeout(700);

  await page.fill(".ob-input-short", "75");
  await page.click(".ob-primary");
  await page.waitForTimeout(700);

  await page.click('.ob-level:has-text("Moderately Active")');
  await page.click(".ob-primary");
  await page.waitForSelector(".ob-step-done", { timeout: 30_000 });
  await page.waitForTimeout(900);

  check("setup ends on a welcome", await page.locator(".ob-welcome").count(), 1);
  // The answers must visibly become something. An empty summary here means
  // setup asked eight questions and built nothing, which is the failure this
  // whole flow exists to avoid.
  check(
    "and shows what was built from the answers",
    (await page.locator(".ob-summary li").count()) >= 3,
    true,
  );

  await page.click(".ob-primary");
  await page.waitForURL("**/today", { timeout: 30_000 });
  check("setup hands over to Today", new URL(page.url()).pathname, "/today");

  console.log("\nwhat setup produced");
  await page.waitForLoadState("networkidle");
  check("a training plan appears on Today", await page.locator(".section-title:has-text('Training')").count(), 1);
  check("starter habits exist", (await page.locator(".habit").count()) >= 2, true);
  check("starter goals exist", (await page.locator(".goal-row").count()) >= 2, true);

  console.log("\neffortless capture");
  await page.fill(".quick-task input", "Email the supervisor");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  check("a task is added from one field", await page.locator("text=Email the supervisor").count() > 0, true);
  check("and the field is ready for the next one", await page.inputValue(".quick-task input"), "");

  console.log("\ncalorie calculator");
  await page.goto(`${BASE}/fitness`, { waitUntil: "networkidle" });
  await page.waitForSelector(".fit-select-trigger");
  await page.click(".fit-select-trigger");
  await page.fill(".fit-select-search input", "running");
  await page.click('.fit-select-option:has-text("Running")');
  await page.fill(".fit-duration-input input >> nth=0", "1");
  await page.fill(".fit-duration-input input >> nth=1", "30");
  await page.click(".fit-primary");
  await page.waitForSelector(".fit-result", { timeout: 30_000 });
  await page.waitForTimeout(1200);
  // 600 kcal/hour for 90 minutes. The one number in this feature with a
  // checkable right answer.
  check("1h 30m of running is 900 kcal", await page.locator(".fit-result-number").innerText(), "900");

  await page.click(".fit-secondary");
  await page.waitForSelector(".fit-result-saved", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  check("today's burn picks up the saved workout", await page.locator(".fit-big").innerText(), "900");

  await page.goto(`${BASE}/fitness/history`, { waitUntil: "networkidle" });
  check("the workout is in history", await page.locator(".fit-entry").count(), 1);

  await page.locator(".fit-entry-delete").first().click();
  await page.waitForTimeout(300);
  await page.click(".fit-confirm-yes");
  await page.waitForTimeout(1800);
  check("deleting removes it", await page.locator(".fit-entry").count(), 0);

  console.log("\ntask creation");
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.fill('input[name="title"]', "Smoke task");
  await page.click('.quick-add button[type="submit"]');
  await page.waitForTimeout(2000);
  const cards = await page.$$eval(".board-card", (els) => els.length);
  // Two: this one, plus the one captured from Today's quick-add above.
  check("new task appears on the board without reload", cards, 2);

  console.log("\ndrag and drop");
  const before = await page.$$eval(".board-column > header b", (e) => e.map((x) => x.textContent).join("/"));
  check("starts in Todo", before, "2/0/0/0");

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
  check("moves to In progress", after, "1/1/0/0");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const persisted = await page.$$eval(".board-column > header b", (e) => e.map((x) => x.textContent).join("/"));
  // A reload is the only proof the move reached the server rather than local state.
  check("move survives a hard reload", persisted, "1/1/0/0");

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
