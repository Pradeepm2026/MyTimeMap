"use strict";

window.WeeklyInsights = (() => {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const duration = minutes => Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m";
  const dateLabel = (date, options = { day: "numeric", month: "short", year: "numeric" }) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(date + "T00:00:00Z"));
  const rangeLabel = (start, end) => start === end ? dateLabel(start) : dateLabel(start) + " – " + dateLabel(end);
  const icon = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const icons = {
    study: icon('<path d="M3 5.5C6 4.5 9 5 12 7c3-2 6-2.5 9-1.5v14c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5Z"/><path d="M12 7v14"/>'),
    mobile: icon('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10 5h4M11 18.5h2"/>'),
    best: icon('<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>')
  };

  function metricCard(metric, kind, insights) {
    const title = kind === "study" ? "Study time" : "Mobile time";
    const comparable = metric.availability === "ready";
    const improved = comparable && (kind === "study" ? metric.delta > 0 : metric.delta < 0);
    const tone = comparable && metric.delta ? improved ? "positive" : "attention" : "neutral";
    const arrow = metric.direction === "up" ? "↑" : metric.direction === "down" ? "↓" : "=";
    let headline = "—", detail, badge = "Awaiting entries";

    if (insights.isFutureWeek) detail = "This week has not started yet.";
    else if (comparable) {
      headline = (metric.delta > 0 ? "+" : metric.delta < 0 ? "−" : "") + duration(Math.abs(metric.delta));
      detail = metric.delta === 0 ? "Same recorded time as the previous period."
        : kind === "study" ? (metric.delta > 0 ? "More study time logged than the previous period." : "Less study time logged than the previous period.")
        : metric.delta < 0 ? "Less mobile time logged than the previous period." : "More mobile time logged than the previous period.";
      badge = metric.percent !== null
        ? arrow + " " + (metric.delta !== 0 && metric.percent === 0 ? "&lt;0.1" : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(Math.abs(metric.percent))) + "%"
        : metric.delta === 0 ? "No change" : "Previous total: 0";
    } else if (metric.availability === "missing-previous") {
      headline = duration(metric.current);
      detail = "No " + title.toLowerCase() + " entries in the previous period to compare.";
      badge = "Recorded so far";
    } else {
      detail = "Log " + title.toLowerCase() + " for the selected week to see your change.";
    }

    const maximum = Math.max(1, metric.current, metric.previous);
    const row = (label, value, logged, className) => `<div class="insight-compare-row"><span>${label}</span><div class="insight-bar-track" aria-hidden="true"><i class="${className}" style="width:${value / maximum * 100}%"></i></div><strong>${logged ? duration(value) : "No entries"}</strong></div>`;
    const coverage = insights.comparedDays
      ? `${metric.currentLoggedDays}/${insights.comparedDays} days with entries · Previous: ${metric.previousLoggedDays}/${insights.comparedDays}`
      : "Select the current week or an earlier week.";
    const partial = comparable && (metric.currentLoggedDays < insights.comparedDays || metric.previousLoggedDays < insights.comparedDays);

    return `<article class="insight-card insight-${kind}">
      <div class="insight-card-heading"><span class="insight-icon">${icons[kind]}</span><h4>${title}</h4><span class="insight-trend insight-trend-${tone}">${badge}</span></div>
      <p class="insight-value">${headline}</p><p class="insight-detail">${detail}</p>
      <div class="insight-comparison">${row("Selected", metric.current, metric.currentLoggedDays, "insight-bar-current")}${row("Previous", metric.previous, metric.previousLoggedDays, "insight-bar-previous")}</div>
      <p class="insight-coverage">${partial ? '<strong>Partial data</strong> · ' : ""}${coverage}</p>
    </article>`;
  }

  function bestDayCard(insights) {
    const best = insights.bestDay, tied = (best?.dates.length || 0) > 1;
    const headline = best ? tied ? best.dates.length + " days tied" : dateLabel(best.dates[0], { weekday: "long" }) : "Your day awaits";
    const dates = best ? best.dates.map(date => dateLabel(date, { day: "numeric", month: "short" })).join(" · ") : "Based on recorded study time";
    const maximum = Math.max(1, best?.minutes || 0);
    const bars = insights.rhythm.map(day => {
      const winner = best?.dates.includes(day.date), weekday = dateLabel(day.date, { weekday: "short" });
      const description = dateLabel(day.date) + ": " + (!day.included ? "Not included yet" : !day.logged ? "No study entry" : duration(day.study) + " study") + (winner ? ", highest study time" : "");
      return `<div class="insight-day ${winner ? "is-best" : ""} ${day.included ? "" : "is-future"}" role="listitem" aria-label="${escape(description)}" title="${escape(description)}"><div class="insight-day-track" aria-hidden="true"><i style="height:${day.study / maximum * 100}%"></i></div><span aria-hidden="true">${weekday}</span></div>`;
    }).join("");
    return `<article class="insight-card insight-best">
      <div class="insight-card-heading"><span class="insight-icon">${icons.best}</span><h4>Most productive day</h4></div>
      <p class="insight-value insight-day-value">${headline}</p><p class="insight-best-dates">${dates}</p>
      <p class="insight-best-total">${best ? '<strong>' + duration(best.minutes) + '</strong> ' + (tied ? "study on each day" : "of focused study") : insights.isFutureWeek ? "This week has not started yet." : "Your first study entry will appear here."}</p>
      <div class="insight-week-rhythm" role="list" aria-label="Daily study time for the selected week">${bars}</div>
      <p class="insight-coverage">${best ? "Highest recorded study time" + (insights.isCurrentWeek ? " so far this week." : " in the selected week.") : "Every study session is a step forward."}</p>
    </article>`;
  }

  function render(insights) {
    if (!insights) return "";
    const currentRange = rangeLabel(insights.current.start, insights.current.comparedEnd || insights.current.end);
    const previousRange = rangeLabel(insights.previous.start, insights.previous.comparedEnd || insights.previous.end);
    const status = insights.isFutureWeek ? "Upcoming week" : insights.isCurrentWeek ? "Week in progress" : "Full week";
    const explanation = insights.isFutureWeek ? "Insights will appear once this week starts."
      : insights.isCurrentWeek ? "Comparing the same weekdays, through today. Today’s entries may still be incomplete."
      : "Comparing Monday–Sunday with the previous Monday–Sunday.";
    return `<section class="weekly-insights" aria-labelledby="weeklyInsightsTitle">
      <div class="weekly-insights-heading"><div><p class="insights-eyebrow">YOUR WEEK, IN PERSPECTIVE</p><h3 id="weeklyInsightsTitle">Weekly insights</h3></div><span class="insights-period-badge">${status}</span></div>
      <p class="insights-date-range"><strong>${currentRange}</strong><span>vs</span>${previousRange}</p>
      <p class="insights-context">${explanation}</p>
      <div class="weekly-insights-grid">${metricCard(insights.study, "study", insights)}${metricCard(insights.mobile, "mobile", insights)}${bestDayCard(insights)}</div>
      <p class="insights-footnote">Based on Daily Log entries, including completed focus sessions. Missing entries are not counted as confirmed zero time.</p>
    </section>`;
  }

  return { render };
})();
