"use strict";

const DAY_MS = 86_400_000;
const ordinal = date => Date.parse(date + "T00:00:00Z") / DAY_MS;

function validDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const timestamp = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

function studyLevel(minutes) {
  if (minutes >= 180) return 3;
  if (minutes >= 60) return 2;
  return minutes >= 1 ? 1 : 0;
}

function buildStudyStreak({ userId, logs, activities, today, month, timeZone }) {
  // Include archived subjects so removing a subject does not erase its history.
  const subjects = activities.filter(activity => activity.userId === userId && activity.group === "Study");
  const byDate = new Map();
  for (const log of logs) {
    if (log.userId !== userId || !validDay(log.date) || log.date > today) continue;
    const breakdown = subjects.map(subject => {
      const value = Number(log.times?.[subject.id] || 0);
      const minutes = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
      return { id: subject.id, name: subject.name, minutes, archived: subject.active === false };
    }).filter(subject => subject.minutes > 0).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
    byDate.set(log.date, { minutes: breakdown.reduce((sum, subject) => sum + subject.minutes, 0), subjects: breakdown });
  }

  const studyDates = [...byDate.keys()].filter(date => byDate.get(date).minutes >= 1).sort();
  const studyOrdinals = new Set(studyDates.map(ordinal));
  const todayOrdinal = ordinal(today), studiedToday = studyOrdinals.has(todayOrdinal);
  // Today's unfinished day does not break yesterday's streak.
  let cursor = studiedToday ? todayOrdinal : todayOrdinal - 1, currentStreak = 0;
  const currentEndOrdinal = cursor;
  while (studyOrdinals.has(cursor)) { currentStreak++; cursor--; }
  const fromOrdinal = value => new Date(value * DAY_MS).toISOString().slice(0, 10);

  let longestStreak = 0, run = 0, runStart = null, previous = null;
  let longestStart = null, longestEnd = null;
  for (const date of studyDates) {
    const day = ordinal(date);
    if (previous !== null && day === previous + 1) run++;
    else { run = 1; runStart = date; }
    // Prefer the most recent run when two longest streaks are tied.
    if (run >= longestStreak) { longestStreak = run; longestStart = runStart; longestEnd = date; }
    previous = day;
  }

  const monthStart = new Date(month + "-01T00:00:00Z"), nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const dayCount = Math.round((nextMonth - monthStart) / DAY_MS);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(monthStart.getTime() + index * DAY_MS).toISOString().slice(0, 10);
    const logged = byDate.get(date), minutes = logged?.minutes || 0;
    return {
      date, minutes, subjects: logged?.subjects || [], level: studyLevel(minutes),
      isToday: date === today, isFuture: date > today,
      canEdit: date === today || ordinal(date) === todayOrdinal - 1
    };
  });

  return {
    today, timeZone, month,
    summary: {
      currentStreak, longestStreak, studiedToday, totalStudyDays: studyDates.length,
      currentStart: currentStreak ? fromOrdinal(currentEndOrdinal - currentStreak + 1) : null,
      currentEnd: currentStreak ? fromOrdinal(currentEndOrdinal) : null,
      longestStart, longestEnd
    },
    monthSummary: {
      studyDays: days.filter(day => day.minutes >= 1).length,
      totalMinutes: days.reduce((total, day) => total + day.minutes, 0),
      totalDays: dayCount, elapsedDays: days.filter(day => !day.isFuture).length
    },
    days
  };
}

module.exports = { buildStudyStreak };
