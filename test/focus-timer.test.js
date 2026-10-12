"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFocusService, createFocusRepository } = require("../lib/focus-timer");

function setup(options = {}) {
  let time = options.start ?? Date.parse("2026-10-13T06:00:00Z");
  const db = { focusTimers: [], logs: options.logs || [] };
  const repository = createFocusRepository({ getDatabase: () => db, getMongoDatabase: () => null, save: async () => {} });
  const service = createFocusService({ repository, now: () => time, dateAt: value => new Date(value).toISOString().slice(0, 10) });
  const activities = [{ id: "maths", userId: "a", group: "Study", name: "Maths", active: true }, { id: "sleep", userId: "a", group: "Sleep", name: "Sleep" }];
  async function act(action, extra = {}, userId = "a") {
    const { version } = await repository.getTimer(userId);
    return service.act(userId, { action, version, ...extra }, activities);
  }
  return { db, repository, service, act, activities, advance: ms => { time += ms; } };
}

test("pause excludes elapsed break time; completion adds to the existing subject once", async () => {
  const f = setup({ logs: [{ userId: "a", date: "2026-10-13", times: { maths: 40, other: 7 }, notes: "Keep this note" }] });
  await f.act("start", { mode: "focus", minutes: 25, activityId: "maths" });
  f.advance(10 * 60000);
  const paused = await f.act("pause");
  assert.equal(paused.session.remainingMs, 15 * 60000);
  f.advance(2 * 60 * 60000);
  assert.equal((await f.service.read("a")).session.status, "paused");
  await f.act("resume");
  f.advance(14 * 60000);
  assert.equal((await f.act("complete")).session.status, "running");
  assert.equal(f.db.logs[0].times.maths, 40);
  f.advance(60000);
  const done = await f.service.read("a");
  assert.equal(done.session.status, "completed");
  assert.equal(f.db.logs[0].times.maths, 65);
  assert.equal(f.db.logs[0].times.other, 7);
  assert.equal(f.db.logs[0].notes, "Keep this note");
  await f.act("complete"); await f.service.read("a");
  assert.equal(f.db.logs[0].times.maths, 65);
  assert.equal(f.db.logs[0].focusSessions.length, 1);
  assert.equal(done.summary.minutes, 25);
});

test("short and long breaks complete without adding study minutes", async () => {
  const f = setup();
  for (const mode of ["short", "long"]) {
    await f.act("start", { mode, minutes: 5 }); f.advance(5 * 60000);
    assert.equal((await f.service.read("a")).session.status, "completed");
  }
  assert.equal(f.db.logs.length, 0);
});

test("reset discards unfinished study; a reset after expiry still saves completion", async () => {
  const f = setup();
  await f.act("start", { mode: "focus", minutes: 1, activityId: "maths" });
  f.advance(30000); await f.act("reset");
  assert.equal(f.db.logs.length, 0);
  assert.equal((await f.service.read("a")).session, null);
  await f.act("start", { mode: "focus", minutes: 1, activityId: "maths" });
  f.advance(60000);
  assert.equal((await f.act("reset")).session.status, "completed");
  assert.equal(f.db.logs[0].times.maths, 1);
});

test("reopening a running session recovers the server deadline and completion day", async () => {
  const f = setup({ start: Date.parse("2026-10-13T23:50:00Z") });
  const original = await f.act("start", { mode: "focus", minutes: 25, activityId: "maths" });
  f.advance(35 * 60000);
  const restored = await f.service.read("a");
  assert.equal(restored.session.id, original.session.id);
  assert.equal(restored.session.date, "2026-10-14");
  assert.equal(f.db.logs[0].date, "2026-10-14");
});

test("a failure after the log increment can retry without double counting", async () => {
  const f = setup();
  await f.act("start", { mode: "focus", minutes: 1, activityId: "maths" });
  f.advance(60000);
  const replace = f.repository.replaceTimer;
  let fail = true;
  f.repository.replaceTimer = async (version, next) => {
    if (next.session?.status === "completed" && fail) { fail = false; throw Error("Connection interrupted"); }
    return replace(version, next);
  };
  await assert.rejects(f.service.read("a"), /Connection interrupted/);
  assert.equal(f.db.logs[0].times.maths, 1);
  assert.equal((await f.service.read("a")).session.status, "completed");
  assert.equal(f.db.logs[0].times.maths, 1);
  assert.equal(f.db.logs[0].focusSessions.length, 1);
});

test("invalid durations, another user's subject and stale versions are rejected", async () => {
  const f = setup();
  for (const minutes of [0, -1, 181, 1.5, "25"]) await assert.rejects(f.act("start", { mode: "focus", minutes, activityId: "maths" }), /1–180/);
  await assert.rejects(f.act("start", { mode: "toString", minutes: 25 }), /1–180/);
  await assert.rejects(f.act("start", { mode: "focus", minutes: 25, activityId: "sleep" }), /study subject/);
  await assert.rejects(f.act("start", { mode: "focus", minutes: 25, activityId: "maths" }, "b"), /study subject/);
  await f.act("start", { mode: "focus", minutes: 25, activityId: "maths" });
  await assert.rejects(f.service.act("a", { action: "reset", version: 0 }, f.activities), /another tab/);
  assert.equal((await f.service.read("b")).session, null);
});

test("capacity errors retain the completed session for retry after correcting the log", async () => {
  const f = setup({ logs: [{ userId: "a", date: "2026-10-13", times: { maths: 1440 }, notes: "" }] });
  await f.act("start", { mode: "focus", minutes: 1, activityId: "maths" }); f.advance(60000);
  const blocked = await f.service.read("a");
  assert.equal(blocked.session.status, "saving");
  assert.match(blocked.warning, /24 hours/);
  f.db.logs[0].times.maths = 60;
  assert.equal((await f.service.read("a")).session.status, "completed");
  assert.equal(f.db.logs[0].times.maths, 61);
});

test("MongoDB increment stores its receipt atomically and accepts an already-saved retry", async () => {
  const session = { id: "session-1", userId: "a", date: "2026-10-13", activityId: "maths", activityName: "Maths", minutes: 25, completedAt: 1 };
  let command;
  const collection = {
    updateOne: async (...args) => { command = args; },
    findOne: async () => ({ focusSessions: [{ id: session.id }] })
  };
  const repository = createFocusRepository({ getMongoDatabase: () => ({ collection: () => collection }) });
  await repository.addStudyTime(session);
  assert.deepEqual(command[0]["focusSessions.id"], { $ne: session.id });
  assert.equal(command[1].$inc["times.maths"], 25);
  assert.equal(command[1].$push.focusSessions.id, session.id);
  assert.equal(command[1].$setOnInsert.notes, "");
  collection.updateOne = async () => { throw Object.assign(Error("duplicate"), { code: 11000 }); };
  await assert.doesNotReject(repository.addStudyTime(session));
});
