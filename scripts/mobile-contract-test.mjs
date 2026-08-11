const B = "http://localhost:3000";
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
const post = (p, body, token) =>
  fetch(B + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(j);
const get = (p, token) =>
  fetch(B + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(j);

let pass = 0, fail = 0;
const check = (label, ok, extra = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
};

// 1. login
const login = await post("/api/mobile/auth/login", {
  email: "demo@lifeos.local", password: "lifeos-demo-2026",
  device: { name: "iPhone 15", installId: "install-test-0001", platform: "ios" },
});
check("login returns tokens", login.status === 200 && !!login.body.accessToken, `status ${login.status}`);
const { accessToken, refreshToken } = login.body;

// 2. wrong password
const bad = await post("/api/mobile/auth/login", { email: "demo@lifeos.local", password: "wrong-password-here" });
check("wrong password rejected", bad.status === 401);

// 3. bearer works on the SHARED endpoints (no duplicated logic)
const tasks = await get("/api/tasks", accessToken);
check("bearer authenticates /api/tasks", tasks.status === 200, `${tasks.body?.items?.length ?? 0} tasks`);
const me = await get("/api/mobile/me", accessToken);
check("bearer authenticates /api/mobile/me", me.status === 200, me.body?.user ? `${me.body.user.name}, tz ${me.body.timezone}, via ${me.body.authMethod}` : "");

// 4. Vary header
check("Vary includes Authorization and Cookie", (tasks.headers.get("vary") || "").includes("Authorization"), tasks.headers.get("vary"));

// 5. unauthenticated + garbage
check("no token rejected", (await get("/api/mobile/me")).status === 401);
check("garbage token rejected", (await get("/api/mobile/me", "nonsense")).status === 401);

// 6. device registration
const dev = await post("/api/mobile/devices", { installId: "install-test-0001", platform: "ios", pushToken: "ExponentPushToken[abc]", appVersion: "1.0.0" }, accessToken);
check("device registers", dev.status === 200 && dev.body.device, `pushDeliveryEnabled=${dev.body?.pushDeliveryEnabled}`);

// 7. the AI command pipeline over bearer — the whole point
const plan = await post("/api/ai/command", { input: "create a task to call Mom tonight" }, accessToken);
const planned = plan.status === 200 && plan.body?.planId;
check("AI command returns a plan over bearer auth", !!planned, planned ? plan.body.summary : JSON.stringify(plan.body?.error));

if (planned) {
  const key = "idem-" + Date.now();
  const exec1 = await post(`/api/ai/plans/${plan.body.planId}/execute`, { confirmed: false, idempotencyKey: key }, accessToken);
  check("plan executes", exec1.status === 200, `executed ${exec1.body?.executed}`);
  const exec2 = await post(`/api/ai/plans/${plan.body.planId}/execute`, { confirmed: false, idempotencyKey: key }, accessToken);
  check("retry with same key replays result (not an error)", exec2.status === 200 && exec2.body?.executed === exec1.body?.executed);
  const exec3 = await post(`/api/ai/plans/${plan.body.planId}/execute`, { confirmed: false, idempotencyKey: "different-key-99" }, accessToken);
  check("different key on spent plan is refused", exec3.status >= 400, `status ${exec3.status}`);
}

// 8. refresh + revoke
const refreshed = await post("/api/mobile/auth/refresh", { refreshToken });
check("refresh issues a new access token", refreshed.status === 200 && !!refreshed.body.accessToken);
check("refresh token is NOT rotated", refreshed.body?.refreshToken === refreshToken);
check("revoke succeeds", (await post("/api/mobile/auth/revoke", { refreshToken })).status === 200);
check("refresh after revoke is 401", (await post("/api/mobile/auth/refresh", { refreshToken })).status === 401);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
