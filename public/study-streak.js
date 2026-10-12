"use strict";

window.StudyStreak = (() => {
  let host = null, owner = null, month = null, selectedDate = null, data = null;
  let requestId = 0, pending = false, refreshQueued = false, dayWatcher = null;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const duration = value => Math.floor(value / 60) + "h " + String(value % 60).padStart(2, "0") + "m";
  const compactDuration = value => value < 60 ? value + "m" : Math.floor(value / 60) + "h" + (value % 60 ? " " + value % 60 + "m" : "");
  const dateLabel = (date, options = { day: "numeric", month: "short", year: "numeric" }) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(date + "T00:00:00Z"));
  const countLabel = count => count === 1 ? "day" : "days";
  const rangeLabel = (start, end) => start === end ? dateLabel(start) : dateLabel(start) + " – " + dateLabel(end);
  const visible = () => owner && host?.isCurrent();
  const svg = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const icons = {
    flame: svg('<path d="M13 2c1 5-4 6-4 10 0 1 .4 2 1 2.5-3-.5-4-2.5-3-5.5-3 3-4 5-3 8a8.4 8.4 0 0 0 16-3c0-4-3-7-7-12Z"/><path d="M12 14c-2 2-3 3.5-2 5a2.5 2.5 0 0 0 4 0c1-1.5 0-3-2-5Z"/>'),
    trophy: svg('<path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v6m-4 2h8m-6-2h4"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5 3 2 5-4"/>'),
    book: svg('<path d="M3 5.5C6 4.5 9 5 12 7c3-2 6-2.5 9-1.5v14c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5Z"/><path d="M12 7v14"/>')
  };

  function summaryCards() {
    const summary = data.summary;
    const currentHint = summary.studiedToday ? "Today’s study counts. Keep your rhythm."
      : summary.currentStreak ? "Through yesterday. Today is still open." : "Your next study day starts a new streak.";
    const longestHint = summary.longestStreak ? rangeLabel(summary.longestStart, summary.longestEnd) : "Your personal best starts with one day.";
    return `<div class="streak-stats">
      <article class="streak-stat streak-stat-current"><div class="streak-stat-label"><span class="streak-stat-icon">${icons.flame}</span><h2>Current streak</h2><span class="streak-stat-tag">Now</span></div><p class="streak-stat-value">${summary.currentStreak}<span>${countLabel(summary.currentStreak)}</span></p><p>${currentHint}</p></article>
      <article class="streak-stat streak-stat-best"><div class="streak-stat-label"><span class="streak-stat-icon">${icons.trophy}</span><h2>Longest streak</h2><span class="streak-stat-tag">All time</span></div><p class="streak-stat-value">${summary.longestStreak}<span>${countLabel(summary.longestStreak)}</span></p><p>${longestHint}</p></article>
      <article class="streak-stat streak-stat-month"><div class="streak-stat-label"><span class="streak-stat-icon">${icons.calendar}</span><h2>Study days</h2><span class="streak-stat-tag">${dateLabel(month + "-01", { month: "short", year: "numeric" })}</span></div><p class="streak-stat-value">${data.monthSummary.studyDays}<span>/ ${data.monthSummary.totalDays} days</span></p><p>${duration(data.monthSummary.totalMinutes)} studied in the selected month.</p></article>
    </div>`;
  }

  function selectors() {
    const [year, selectedMonth] = month.split("-"), yearNumber = Number(year);
    const months = Array.from({ length: 12 }, (_, index) => {
      const value = String(index + 1).padStart(2, "0");
      return `<option value="${value}"${value === selectedMonth ? " selected" : ""}>${dateLabel("2026-" + value + "-01", { month: "long" })}</option>`;
    }).join("");
    const years = Array.from({ length: Math.min(9999, yearNumber + 10) - Math.max(1, yearNumber - 10) + 1 }, (_, index) => Math.max(1, yearNumber - 10) + index)
      .map(value => `<option value="${String(value).padStart(4, "0")}"${value === yearNumber ? " selected" : ""}>${value}</option>`).join("");
    return `<div class="streak-calendar-controls">
      <button type="button" class="streak-arrow" data-streak-month-step="-1" aria-label="Previous month"${month === "0001-01" ? " disabled" : ""}>‹</button>
      <label><span>Month</span><select id="streakMonth" aria-label="Calendar month">${months}</select></label>
      <label><span>Year</span><select id="streakYear" aria-label="Calendar year">${years}</select></label>
      <button type="button" class="streak-arrow" data-streak-month-step="1" aria-label="Next month"${month === "9999-12" ? " disabled" : ""}>›</button>
      <button type="button" class="streak-today-button" id="streakToday">Today</button>
    </div>`;
  }

  function calendarCells() {
    const firstWeekday = (new Date(month + "-01T00:00:00Z").getUTCDay() + 6) % 7;
    const leading = '<span class="streak-calendar-blank" aria-hidden="true"></span>'.repeat(firstWeekday);
    return leading + data.days.map(day => {
      const label = dateLabel(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const detail = day.isFuture ? "Upcoming day" : day.minutes ? duration(day.minutes) + " study" : "No study logged";
      return `<button type="button" class="streak-day streak-level-${day.level}${day.isToday ? " is-today" : ""}${day.isFuture ? " is-future" : ""}" data-study-date="${day.date}" aria-label="${escape(label + ", " + detail)}" aria-pressed="${selectedDate === day.date}"${day.isToday ? ' aria-current="date"' : ""}${day.isFuture ? " disabled" : ""} title="${escape(label + " · " + detail)}">
        <span class="streak-day-top"><span>${Number(day.date.slice(-2))}</span>${day.isToday ? '<i aria-hidden="true"></i>' : ""}</span>
        <span class="streak-day-time">${day.minutes ? compactDuration(day.minutes) : "—"}</span>
      </button>`;
    }).join("");
  }

  function details() {
    const day = data.days.find(item => item.date === selectedDate);
    if (!day) return `<div class="streak-detail-empty"><span class="streak-detail-symbol">${icons.calendar}</span><h3>A fresh month ahead</h3><p>Study days will appear here once this month begins. Choose an earlier month to explore your history.</p></div>`;
    const breakdown = day.subjects.length ? `<ul class="streak-subject-list">${day.subjects.map(subject => `<li><div class="streak-subject-heading"><span>${escape(subject.name)}${subject.archived ? '<small>Archived</small>' : ""}</span><strong>${duration(subject.minutes)}</strong></div><div class="streak-subject-track" aria-hidden="true"><i style="width:${subject.minutes / day.minutes * 100}%"></i></div></li>`).join("")}</ul>`
      : '<div class="streak-no-study"><span>' + icons.book + '</span><p>No study time logged for this day.</p></div>';
    return `<p class="streak-eyebrow">DAY DETAILS</p><h3>${dateLabel(day.date, { weekday: "long" })}</h3><p class="streak-detail-date">${dateLabel(day.date, { day: "numeric", month: "long", year: "numeric" })}${day.isToday ? ' <span>Today</span>' : ""}</p>
      <div class="streak-detail-total"><strong>${duration(day.minutes)}</strong><span>Total study time</span></div>
      <p class="streak-day-status${day.minutes ? " has-study" : ""}">${day.minutes ? "✓ Counts as a study day" : "No study day recorded"}</p>
      ${breakdown}
      <p class="streak-detail-note">Includes study saved from your Daily Log and completed focus sessions.</p>
      ${day.canEdit ? '<button type="button" class="streak-log-link" id="streakOpenLog">Open Daily Log <span aria-hidden="true">→</span></button>' : '<p class="streak-history-note">Past records are available to view. Daily Log editing is limited to today and yesterday.</p>'}`;
  }

  function drawDetails() {
    const panel = document.getElementById("streakDetails");
    if (!panel) return;
    panel.innerHTML = details();
    document.getElementById("streakOpenLog")?.addEventListener("click", () => host.openLog(selectedDate));
  }

  function selectDay(date) {
    const day = data.days.find(item => item.date === date && !item.isFuture);
    if (!day) return;
    selectedDate = date;
    document.querySelectorAll("[data-study-date]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.studyDate === date)));
    drawDetails();
    document.getElementById("streakSelectionStatus").textContent = dateLabel(date) + ": " + duration(day.minutes) + " study. Day details updated.";
  }

  function draw() {
    const root = document.getElementById("studyStreakRoot");
    if (!root || !visible()) return;
    root.innerHTML = `${summaryCards()}
      <div class="streak-layout">
        <section class="streak-calendar-card" aria-labelledby="streakCalendarTitle">
          <div class="streak-calendar-heading"><div><p class="streak-eyebrow">EVERY DAY TELLS A STORY</p><h2 id="streakCalendarTitle">${dateLabel(month + "-01", { month: "long", year: "numeric" })}</h2><p>Tap a day to see your study breakdown.</p></div><span class="streak-calendar-mark" aria-hidden="true">${icons.calendar}</span></div>
          ${selectors()}
          <div class="streak-weekdays" aria-hidden="true">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => "<span>" + day + "</span>").join("")}</div>
          <div class="streak-calendar-days" role="group" aria-label="Study dates for ${dateLabel(month + "-01", { month: "long", year: "numeric" })}">${calendarCells()}</div>
          <div class="streak-legend" aria-label="Study time color legend"><span><i class="streak-level-0"></i>No study</span><span><i class="streak-level-1"></i>1–59 min</span><span><i class="streak-level-2"></i>1h–2h 59m</span><span><i class="streak-level-3"></i>3h or more</span></div>
          <p class="streak-calendar-note">A highlighted date is selected. The gold dot marks today; dashed dates are upcoming.</p>
        </section>
        <aside class="streak-detail-card" id="streakDetails" aria-label="Selected day study details"></aside>
      </div>
      <section class="streak-rules"><span class="streak-rules-icon" aria-hidden="true">${icons.flame}</span><div><h2>One minute is a start.</h2><p>At least 1 minute of study makes a study day. Consecutive study days build your streak. Today stays open until midnight; a complete day without study ends the run. Current and longest streaks use your full history.</p><small>Dates follow ${escape(data.timeZone)}. Calendar colors show recorded study time.</small></div></section>
      <p id="streakSelectionStatus" class="streak-sr-only" role="status"></p>`;
    drawDetails();
    root.querySelectorAll("[data-study-date]").forEach(button => {
      button.addEventListener("click", () => selectDay(button.dataset.studyDate));
      button.addEventListener("keydown", event => {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (step === undefined) return;
        event.preventDefault();
        const index = data.days.findIndex(day => day.date === button.dataset.studyDate), next = data.days[index + step];
        if (next && !next.isFuture) root.querySelector('[data-study-date="' + next.date + '"]')?.focus();
      });
    });
    root.querySelectorAll("[data-streak-month-step]").forEach(button => button.addEventListener("click", () => {
      const next = new Date(month + "-01T00:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + Number(button.dataset.streakMonthStep));
      month = next.toISOString().slice(0, 7); selectedDate = null; loadMonth();
    }));
    const changeMonth = () => {
      month = document.getElementById("streakYear").value + "-" + document.getElementById("streakMonth").value;
      selectedDate = null; loadMonth();
    };
    document.getElementById("streakMonth").addEventListener("change", changeMonth);
    document.getElementById("streakYear").addEventListener("change", changeMonth);
    document.getElementById("streakToday").addEventListener("click", () => { month = null; selectedDate = null; loadMonth(); });
  }

  async function loadMonth() {
    if (!visible()) return;
    const root = document.getElementById("studyStreakRoot");
    if (!root) return;
    const version = ++requestId, identity = owner;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const focusTarget = focused?.id || null, focusedDate = focused?.dataset.studyDate || null;
    const focusedStep = focused?.dataset.streakMonthStep || null;
    pending = true; root.setAttribute("aria-busy", "true");
    root.innerHTML = '<div class="streak-loading" role="status"><span class="streak-loading-mark" aria-hidden="true">' + icons.calendar + '</span><p>Loading your study history…</p></div>';
    try {
      const result = await host.request("/api/study-streak" + (month ? "?month=" + encodeURIComponent(month) : ""));
      if (identity !== owner || version !== requestId || !visible() || !root.isConnected) return;
      data = result; month = result.month;
      if (!data.days.some(day => day.date === selectedDate && !day.isFuture)) {
        selectedDate = data.days.find(day => day.isToday)?.date
          || [...data.days].reverse().find(day => day.minutes > 0)?.date
          || [...data.days].reverse().find(day => !day.isFuture)?.date || null;
      }
      draw();
      if (focusedDate) root.querySelector('[data-study-date="' + focusedDate + '"]')?.focus();
      else if (focusTarget) document.getElementById(focusTarget)?.focus();
      else if (focusedStep) root.querySelector('[data-streak-month-step="' + focusedStep + '"]')?.focus();
    } catch (error) {
      if (identity !== owner || version !== requestId || !visible() || !root.isConnected) return;
      root.innerHTML = '<div class="streak-loading streak-load-error" role="alert"><h2>Could not load your study history</h2><p>' + escape(error.message) + '</p><button type="button" class="streak-log-link" id="streakRetry">Try again</button></div>';
      document.getElementById("streakRetry").addEventListener("click", loadMonth);
    } finally {
      if (version === requestId) {
        pending = false; root.removeAttribute("aria-busy");
        if (refreshQueued) { refreshQueued = false; refresh(); }
      }
    }
  }

  async function render(options) {
    if (owner !== options.userId) { disconnect(); owner = options.userId; }
    host = options;
    document.getElementById("content").innerHTML = `<div class="streak-page-heading"><div><p class="streak-eyebrow">A LITTLE, EVERY DAY</p><h1>Study streak</h1><p>Your progress, one day at a time.</p></div><span class="streak-hero-icon" aria-hidden="true">${icons.flame}</span></div><div id="studyStreakRoot"></div>`;
    if (!dayWatcher) dayWatcher = setInterval(() => {
      if (!visible() || !data || pending || document.visibilityState !== "visible") return;
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: data.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
      if (parts.year + "-" + parts.month + "-" + parts.day !== data.today) loadMonth();
    }, 60000);
    await loadMonth();
  }

  function refresh() {
    if (!visible()) return;
    if (pending) { refreshQueued = true; return; }
    return loadMonth();
  }
  function disconnect() {
    clearInterval(dayWatcher); dayWatcher = null; requestId++;
    host = null; owner = null; month = null; selectedDate = null; data = null; pending = false; refreshQueued = false;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  window.addEventListener("online", refresh);
  return { render, refresh, disconnect };
})();
