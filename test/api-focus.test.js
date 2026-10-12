"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

test("focus API authenticates, saves once, preserves manual notes and works through Vercel rewrites", async t => {
  const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mytimemap-focus-test-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(temporary, "server.js"));
  fs.cpSync(path.join(root, "lib"), path.join(temporary, "lib"), { recursive: true });
  const child = spawn(process.execPath, ["-e", `
    const http = require('node:http');
    let offset = 0; const realNow = Date.now; Date.now = () => realNow() + offset;
    const handler = require('./server');
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
    process.on('message', message => { offset += message.advance; process.send({ advanced: true }); });
  `], {
    cwd: temporary,
    env: { ...process.env, NODE_PATH: path.join(root, "node_modules"), MONGODB_URI: "", NODE_ENV: "development", VERCEL: "", DATA_DIR: path.join(temporary, "data"), APP_TIME_ZONE: "Asia/Kolkata" },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let output = "";
  child.stderr.on("data", value => { output += value; });
  child.stdout.on("data", value => { output += value; });
  t.after(async () => {
    if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    const resolved = path.resolve(temporary), parent = path.resolve(os.tmpdir()) + path.sep;
    assert(resolved.startsWith(parent) && path.basename(resolved).startsWith("mytimemap-focus-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const ready = await Promise.race([
    once(child, "message").then(([message]) => message),
    once(child, "exit").then(() => { throw Error("Test server failed: " + output); })
  ]);
  let cookie = "", csrf = "";
  async function call(route, method = "GET", payload, includeCsrf = true) {
    const response = await fetch("http://127.0.0.1:" + ready.port + route, {
      method, headers: { "Content-Type": "application/json", Cookie: cookie, ...(includeCsrf ? { "X-CSRF-Token": csrf } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    return { response, data: await response.json() };
  }
  assert.equal((await call("/api/focus")).response.status, 401);
  const registered = await call("/api/register", "POST", { name: "Timer Test", email: "timer@example.test", password: "test-password-123" });
  assert.equal(registered.response.status, 201);
  cookie = registered.response.headers.get("set-cookie").split(";")[0];
  csrf = registered.data.csrfToken;
  const activity = registered.data.activities.find(item => item.group === "Study");
  const initial = (await call("/api/focus")).data, date = initial.today;
  await call("/api/day", "PUT", { date, times: { [activity.id]: 10 }, notes: "Do not overwrite this note" });
  const start = { action: "start", version: initial.version, mode: "focus", minutes: 1, activityId: activity.id };
  assert.equal((await call("/api/focus", "POST", start, false)).response.status, 403);
  const started = await call("/api/focus", "POST", start);
  assert.equal(started.data.session.status, "running");
  const advanced = once(child, "message"); child.send({ advance: 61000 }); await advanced;
  const complete = await call("/api/handler?__path=/api/focus");
  assert.equal(complete.response.status, 200);
  assert.equal(complete.data.session.status, "completed");
  assert.equal(complete.data.summary.sessions, 1);
  const day = (await call("/api/day?date=" + date)).data;
  assert.equal(day.times[activity.id], 11);
  assert.equal(day.notes, "Do not overwrite this note");
  await call("/api/focus", "POST", { action: "complete", version: complete.data.version });
  assert.equal((await call("/api/day?date=" + date)).data.times[activity.id], 11);
  const manual = await call("/api/day", "PUT", { date, times: { [activity.id]: 20 }, notes: day.notes });
  assert.equal(manual.data.log.focusSessions.length, 1);
  assert.equal((await call("/api/focus")).data.summary.sessions, 1);
  assert.equal((await call("/api/day?date=" + date)).data.times[activity.id], 20);
});
