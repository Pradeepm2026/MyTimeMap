"use strict";

const { randomUUID } = require("node:crypto");
const MINUTE = 60_000;
const MODES = { focus: { min: 1, max: 180 }, short: { min: 1, max: 60 }, long: { min: 1, max: 60 } };

class FocusError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// The repository handles persistence; server timestamps keep paused and resumed
// sessions accurate even when a browser tab is asleep or the page is reloaded.
function createFocusService({ repository, dateAt, now = Date.now, makeId = randomUUID }) {
  async function replace(previous, session) {
    const next = { userId: previous.userId, version: previous.version + 1, session };
    if (!await repository.replaceTimer(previous.version, next)) {
      throw new FocusError("The timer changed in another tab. Refresh its status and try again.", 409);
    }
    return next;
  }

  async function settle(record) {
    const session = record.session;
    if (!session || session.status === "paused" || session.status === "completed") return record;
    if (session.status === "running") {
      if (now() < session.endsAt) return record;
      record = await replace(record, {
        ...session, status: "saving", remainingMs: 0,
        completedAt: session.endsAt, date: dateAt(session.endsAt)
      });
    }
    if (record.session.status === "saving") {
      // The log records the session id in the same atomic write as the increment.
      // A retry after an interrupted response can safely finish this operation.
      if (record.session.mode === "focus") await repository.addStudyTime(record.session);
      record = await replace(record, { ...record.session, status: "completed" });
    }
    return record;
  }

  async function snapshot(record) {
    const serverNow = now();
    return { ...record, serverNow, today: dateAt(serverNow), summary: await repository.summary(record.userId, dateAt(serverNow)) };
  }

  async function read(userId) {
    let record = await repository.getTimer(userId);
    try { record = await settle(record); }
    catch (error) {
      if (error.status !== 409) throw error;
      record = await repository.getTimer(userId);
      return { ...await snapshot(record), warning: error.message };
    }
    return snapshot(record);
  }

  async function act(userId, input, activities) {
    if (!input || typeof input !== "object" || !["start", "pause", "resume", "reset", "complete"].includes(input.action)) {
      throw new FocusError("Choose a valid timer action.");
    }
    let record = await repository.getTimer(userId);
    if (!Number.isInteger(input.version) || input.version !== record.version) {
      throw new FocusError("The timer changed in another tab. Refresh its status and try again.", 409);
    }
    const previousVersion = record.version;
    record = await settle(record);
    // Expiry wins over a late pause/reset/start. Return the completed session so
    // a network retry cannot accidentally start a second session.
    if (previousVersion !== record.version || input.action === "complete") return snapshot(record);

    const session = record.session;
    if (input.action === "start") {
      if (session && session.status !== "completed") throw new FocusError("Finish or reset the current session first.", 409);
      const range = Object.hasOwn(MODES, input.mode) ? MODES[input.mode] : null;
      if (!range || !Number.isInteger(input.minutes) || input.minutes < range.min || input.minutes > range.max) {
        throw new FocusError("Use 1–180 minutes for focus or 1–60 minutes for a break.");
      }
      const activity = input.mode === "focus" ? activities.find(item => item.id === input.activityId && item.userId === userId && item.group === "Study" && item.active !== false) : null;
      if (input.mode === "focus" && !activity) throw new FocusError("Choose an active study subject from your schedule.");
      const startedAt = now(), durationMs = input.minutes * MINUTE;
      record = await replace(record, {
        id: makeId(), userId, mode: input.mode, minutes: input.minutes,
        activityId: activity?.id || null, activityName: activity?.name || "Break",
        status: "running", startedAt, endsAt: startedAt + durationMs, remainingMs: durationMs
      });
    } else if (input.action === "pause") {
      if (!session || session.status !== "running") throw new FocusError("There is no running timer to pause.", 409);
      record = await replace(record, { ...session, status: "paused", remainingMs: Math.max(0, session.endsAt - now()), endsAt: null });
    } else if (input.action === "resume") {
      if (!session || session.status !== "paused") throw new FocusError("There is no paused timer to resume.", 409);
      record = await replace(record, { ...session, status: "running", endsAt: now() + session.remainingMs });
    } else if (input.action === "reset") {
      record = await replace(record, null);
    }
    return snapshot(record);
  }

  return { read, act };
}

