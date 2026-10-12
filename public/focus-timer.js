"use strict";

window.FocusTimer = (() => {
  const defaults = { focus: 25, short: 5, long: 15 };
  const titles = { focus: "Focus", short: "Short break", long: "Long break" };
  let host = null, owner = null, data = null, interval = null, pending = false;
  let mode = "focus", durations = { ...defaults }, subject = "", error = "", offset = 0;
  let lastSync = 0, lastApplied = null, sound = true, audio = null;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const clock = ms => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0"); };
  const current = () => data?.session;
  const active = () => current() && current().status !== "completed";
  const key = suffix => "mytimemap.focus." + owner + "." + suffix;
  function stored(suffix) { try { return JSON.parse(localStorage.getItem(key(suffix))); } catch { return null; } }
  function store(suffix, value) { try { localStorage.setItem(key(suffix), JSON.stringify(value)); } catch { /* Server keeps the running session even without browser storage. */ } }
  function savePreferences() { store("preferences", { mode, durations, subject, sound }); }
  function remaining() {
    const session = current();
    if (!active()) return durations[mode] * 60000;
    return session.status === "running" ? Math.max(0, session.endsAt - (Date.now() + offset)) : session.remainingMs;
  }
  function announceCompletion(session) {
    if (session.status !== "completed" || lastApplied === session.id) return;
    lastApplied = session.id;
    if (session.mode === "focus") host.onLogged(session);
    if (stored("announced") === session.id) return;
    store("announced", session.id);
    mode = session.mode === "focus" ? (data.summary.sessions % 4 === 0 ? "long" : "short") : "focus";
    savePreferences();
    host.toast(session.mode === "focus" ? session.minutes + (session.minutes === 1 ? " minute" : " minutes") + " added to " + session.activityName + ". Time for a break." : "Break complete. Ready for another focus session?");
    if (sound && audio?.state === "running") {
      try {
        const tone = audio.createOscillator(), gain = audio.createGain();
        tone.connect(gain); gain.connect(audio.destination); tone.frequency.value = 660;
        gain.gain.setValueAtTime(0.08, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6);
        tone.start(); tone.stop(audio.currentTime + 0.6);
      } catch { /* Sound is optional. */ }
    }
  }
  function receive(next) {
    const previous = data, previousError = error;
    data = next; offset = next.serverNow - Date.now(); error = next.warning || "";
    if (current()) {
      if (active()) mode = current().mode;
      if (active() && current().activityId) subject = current().activityId;
      announceCompletion(current());
    }
    if (!previous || previous.version !== next.version || JSON.stringify(previous.summary) !== JSON.stringify(next.summary) || previousError !== error || error) drawView();
    tick();
  }
  async function sync() {
    if (!owner || pending) return;
    const identity = owner; pending = true; lastSync = Date.now();
    try {
      const response = await host.request("/api/focus");
      if (identity === owner) receive(response);
    } catch (failure) {
      if (identity === owner) { error = failure.message; drawView(); }
    } finally { if (identity === owner) { pending = false; updateControls(); } }
  }
  async function action(name) {
    if (!owner || pending || !data) return;
    if (name === "start" && mode === "focus" && !subject) return;
    if (name === "start") {
      const input = document.getElementById("focusDuration");
      if (input && !input.reportValidity()) return;
      if (input) durations[mode] = Number(input.value);
      savePreferences();
    }
    const identity = owner, payload = { action: name, version: data.version };
    if (name === "start") Object.assign(payload, { mode, minutes: durations[mode], activityId: subject });
    if (sound && name === "start") {
      try { const Audio = window.AudioContext || window.webkitAudioContext; audio ||= new Audio(); audio.resume().catch(() => {}); } catch { /* Timer works when audio is unavailable. */ }
    }
    pending = true; error = ""; updateControls();
    try {
      const response = await host.request("/api/focus", { method: "POST", body: JSON.stringify(payload) });
      if (identity === owner) { receive(response); store("changed", Date.now()); drawView(); }
    } catch (failure) {
      if (identity === owner) { error = failure.message; drawView(); }
    } finally {
      if (identity === owner) { pending = false; lastSync = Date.now(); updateControls(); if (error) setTimeout(sync, 1500); }
    }
  }
  function updateControls() {
    const button = document.getElementById("focusPrimary");
    if (button) {
      const session = current(), status = session?.status;
      const saving = status === "saving" || (status === "running" && remaining() <= 0);
      button.disabled = pending || !data || saving || (!active() && mode === "focus" && !subject);
      button.textContent = pending ? "Syncing…" : saving ? "Saving session…" : status === "running" ? "Ⅱ  Pause" : status === "paused" ? "▶  Resume" : mode === "focus" ? "▶  Start focus" : "▶  Start break";
    }
    document.querySelectorAll("[data-focus-mode], #focusSubject, #focusDuration").forEach(element => { element.disabled = !!active() || pending || !data; });
    const reset = document.getElementById("focusReset");
    if (reset) reset.disabled = pending || !active() || current()?.status === "saving" || remaining() <= 0;
  }
  function tick() {
    if (!owner) return;
    const ms = remaining(), text = clock(ms), running = !!active();
    const display = document.getElementById("focusClock");
    if (display) display.textContent = text;
    const ring = document.getElementById("focusProgress");
    if (ring) { const total = (active() ? current().minutes : durations[mode]) * 60000; ring.style.strokeDashoffset = String(691.15 * (1 - Math.max(0, Math.min(1, ms / total)))); }
    const mini = document.getElementById("focusMini");
    if (mini) { mini.classList.toggle("hidden", !running || host.page() === "focus"); mini.textContent = (current()?.status === "paused" ? "Ⅱ " : "◷ ") + text + " · " + titles[current()?.mode]; }
    const badge = document.getElementById("focusNavBadge");
    if (badge) { badge.textContent = running ? text : ""; badge.classList.toggle("hidden", !running); }
    document.title = running ? text + " · " + titles[current().mode] + " | MyTimeMap" : "MyTimeMap — your time, clearly";
    const expired = running && (current().status === "saving" || (current().status === "running" && ms <= 0));
    if (!pending && ((expired && Date.now() - lastSync > 5000) || ((running || host.page() === "focus") && document.visibilityState === "visible" && Date.now() - lastSync > 30000))) sync();
    updateControls();
  }
  function drawView() {
    if (!owner || host.page() !== "focus") return;
    const root = document.getElementById("focusRoot");
    if (!root) return;
    const session = current(), engaged = !!active(), visibleMode = engaged ? session.mode : mode;
    const subjects = host.activities().filter(item => item.group === "Study" && item.active !== false);
    if (!engaged && !subjects.some(item => item.id === subject)) subject = subjects[0]?.id || "";
    const summary = data?.summary || { sessions: 0, minutes: 0, recent: [] };
    const options = subjects.map(item => '<option value="' + escape(item.id) + '"' + (item.id === subject ? " selected" : "") + '>' + escape(item.name) + '</option>').join("");
    const status = !data ? "Connecting to your timer…" : session?.status === "paused" ? "Paused · take your time" : session?.status === "saving" ? "Saving to your Daily Log" : engaged ? (visibleMode === "focus" ? "One thing at a time." : "Breathe. Stretch. Recharge.") : "A little focus goes a long way.";
    const completed = session?.status === "completed" && session.mode === "focus";
    root.innerHTML = `
      <div class="focus-layout">
        <section class="focus-card ${visibleMode === "focus" ? "" : "focus-break"}" aria-label="Pomodoro timer">
          <div class="focus-card-top"><span class="focus-label">${visibleMode === "focus" ? "YOUR FOCUS SPACE" : "A MOMENT TO RESET"}</span><button type="button" class="focus-sound" id="focusSound" aria-pressed="${sound}" aria-label="${sound ? "Mute completion sound" : "Enable completion sound"}">${sound ? "♪ Sound on" : "♪ Sound off"}</button></div>
          <div class="focus-modes" role="group" aria-label="Timer mode">${Object.entries(titles).map(([value, title]) => `<button type="button" data-focus-mode="${value}" aria-pressed="${visibleMode === value}" class="${visibleMode === value ? "selected" : ""}">${title}</button>`).join("")}</div>
          <div class="focus-dial"><svg viewBox="0 0 260 260" aria-hidden="true"><circle class="focus-track" cx="130" cy="130" r="110"/><circle id="focusProgress" class="focus-progress" cx="130" cy="130" r="110"/></svg><div class="focus-dial-copy"><span class="focus-dial-label">${escape(engaged ? session.mode === "focus" ? session.activityName : titles[visibleMode] : titles[visibleMode])}</span><strong id="focusClock" role="timer" aria-live="off">${clock(remaining())}</strong><span id="focusStatus">${status}</span></div></div>
          <div class="focus-settings"><label>Study subject<select id="focusSubject" aria-label="Study subject">${options || '<option value="">No study subjects yet</option>'}${engaged && session.activityId && !subjects.some(item => item.id === session.activityId) ? '<option selected value="' + escape(session.activityId) + '">' + escape(session.activityName) + ' (archived)</option>' : ""}</select></label><label>Duration <span>minutes</span><input id="focusDuration" aria-label="Session duration in minutes" type="number" required min="1" max="${visibleMode === "focus" ? 180 : 60}" step="1" value="${engaged ? session.minutes : durations[mode]}"></label></div>
          ${!subjects.length && !engaged ? '<p class="focus-empty-note">Add a study subject in <button type="button" id="focusAddSubject">My schedule</button> to start focusing.</p>' : ""}
          <div class="focus-actions"><button type="button" id="focusPrimary" class="focus-primary">Start focus</button><button type="button" id="focusReset" class="focus-reset">Reset</button></div>
          <div class="focus-reset-check hidden" id="focusResetCheck"><p>Discard this unfinished session? It will not be added to your log.</p><button type="button" id="focusDiscard">Discard session</button><button type="button" id="focusKeep">Keep timer</button></div>
          <p class="focus-error ${error ? "" : "hidden"}" role="alert">${escape(error)} <button type="button" id="focusRetry">Retry sync</button></p>
          <p class="focus-save-note">✓ Completed focus sessions are added to your Daily Log. Breaks are not logged.</p>
        </section>
        <aside class="focus-companion">
          <section class="focus-today"><p class="focus-label">TODAY’S FOCUS</p><h2>Small sessions.<br>Real progress.</h2><div class="focus-totals"><div><strong>${summary.sessions}</strong><span>Sessions finished</span></div><div><strong>${summary.minutes}<small> min</small></strong><span>Focused today</span></div></div><p>Your time goes to the selected subject, on the day the session finishes.</p></section>
          ${completed ? `<section class="focus-success" role="status"><span>✓</span><div><strong>${session.minutes} ${session.minutes === 1 ? "minute" : "minutes"} saved</strong><p>${escape(session.activityName)} · ${escape(session.date)}</p><button type="button" id="focusViewLog">View Daily Log →</button></div></section>` : ""}
          <section class="focus-recent"><h2>Finished today</h2>${summary.recent.length ? '<ol>' + summary.recent.map(item => `<li><span class="focus-recent-mark">✓</span><div><strong>${escape(item.activityName)}</strong><small>${escape(new Date(item.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small></div><b>${item.minutes} min</b></li>`).join("") + '</ol>' : '<div class="focus-empty"><span>◷</span><p>Your first session starts here.</p><small>Choose a subject, settle in, and press Start.</small></div>'}</section>
          <p class="focus-rhythm">25 min focus <span>→</span> 5 min break<br><small>After four sessions, try a longer break.</small></p>
        </aside>
      </div>`;
    root.querySelectorAll("[data-focus-mode]").forEach(button => button.addEventListener("click", () => { mode = button.dataset.focusMode; savePreferences(); drawView(); }));
    document.getElementById("focusSubject").onchange = event => { subject = event.target.value; savePreferences(); updateControls(); };
    document.getElementById("focusDuration").oninput = event => {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && event.target.checkValidity()) { durations[mode] = value; savePreferences(); tick(); }
    };
    document.getElementById("focusDuration").onchange = event => {
      const input = event.target, value = Number(input.value);
      if (!Number.isInteger(value) || !input.checkValidity()) { input.value = durations[mode]; return; }
      durations[mode] = value; savePreferences(); tick();
    };
    document.getElementById("focusPrimary").onclick = () => action(current()?.status === "running" ? "pause" : current()?.status === "paused" ? "resume" : "start");
    document.getElementById("focusReset").onclick = () => document.getElementById("focusResetCheck").classList.remove("hidden");
    document.getElementById("focusDiscard").onclick = () => action("reset");
    document.getElementById("focusKeep").onclick = () => document.getElementById("focusResetCheck").classList.add("hidden");
    document.getElementById("focusRetry").onclick = sync;
    document.getElementById("focusSound").onclick = () => { sound = !sound; savePreferences(); drawView(); };
    document.getElementById("focusAddSubject")?.addEventListener("click", () => host.navigate("schedule"));
    document.getElementById("focusViewLog")?.addEventListener("click", () => host.openLog(session.date));
    tick();
  }
  function connect(options) {
    disconnect(); host = options; owner = options.userId;
    const saved = stored("preferences");
    durations = { ...defaults };
    for (const kind of Object.keys(defaults)) if (Number.isInteger(saved?.durations?.[kind]) && saved.durations[kind] >= 1 && saved.durations[kind] <= (kind === "focus" ? 180 : 60)) durations[kind] = saved.durations[kind];
    mode = Object.hasOwn(defaults, saved?.mode) ? saved.mode : "focus";
    subject = typeof saved?.subject === "string" ? saved.subject : ""; sound = saved?.sound !== false;
    sync(); interval = setInterval(tick, 250);
  }
  function disconnect() {
    clearInterval(interval); owner = null; data = null; pending = false; error = ""; lastApplied = null;
    document.getElementById("focusMini")?.classList.add("hidden");
    document.getElementById("focusNavBadge")?.classList.add("hidden");
    document.title = "MyTimeMap — your time, clearly";
  }
  function render() {
    document.getElementById("content").innerHTML = '<div class="page-heading focus-heading"><div><p class="eyebrow">LESS DISTRACTION. MORE INTENTION.</p><h1>Make room for focus.</h1><p>One subject. One session. A little closer to your goal.</p></div><span class="focus-heading-pill">◷ Pomodoro</span></div><div id="focusRoot"></div>';
    drawView(); sync();
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
  window.addEventListener("online", sync);
  window.addEventListener("storage", event => { if (owner && event.key === key("changed")) sync(); });
  return { connect, disconnect, render };
})();
