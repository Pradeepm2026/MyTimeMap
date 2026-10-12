"use strict";

const DAY_MS = 86_400_000;

function shiftDate(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

function compareMetric(currentDays, previousDays, metric) {
  const sum = days => days.reduce((total, day) => total + day[metric], 0);
  const count = days => days.filter(day => day[metric + "Logged"]).length;
  const current = sum(currentDays), previous = sum(previousDays);
  const currentLoggedDays = count(currentDays), previousLoggedDays = count(previousDays);
  // A missing entry is not evidence of zero screen time or zero study time.
  const availability = !currentLoggedDays && !previousLoggedDays ? "empty"
    : !currentLoggedDays ? "missing-current"
    : !previousLoggedDays ? "missing-previous" : "ready";
  const delta = availability === "ready" ? current - previous : null;

  return {
    current, previous, currentLoggedDays, previousLoggedDays, availability, delta,
    percent: delta !== null && previous > 0 ? Math.round(delta / previous * 1000) / 10 : null,
    direction: delta === null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "same"
  };
}

// Dates and daily totals come from the authenticated user's dashboard data.
// Current weeks use matching weekdays; finished weeks compare all seven days.
function buildWeeklyInsights({ start, today, days }) {
  const end = shiftDate(start, 6), previousStart = shiftDate(start, -7);
  const isFutureWeek = start > today, isCurrentWeek = start <= today && today <= end;
  const comparedDays = isFutureWeek ? 0 : isCurrentWeek
    ? Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY_MS) + 1 : 7;
  const currentEnd = comparedDays ? shiftDate(start, comparedDays - 1) : null;
  const previousEnd = comparedDays ? shiftDate(previousStart, comparedDays - 1) : null;
  const currentDays = currentEnd ? days.filter(day => day.date >= start && day.date <= currentEnd) : [];
  const previousDays = previousEnd ? days.filter(day => day.date >= previousStart && day.date <= previousEnd) : [];
  const mostStudy = Math.max(0, ...currentDays.map(day => day.study));
  const bestDay = mostStudy > 0 ? {
    minutes: mostStudy,
    dates: currentDays.filter(day => day.study === mostStudy).map(day => day.date).sort()
  } : null;

  return {
    isCurrentWeek, isFutureWeek, comparedDays,
    current: { start, end, comparedEnd: currentEnd, loggedDays: currentDays.filter(day => day.logged).length },
    previous: { start: previousStart, end: shiftDate(previousStart, 6), comparedEnd: previousEnd, loggedDays: previousDays.filter(day => day.logged).length },
    study: compareMetric(currentDays, previousDays, "study"),
    mobile: compareMetric(currentDays, previousDays, "mobile"),
    bestDay,
    rhythm: Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(start, index), day = currentDays.find(item => item.date === date);
      return { date, study: day?.study || 0, logged: day?.studyLogged || false, included: index < comparedDays };
    })
  };
}

module.exports = { buildWeeklyInsights };
