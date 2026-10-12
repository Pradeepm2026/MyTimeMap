# Focus timer

Open **Focus timer** in the sidebar. Choose a study subject, set a duration, and start.

- Defaults: 25-minute focus, 5-minute short break, and 15-minute long break.
- Focus duration can be 1–180 minutes; breaks can be 1–60 minutes.
- Pause keeps the remaining time. Resume continues from that point.
- Reset discards an unfinished session after an inline confirmation.
- A completed focus session adds its full duration to the selected subject's Daily Log. Existing time and notes are preserved. Breaks never add study time.
- Entries use the session's completion date in `APP_TIME_ZONE` (default `Asia/Kolkata`). A session crossing midnight is credited to the day it finishes.
- The app suggests a short break after focus and a long break after every four focus sessions completed that day. Each next session starts when you press Start.

The running session and its server deadline persist in MongoDB's `focusTimers` collection, or the local development JSON store. Refreshing, switching pages, or signing in again restores it. If the page is closed or offline when time expires, the next successful sync records the original completion time. Sound requires an open browser page that allows audio.

Completion records are stored in each log's `focusSessions` list together with the study-time increment. Retries and concurrent browser tabs cannot log the same session twice. Only one timer is active per account; stale tab actions are rejected and refreshed.

No extra environment variables or packages are required. The existing MongoDB database user needs write access to the app database, including the new `focusTimers` collection.

Run `npm test` for the timer state and isolated API integration checks. Tests use temporary local data and do not connect to the configured MongoDB database.