function createFocusRepository({ getDatabase, getMongoDatabase, save }) {
  async function getTimer(userId) {
    const mongo = getMongoDatabase();
    const record = mongo
      ? await mongo.collection("focusTimers").findOne({ _id: userId })
      : getDatabase().focusTimers.find(item => item.userId === userId);
    if (!record) return { userId, version: 0, session: null };
    const { _id, ...timer } = record;
    return structuredClone(timer);
  }

  async function replaceTimer(expectedVersion, next) {
    const mongo = getMongoDatabase();
    if (mongo) {
      try {
        const result = await mongo.collection("focusTimers").replaceOne(
          { _id: next.userId, version: expectedVersion },
          { ...next, _id: next.userId }, { upsert: expectedVersion === 0 }
        );
        return result.matchedCount === 1 || result.upsertedCount === 1;
      } catch (error) { if (error.code === 11000) return false; throw error; }
    }
    const db = getDatabase(), index = db.focusTimers.findIndex(item => item.userId === next.userId);
    if ((index < 0 ? 0 : db.focusTimers[index].version) !== expectedVersion) return false;
    if (index < 0) db.focusTimers.push(structuredClone(next)); else db.focusTimers[index] = structuredClone(next);
    await save();
    return true;
  }

  async function addStudyTime(session) {
    const { userId, date, activityId, minutes } = session;
    const entry = { id: session.id, activityId, activityName: session.activityName, minutes, completedAt: session.completedAt };
    const mongo = getMongoDatabase(), limitError = () => new FocusError("This subject would exceed 24 hours for the day. Adjust its Daily Log total, then retry saving the session.", 409);
    if (mongo) {
      const logs = mongo.collection("logs"), id = userId + ":" + date, timeField = "times." + activityId;
      try {
        await logs.updateOne({
          _id: id, "focusSessions.id": { $ne: session.id },
          $or: [{ [timeField]: { $lte: 1440 - minutes } }, { [timeField]: { $exists: false } }]
        }, {
          $setOnInsert: { userId, date, notes: "" }, $set: { updatedAt: Date.now() },
          $inc: { [timeField]: minutes }, $push: { focusSessions: entry }
        }, { upsert: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await logs.findOne({ _id: id });
        if (!existing?.focusSessions?.some(item => item.id === session.id)) throw limitError();
      }
      return;
    }
    const db = getDatabase();
    let log = db.logs.find(item => item.userId === userId && item.date === date);
    if (log?.focusSessions?.some(item => item.id === session.id)) return;
    const total = Number(log?.times?.[activityId] || 0) + minutes;
    if (total > 1440) throw limitError();
    if (!log) { log = { userId, date, times: {}, notes: "" }; db.logs.push(log); }
    log.times[activityId] = total;
    log.focusSessions = [...(log.focusSessions || []), entry];
    log.updatedAt = Date.now();
    await save();
  }

  async function summary(userId, date) {
    const mongo = getMongoDatabase();
    const log = mongo ? await mongo.collection("logs").findOne({ _id: userId + ":" + date }) : getDatabase().logs.find(item => item.userId === userId && item.date === date);
    const entries = log?.focusSessions || [];
    return { sessions: entries.length, minutes: entries.reduce((sum, item) => sum + item.minutes, 0), recent: [...entries].sort((a, b) => b.completedAt - a.completedAt).slice(0, 4) };
  }

  return { getTimer, replaceTimer, addStudyTime, summary };
}

module.exports = { createFocusService, createFocusRepository, FocusError };
