import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Play, Coffee, Square, Clock, Lock, ChevronDown, Plus, Trash2, Key,
  UserX, UserCheck, Download, Settings as SettingsIcon, Users as UsersIcon,
  BarChart3, Activity as ActivityIcon, CalendarRange, AlertTriangle,
  StickyNote, Tag, ShieldQuestion, Home, Info, X, Volume2, VolumeX, Zap, Timer, LogOut, ArrowLeft,
  Building2, RefreshCw, Check, LayoutGrid, Eye, EyeOff, Hash,
} from "lucide-react";

// Quick-pick statuses for the weekly schedule grid. "shift" isn't in this list — it's
// whatever template or free-text label the owner picks/types (a time, an account name, etc).
const SCHEDULE_STATUSES = {
  off: { label: "OFF", bg: "bg-orange-500", text: "text-white" },
  annual: { label: "Annual", bg: "bg-violet-900", text: "text-white" },
  training: { label: "Training", bg: "bg-blue-700", text: "text-white" },
  holiday: { label: "Holiday", bg: "bg-yellow-400", text: "text-neutral-900" },
};
const DEFAULT_ANNUAL_LEAVE_BALANCE = 21;

// Secret admin key — only for you (the builder). Visit the app with ?admin=THIS_VALUE
// in the URL to reach the hidden workspace-approval screen. Never share this string.
const ADMIN_SECRET = "8122000";

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
// Minimal CSV parser (handles quoted fields with commas inside) — good enough for a
// simple internal roster import, not meant to be a full RFC-4180 implementation.
function parseSimpleCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
// "8/9/2026" -> "2026-08-09"
function parseUSDateToKey(s) {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
}

// "14:30" -> "2:30 PM"
// Some sandboxed preview environments block localStorage access entirely (throwing on
// the property access itself, not just on read/write) — these never throw, just fail quietly.
function safeGetLocal(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function safeSetLocal(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {}
}
function safeRemoveLocal(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (e) {}
}

function fmtTime12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// A true "pick, don't type" time selector: tap the button, choose hour/minute/AM-PM from
// dropdown lists (never a free-text field), tap OK. Calls onConfirm with "HH:MM" (24h).
// Password field with a show/hide toggle, so people can double-check what they typed
// before creating a password (not just for logging in with one already memorized).
function PasswordInput({ value, onChange, placeholder, className = "", onKeyDown, autoFocus }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative flex-1">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full pr-9 ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function TimePickerButton({ value, onConfirm, label = "Pick a time", direction = "down" }) {
  const [open, setOpen] = useState(false);
  const [hour12, setHour12] = useState(9);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState("AM");

  const openPicker = () => {
    if (value) {
      const [h, m] = value.split(":").map(Number);
      setHour12(h % 12 === 0 ? 12 : h % 12);
      setMinute(m);
      setPeriod(h >= 12 ? "PM" : "AM");
    }
    setOpen(true);
  };

  const confirm = () => {
    let h24 = hour12 % 12;
    if (period === "PM") h24 += 12;
    const hhmm = `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    onConfirm(hhmm);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none hover:border-neutral-500"
      >
        <Clock size={13} className="text-neutral-500" />
        {value ? fmtTime12(value) : label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 left-0 bg-neutral-900 border border-neutral-700 rounded-xl p-3 shadow-xl w-56 ${direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <select value={hour12} onChange={(e) => setHour12(Number(e.target.value))} className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-100 outline-none">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span className="text-neutral-500">:</span>
              <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-100 outline-none">
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                ))}
              </select>
              <div className="flex bg-neutral-950 border border-neutral-700 rounded-lg p-0.5">
                <button type="button" onClick={() => setPeriod("AM")} className={`px-2 py-1 text-xs font-medium rounded-md ${period === "AM" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>AM</button>
                <button type="button" onClick={() => setPeriod("PM")} className={`px-2 py-1 text-xs font-medium rounded-md ${period === "PM" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>PM</button>
              </div>
            </div>
            <button type="button" onClick={confirm} className="w-full bg-neutral-100 text-neutral-900 text-xs font-semibold py-1.5 rounded-lg">
              OK
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// A true "pick, don't type" calendar selector: tap the button, a month grid opens, tap a day.
// Returns "YYYY-MM-DD" via onConfirm. Same interaction philosophy as TimePickerButton.
function DatePickerButton({ value, onConfirm, label = "Pick a date", direction = "down" }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value + "T12:00:00") : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const openPicker = () => {
    const d = value ? new Date(value + "T12:00:00") : new Date();
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen(true);
  };

  const pick = (day) => {
    const picked = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    onConfirm(todayKey(picked));
    setOpen(false);
  };

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayKey();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none hover:border-neutral-500"
      >
        <CalendarRange size={13} className="text-neutral-500" />
        {value ? fmtDateLabel(value) : label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 left-0 bg-neutral-900 border border-neutral-700 rounded-xl p-3 shadow-xl w-64 ${direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setViewMonth(new Date(year, month - 1, 1))} className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800">
                <ChevronDown size={14} className="rotate-90" />
              </button>
              <p className="text-xs font-medium text-neutral-200">{viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
              <button type="button" onClick={() => setViewMonth(new Date(year, month + 1, 1))} className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800">
                <ChevronDown size={14} className="-rotate-90" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
                <div key={i} className="text-center text-[9px] font-medium text-neutral-600">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const dStr = todayKey(new Date(year, month, day));
                const isSelected = dStr === value;
                const isToday = dStr === todayStr;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(day)}
                    className={`h-7 rounded-md text-xs font-medium ${
                      isSelected ? "bg-neutral-100 text-neutral-900" : isToday ? "bg-neutral-800 text-emerald-400" : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function fmtDateShort(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}
function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + "m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h + "h " + m + "m";
}
function fmtHours(ms) {
  return (ms / 3600000).toFixed(1) + "h";
}
// Sunday-start week (Sun → Sat), matching this team's actual roster. Used everywhere in the
// app a "current week" is needed — Schedule, Summary, and weekly totals all agree now.
function weekDatesSat(refDate = new Date()) {
  const d = new Date(refDate);
  const day = d.getDay(); // JS: Sunday = 0 already
  d.setDate(d.getDate() - day);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    dates.push(todayKey(dd));
  }
  return dates;
}

function monthDates(refDate = new Date()) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) dates.push(todayKey(new Date(year, month, d)));
  return dates;
}

const AVATAR_PALETTE = [
  { bg: "bg-rose-500/15", text: "text-rose-300" },
  { bg: "bg-amber-500/15", text: "text-amber-300" },
  { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  { bg: "bg-sky-500/15", text: "text-sky-300" },
  { bg: "bg-violet-500/15", text: "text-violet-300" },
  { bg: "bg-pink-500/15", text: "text-pink-300" },
  { bg: "bg-teal-500/15", text: "text-teal-300" },
  { bg: "bg-orange-500/15", text: "text-orange-300" },
];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// Live worked-time so far for a set of events, net of breaks, counting the currently open stretch up to `nowTs`.
function computeLiveWorkedMs(sortedEvents, nowTs) {
  let total = 0;
  let sessionStart = null;
  let breakStart = null;
  let status = "not_started";
  for (const ev of sortedEvents) {
    if (ev.type === "start") { sessionStart = ev.timestamp; status = "working"; }
    else if (ev.type === "break_start") { breakStart = ev.timestamp; status = "on_break"; }
    else if (ev.type === "break_end") {
      if (breakStart) total -= ev.timestamp - breakStart;
      breakStart = null;
      status = "working";
    } else if (ev.type === "end") {
      if (sessionStart) total += ev.timestamp - sessionStart;
      sessionStart = null;
      status = "finished";
    }
  }
  if (sessionStart && status === "working") total += nowTs - sessionStart;
  if (sessionStart && status === "on_break" && breakStart) total += breakStart - sessionStart;
  return Math.max(0, total);
}

// Gross elapsed time since Start, including break — this is what counts against the standard shift length,
// since the standard hours (e.g. 9h) already have the break budgeted inside them.
function computeLiveElapsedMs(sortedEvents, nowTs) {
  let total = 0;
  let sessionStart = null;
  let status = "not_started";
  for (const ev of sortedEvents) {
    if (ev.type === "start") { sessionStart = ev.timestamp; status = "working"; }
    else if (ev.type === "break_start") status = "on_break";
    else if (ev.type === "break_end") status = "working";
    else if (ev.type === "end") {
      if (sessionStart) total += ev.timestamp - sessionStart;
      sessionStart = null;
      status = "finished";
    }
  }
  if (sessionStart && (status === "working" || status === "on_break")) total += nowTs - sessionStart;
  return Math.max(0, total);
}

const REGULAR_TYPES = ["start", "break_start", "break_end", "meeting_start", "meeting_end", "task_start", "task_end", "end"];

// Groups one person's REGULAR-shift events into shifts, one per Start. A shift is attributed to the local
// calendar date its Start happened on — so a shift that runs past midnight (e.g. 5pm-2am) is reported
// entirely under the day it began, exactly like a real timesheet. There is no "reopening" anymore: once
// Finished, that shift is done — extra work goes through the separate Overtime flow instead.
function groupRegularShifts(sortedRegularEvents) {
  const shifts = [];
  let current = null;
  let openBreakStart = null;
  let openMeetingStart = null;
  let openTaskStart = null;
  for (const ev of sortedRegularEvents) {
    if (ev.type === "start") {
      current = { shiftDate: todayKey(new Date(ev.timestamp)), start: ev.timestamp, end: null, breakMs: 0, breaks: [], meetingMs: 0, meetings: [], taskMs: 0, tasks: [], forced: false, earlyLeave: false, earlyLeaveNote: "", events: [ev] };
      shifts.push(current);
      openBreakStart = null;
      openMeetingStart = null;
      openTaskStart = null;
    } else if (current) {
      current.events.push(ev);
      if (ev.type === "break_start") {
        openBreakStart = ev.timestamp;
      } else if (ev.type === "break_end") {
        if (openBreakStart) {
          const ms = ev.timestamp - openBreakStart;
          current.breakMs += ms;
          current.breaks.push(ms);
        }
        openBreakStart = null;
      } else if (ev.type === "meeting_start") {
        openMeetingStart = ev.timestamp;
      } else if (ev.type === "meeting_end") {
        if (openMeetingStart) {
          const ms = ev.timestamp - openMeetingStart;
          current.meetingMs += ms;
          current.meetings.push(ms);
        }
        openMeetingStart = null;
      } else if (ev.type === "task_start") {
        openTaskStart = ev.timestamp;
      } else if (ev.type === "task_end") {
        if (openTaskStart) {
          const ms = ev.timestamp - openTaskStart;
          current.taskMs += ms;
          current.tasks.push(ms);
        }
        openTaskStart = null;
      } else if (ev.type === "end") {
        current.end = ev.timestamp;
        current.forced = !!ev.forced;
        current.earlyLeave = !!ev.earlyLeave;
        current.earlyLeaveNote = ev.note || "";
      }
    }
  }
  return shifts;
}

// Timestamp the person's last regular shift actually ended (Finish), or null if they've never finished one,
// or if their latest shift is still open. Used to enforce a minimum rest period before the next shift can start.
function getLastShiftEndMs(personEvents) {
  const regular = personEvents.filter((e) => REGULAR_TYPES.includes(e.type)).sort((a, b) => a.timestamp - b.timestamp);
  const shifts = groupRegularShifts(regular);
  if (shifts.length === 0) return null;
  const last = shifts[shifts.length - 1];
  return last.end; // null if that shift is still open (rest requirement doesn't apply while working)
}

// Live status for the Agent page (or any person, e.g. the Users tab): looks at that person's most recent
// regular shift. If it's still open they're working/on break — correctly true even past midnight. If it's
// closed: same calendar date => stays "finished" for the rest of that day (use Overtime for more work); a
// different (older) date => treated as fully fresh, so a brand new shift can always start.
function computeRegularLiveState(personEvents, breakLimitMs, standardMs, nowTs) {
  const empty = { status: "not_started", activity: "available", breakLocked: false, openBreakStart: null, enriched: [], liveWorkedMs: 0, liveElapsedMs: 0, liveBreakMs: 0, totalBreakMsSoFar: 0, liveMeetingMs: 0, liveTaskMs: 0, currentMeetingMs: 0, currentTaskMs: 0, shiftDate: null, shiftStart: null };
  const regular = personEvents.filter((e) => REGULAR_TYPES.includes(e.type)).sort((a, b) => a.timestamp - b.timestamp);
  const shifts = groupRegularShifts(regular);
  const shift = shifts[shifts.length - 1];
  if (!shift || shift.end != null) return empty; // no shift yet, or the last one is already closed — fully fresh, start anytime

  let status = "working";
  // "activity" is purely a label layered on top of "working" — Meeting and Task are still normal,
  // counted work (same as Available), they never affect worked/elapsed time. Only Break pauses the clock.
  let activity = "available";
  let breakLocked = false;
  let openBreakStart = null;
  let openMeetingStart = null;
  let openTaskStart = null;
  let breakMsSoFar = 0; // cumulative completed break time this shift — the limit applies to the TOTAL, not any one session
  let meetingMsSoFar = 0;
  let taskMsSoFar = 0;
  const enriched = [];
  for (const ev of shift.events) {
    let overtime = false;
    if (ev.type === "start") {
      status = "working";
      activity = "available";
    } else if (ev.type === "break_start") {
      status = "on_break";
      openBreakStart = ev.timestamp;
    } else if (ev.type === "break_end") {
      status = "working";
      activity = "available";
      if (openBreakStart) {
        const dur = ev.timestamp - openBreakStart;
        breakMsSoFar += dur;
        if (breakMsSoFar > breakLimitMs) { breakLocked = true; overtime = true; }
      }
      openBreakStart = null;
    } else if (ev.type === "meeting_start") {
      activity = "meeting";
      openMeetingStart = ev.timestamp;
    } else if (ev.type === "meeting_end") {
      activity = "available";
      if (openMeetingStart) meetingMsSoFar += ev.timestamp - openMeetingStart;
      openMeetingStart = null;
    } else if (ev.type === "task_start") {
      activity = "task";
      openTaskStart = ev.timestamp;
    } else if (ev.type === "task_end") {
      activity = "available";
      if (openTaskStart) taskMsSoFar += ev.timestamp - openTaskStart;
      openTaskStart = null;
    }
    enriched.push({ ...ev, overtime });
  }

  const liveWorkedMs = computeLiveWorkedMs(shift.events, nowTs);
  const liveElapsedMs = computeLiveElapsedMs(shift.events, nowTs);
  const liveBreakMs = status === "on_break" && openBreakStart ? nowTs - openBreakStart : 0;
  // Cumulative totals across the whole shift (for the "this shift" stat cards / Report).
  const liveMeetingMs = meetingMsSoFar + (activity === "meeting" && openMeetingStart ? nowTs - openMeetingStart : 0);
  const liveTaskMs = taskMsSoFar + (activity === "task" && openTaskStart ? nowTs - openTaskStart : 0);
  // Just the current, still-running instance — like the "On break for X" counter, this resets every time
  // you start a new Meeting/Task rather than adding up previous ones from earlier in the shift.
  const currentMeetingMs = activity === "meeting" && openMeetingStart ? nowTs - openMeetingStart : 0;
  const currentTaskMs = activity === "task" && openTaskStart ? nowTs - openTaskStart : 0;
  // Cumulative break time so far, INCLUDING the still-open session if currently on break — this is what the
  // "over the limit" warning and the live-locked badge check against (total for the day, not this session alone).
  const totalBreakMsSoFar = breakMsSoFar + liveBreakMs;

  return { status, activity, breakLocked, openBreakStart, enriched, liveWorkedMs, liveElapsedMs, liveBreakMs, totalBreakMsSoFar, liveMeetingMs, liveTaskMs, currentMeetingMs, currentTaskMs, shiftDate: shift.shiftDate, shiftStart: shift.start };
}

// Historical per-date summary for the REGULAR shift only (Overtime-tab hours are added in separately at
// the call sites via otWorkedMsForDate, keeping the two concepts cleanly separate).
function computeDaySummary(events, dateStr, breakLimitMs, standardMs) {
  const byPerson = {};
  for (const ev of events) {
    if (!REGULAR_TYPES.includes(ev.type)) continue;
    if (!byPerson[ev.name]) byPerson[ev.name] = [];
    byPerson[ev.name].push(ev);
  }
  const result = {};
  for (const name in byPerson) {
    const sorted = byPerson[name].slice().sort((a, b) => a.timestamp - b.timestamp);
    const dayShifts = groupRegularShifts(sorted).filter((sh) => sh.shiftDate === dateStr);
    if (dayShifts.length === 0) continue;

    let workedMs = 0;
    let totalBreakMs = 0;
    let allBreaks = [];
    let totalMeetingMs = 0;
    let allMeetings = [];
    let totalTaskMs = 0;
    let allTasks = [];
    let allEvents = [];
    let anyOpen = false;
    let anyForced = false;
    let earlyLeaveNotes = [];
    let latestEnd = null;

    for (const sh of dayShifts) {
      allEvents.push(...sh.events);
      totalBreakMs += sh.breakMs;
      allBreaks.push(...sh.breaks);
      totalMeetingMs += sh.meetingMs;
      allMeetings.push(...sh.meetings);
      totalTaskMs += sh.taskMs;
      allTasks.push(...sh.tasks);
      if (sh.forced) anyForced = true;
      if (sh.earlyLeave) earlyLeaveNotes.push(sh.earlyLeaveNote);
      if (sh.end == null) {
        anyOpen = true;
      } else {
        workedMs += sh.end - sh.start - sh.breakMs;
        latestEnd = sh.end;
      }
    }
    // A shift is "over limit" when its TOTAL break time (all breaks that shift added together) exceeds the
    // limit — matching the live lock logic — not when any single break session alone was long enough.
    const overtimeBreakCount = dayShifts.filter((sh) => sh.breakMs > breakLimitMs).length;

    result[name] = {
      events: allEvents,
      start: dayShifts[0].start,
      end: anyOpen ? null : latestEnd,
      stillOpen: anyOpen,
      hasForcedClose: anyForced,
      hasEarlyLeave: earlyLeaveNotes.length > 0,
      earlyLeaveNote: earlyLeaveNotes.filter(Boolean).join(" · "),
      breaks: allBreaks,
      totalBreakMs,
      meetings: allMeetings,
      totalMeetingMs,
      tasks: allTasks,
      totalTaskMs,
      overtimeCount: overtimeBreakCount,
      workedMs,
      overtimeMs: 0, // regular shifts never generate overtime — that only ever comes from the separate Overtime tab
      shiftCount: dayShifts.length,
    };
  }
  return result;
}

// --- Separate Overtime tracking: its own Start/End, independent of the regular shift, but now gated by
// OWNER APPROVAL instead of a per-employee password. Anyone can start overtime once their regular shift
// isn't open; every session is visible to the owner, who approves or denies it (before, during, or after
// it runs). Only APPROVED time counts toward payroll totals anywhere in the app — pending and denied time
// is still shown for transparency, but never silently counted.
const OT_TYPES = ["ot_start", "ot_end"];
const OT_DECISION_TYPES = ["ot_approve", "ot_deny"];

// Groups one person's overtime events into blocks and attaches the latest approval decision (if any) found
// among that person's ot_approve/ot_deny events referencing each block's start event id.
function groupOtBlocks(personEvents) {
  const otEvents = personEvents.filter((e) => OT_TYPES.includes(e.type)).sort((a, b) => a.timestamp - b.timestamp);
  const decisions = personEvents.filter((e) => OT_DECISION_TYPES.includes(e.type));
  const blocks = [];
  let current = null;
  for (const ev of otEvents) {
    if (ev.type === "ot_start") {
      current = { id: ev.id, blockDate: todayKey(new Date(ev.timestamp)), start: ev.timestamp, end: null, reason: ev.reason || "", forced: false, events: [ev] };
      blocks.push(current);
    } else if (ev.type === "ot_end" && current) {
      current.end = ev.timestamp;
      current.forced = !!ev.forced;
      current.events.push(ev);
      current = null;
    }
  }
  for (const b of blocks) {
    const related = decisions.filter((d) => d.refId === b.id).sort((a, c) => a.timestamp - c.timestamp);
    const last = related[related.length - 1];
    b.status = last ? (last.type === "ot_approve" ? "approved" : "denied") : "pending";
    b.decisionNote = last?.note || "";
  }
  return blocks;
}

function computeOtLiveState(personEvents, nowTs) {
  const blocks = groupOtBlocks(personEvents);
  const last = blocks[blocks.length - 1];
  const active = !!last && last.end === null;
  const liveMs = active ? nowTs - last.start : 0;
  return { active, liveMs, blocks, activeBlock: active ? last : null };
}

// Only approved overtime counts toward the "official" total for a given date — this is what Report,
// Summary, and the weekly shift counts all use.
function otWorkedMsForDate(personEvents, dateStr) {
  const blocks = groupOtBlocks(personEvents);
  let total = 0;
  for (const b of blocks) {
    if (b.blockDate === dateStr && b.end && b.status === "approved") total += b.end - b.start;
  }
  return total;
}

// Pending (not yet reviewed) overtime for a date — shown separately so it's visible but never confused
// with confirmed, payroll-ready hours.
function otPendingMsForDate(personEvents, dateStr) {
  const blocks = groupOtBlocks(personEvents);
  let total = 0;
  for (const b of blocks) {
    if (b.blockDate === dateStr && b.end && b.status === "pending") total += b.end - b.start;
  }
  return total;
}

const COLOR = {
  emerald: { soft: "bg-emerald-500/10", text: "text-emerald-400" },
  amber: { soft: "bg-amber-500/10", text: "text-amber-400" },
  sky: { soft: "bg-sky-500/10", text: "text-sky-400" },
  violet: { soft: "bg-violet-500/10", text: "text-violet-400" },
  rose: { soft: "bg-rose-500/10", text: "text-rose-400" },
};
const STATUS_BADGE = {
  not_started: { label: "Not started", cls: "bg-neutral-800 text-neutral-400" },
  working: { label: "Working", cls: "bg-emerald-500/10 text-emerald-400" },
  on_break: { label: "On break", cls: "bg-amber-500/10 text-amber-400" },
  finished: { label: "Finished", cls: "bg-sky-500/10 text-sky-400" },
};
// Meeting and Task are both still just "working" underneath (same counted hours as Available) — this map
// only controls the label/color shown to the owner and teammates for what someone is doing right now.
const ACTIVITY_BADGE = {
  available: { label: "Available", cls: "bg-emerald-500/10 text-emerald-400" },
  meeting: { label: "In a meeting", cls: "bg-sky-500/10 text-sky-400" },
  task: { label: "On a task", cls: "bg-violet-500/10 text-violet-400" },
};
// Single source of truth for "what badge should we show this person" — folds status (not started / on
// break / finished) and, while working, the activity (Available / Meeting / Task) into one badge.
function personBadge(status, activity) {
  if (status === "working") return ACTIVITY_BADGE[activity] || ACTIVITY_BADGE.available;
  return STATUS_BADGE[status] || STATUS_BADGE.not_started;
}

const DEFAULT_SETTINGS = { breakLimitMinutes: 60, standardHours: 9, graceMinutes: 15, otCapHours: 5, otMaxHours: 3, minRestHours: 0, overviewRefreshSeconds: 10 };
const DEFAULT_AUTH = { ownerPassword: null, recoveryCode: null };

// Every Dashboard tab that can be individually granted to a non-owner Dashboard user.
const DASH_TABS = [
  { key: "overview", label: "Overview" },
  { key: "approvals", label: "Approvals" },
  { key: "users", label: "Users" },
  { key: "actions", label: "Actions" },
  { key: "report", label: "Report" },
  { key: "summary", label: "Summary" },
  { key: "schedule", label: "Schedule" },
  { key: "dailytask", label: "Daily Task" },
  { key: "settings", label: "Settings" },
  { key: "activity", label: "Activity" },
];
const EVENT_LABEL = {
  start: "Available",
  break_start: "Break",
  break_end: "Available (from break)",
  meeting_start: "Meeting",
  meeting_end: "Available (from meeting)",
  task_start: "Task",
  task_end: "Available (from task)",
  end: "Finish",
  ot_start: "OT Start",
  ot_end: "OT Finish",
  ot_approve: "OT Approved",
  ot_deny: "OT Denied",
};

function toFullLogCSV(events, includeWork, includeBreaks, includeOvertime) {
  const header = ["Name", "Event", "Date", "Time", "Note"];
  const rows = events
    .slice()
    .filter((e) => {
      const isBreakEvent = e.type === "break_start" || e.type === "break_end";
      const isOtEvent = OT_TYPES.includes(e.type) || OT_DECISION_TYPES.includes(e.type);
      if (isOtEvent) return includeOvertime;
      return isBreakEvent ? includeBreaks : includeWork;
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => [e.name, EVENT_LABEL[e.type] || e.type, todayKey(new Date(e.timestamp)), fmtTime(e.timestamp), e.reason || e.note || e.decisionNote || (e.byOwner ? "Forced by owner" : e.forced ? "Auto-closed" : "")]);
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
// One row per individual Meeting or Task instance (start→end), so the owner can see exactly how long
// each separate meeting/task lasted in a day — not just the daily total. Mirrors toOtSessionsCSV.
function toActivitySessionsCSV(events, dates) {
  const header = ["Name", "Date", "Type", "#", "Start", "End", "Duration"];
  const byPerson = {};
  for (const ev of events) {
    if (!["meeting_start", "meeting_end", "task_start", "task_end"].includes(ev.type)) continue;
    if (!byPerson[ev.name]) byPerson[ev.name] = [];
    byPerson[ev.name].push(ev);
  }
  const rows = [];
  for (const [name, personEvents] of Object.entries(byPerson)) {
    const sorted = personEvents.slice().sort((a, b) => a.timestamp - b.timestamp);
    let openMeeting = null;
    let openTask = null;
    const meetingIdxByDate = {};
    const taskIdxByDate = {};
    for (const ev of sorted) {
      if (ev.type === "meeting_start") {
        openMeeting = ev.timestamp;
      } else if (ev.type === "meeting_end" && openMeeting) {
        const sd = todayKey(new Date(openMeeting));
        meetingIdxByDate[sd] = (meetingIdxByDate[sd] || 0) + 1;
        if (dates.includes(sd)) rows.push([name, sd, "Meeting", meetingIdxByDate[sd], fmtTime(openMeeting), fmtTime(ev.timestamp), fmtDuration(ev.timestamp - openMeeting)]);
        openMeeting = null;
      } else if (ev.type === "task_start") {
        openTask = ev.timestamp;
      } else if (ev.type === "task_end" && openTask) {
        const sd = todayKey(new Date(openTask));
        taskIdxByDate[sd] = (taskIdxByDate[sd] || 0) + 1;
        if (dates.includes(sd)) rows.push([name, sd, "Task", taskIdxByDate[sd], fmtTime(openTask), fmtTime(ev.timestamp), fmtDuration(ev.timestamp - openTask)]);
        openTask = null;
      }
    }
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])) || Number(a[3]) - Number(b[3]));
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
// One row per overtime session (start→end), independent of the regular-shift summary — lets the owner pull
// overtime alone, with its reason and approval status, instead of digging it out of the raw event log.
function toOtSessionsCSV(events, dates) {
  const header = ["Name", "Date", "Start", "End", "Duration", "Reason", "Status", "Auto-closed"];
  const byPerson = {};
  for (const ev of events) {
    if (!OT_TYPES.includes(ev.type) && !OT_DECISION_TYPES.includes(ev.type)) continue;
    if (!byPerson[ev.name]) byPerson[ev.name] = [];
    byPerson[ev.name].push(ev);
  }
  const rows = [];
  for (const [name, personEvents] of Object.entries(byPerson)) {
    const blocks = groupOtBlocks(personEvents).filter((b) => dates.includes(b.blockDate));
    for (const b of blocks) {
      rows.push([
        name,
        b.blockDate,
        fmtTime(b.start),
        b.end ? fmtTime(b.end) : "",
        b.end ? fmtDuration(b.end - b.start) : "",
        b.reason || "",
        b.status,
        b.forced ? "Yes" : "",
      ]);
    }
  }
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
function toSummaryCSV(events, dates, breakLimitMs, standardMs, cols) {
  const header = ["Name", "Date"];
  if (cols.start) header.push("Available");
  if (cols.finish) header.push("Finish");
  if (cols.worked) header.push("Worked");
  if (cols.overtime) header.push("Overtime");
  if (cols.breaks) header.push("Breaks");
  if (cols.breakTime) header.push("Break time");
  if (cols.meetings) header.push("Meetings");
  if (cols.meetingTime) header.push("Meeting time");
  if (cols.tasks) header.push("Tasks");
  if (cols.taskTime) header.push("Task time");
  if (cols.overLimit) header.push("Over limit");
  if (cols.autoClosed) header.push("Auto-closed");
  if (cols.leftEarly) header.push("Left early reason");
  const rows = [];
  for (const d of dates) {
    const daySum = computeDaySummary(events, d, breakLimitMs, standardMs);
    for (const [name, s] of Object.entries(daySum)) {
      const personEvents = events.filter((e) => e.name === name);
      const ot = otWorkedMsForDate(personEvents, d);
      const totalOt = s.overtimeMs + ot;
      const row = [name, d];
      if (cols.start) row.push(s.start ? fmtTime(s.start) : "");
      if (cols.finish) row.push(s.end ? fmtTime(s.end) : "");
      if (cols.worked) row.push(s.workedMs != null ? fmtDuration(s.workedMs) : "");
      if (cols.overtime) row.push(totalOt > 0 ? fmtDuration(totalOt) : "");
      if (cols.breaks) row.push(s.breaks.length);
      if (cols.breakTime) row.push(fmtDuration(s.totalBreakMs));
      if (cols.meetings) row.push(s.meetings.length);
      if (cols.meetingTime) row.push(fmtDuration(s.totalMeetingMs));
      if (cols.tasks) row.push(s.tasks.length);
      if (cols.taskTime) row.push(fmtDuration(s.totalTaskMs));
      if (cols.overLimit) row.push(s.overtimeCount > 0 ? `x${s.overtimeCount}` : "");
      if (cols.autoClosed) row.push(s.hasForcedClose ? "Yes" : "");
      if (cols.leftEarly) row.push(s.hasEarlyLeave ? s.earlyLeaveNote || "Yes" : "");
      rows.push(row);
    }
  }
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
function downloadCSV(csv, filename) {
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// "Saved."/error confirmations should acknowledge the action, then get out of the way — a real app doesn't
// leave stray status text sitting on screen forever. This clears the message a few seconds after it's set.
function useAutoClearMsg(value, setter, delayMs = 2500) {
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setter(""), delayMs);
    return () => clearTimeout(t);
  }, [value, setter, delayMs]);
}

function Shiftly({ workspaceName, workspaceDisplayName, onSwitchWorkspace, onBackToChooser, initialTab = "track", lockTab = false }) {
  const wsKey = useCallback((base) => `ws:${workspaceName}:${base}`, [workspaceName]);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [users, setUsers] = useState({});
  const [dashboardUsers, setDashboardUsers] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [auth, setAuth] = useState(DEFAULT_AUTH);
  const [audit, setAudit] = useState([]);
  const [presence, setPresence] = useState({}); // { [name]: { lastConfirmedAt, lastMissedAt, missedToday, missedDate } }
  const [schedule, setSchedule] = useState({}); // { "name|dateStr": { kind: "status"|"shift", status?: "off"|"annual"|"training"|"holiday", label?: "8:00 AM" } } — the owner's working draft
  const [publishedSchedule, setPublishedSchedule] = useState(null); // what employees actually see — only updates when the owner hits "Publish" in Settings
  const [publishMsg, setPublishMsg] = useState("");
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState(false);
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  const [editingCell, setEditingCell] = useState(null); // "name|dateStr" or null
  const [cellTimeInput, setCellTimeInput] = useState("");
  const [cellSuffixInput, setCellSuffixInput] = useState("");
  const [dailyTasks, setDailyTasks] = useState([]); // [{ id, name, text, assignedAt, status: "pending"|"done", doneAt }] — one-off, assigned to a specific person
  const [recurringTasks, setRecurringTasks] = useState([]); // [{ id, time: "HH:MM" (24h), text, createdAt }] — auto-applies to whoever's shift starts at that time
  const [publicHolidays, setPublicHolidays] = useState([]); // ["2026-08-15", ...] — company-wide dates. Anyone scheduled to WORK on one auto-gets +1 annual leave day.
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [recurringCompletions, setRecurringCompletions] = useState([]); // [{ id, taskId, name, date, doneAt }]
  const [newRecurringTime, setNewRecurringTime] = useState("");
  const [newRecurringText, setNewRecurringText] = useState("");
  const [newTaskUser, setNewTaskUser] = useState("");
  const [newTaskText, setNewTaskText] = useState("");
  const [swapRequests, setSwapRequests] = useState([]); // [{ id, fromName, toName, date, status, requestedAt }]
  const [swapTargetName, setSwapTargetName] = useState("");
  const [myScheduleWeekOffset, setMyScheduleWeekOffset] = useState(0);
  const [swapForCell, setSwapForCell] = useState(null); // "name|dateStr" or null
  const [swapSecondDate, setSwapSecondDate] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const csvFileInputRef = useRef(null);

  const [tab, setTab] = useState(initialTab);
  const [trackView, setTrackView] = useState("shift"); // 'shift' | 'overtime'
  const [showEarlyFinishConfirm, setShowEarlyFinishConfirm] = useState(false);
  const [earlyFinishReason, setEarlyFinishReason] = useState("");

  const [myUser, setMyUser] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [otReasonInput, setOtReasonInput] = useState("");
  const [otCapHoursInput, setOtCapHoursInput] = useState(String(DEFAULT_SETTINGS.otCapHours));
  const [otCapHoursMsg, setOtCapHoursMsg] = useState("");
  const [otMaxHoursInput, setOtMaxHoursInput] = useState(String(DEFAULT_SETTINGS.otMaxHours));
  const [otMaxHoursMsg, setOtMaxHoursMsg] = useState("");

  const [role, setRole] = useState(null); // 'owner' | 'member' | null — derived from the logged-in dashboard user
  const [myDashUser, setMyDashUser] = useState(""); // logged-in dashboard username
  const [dashLoginName, setDashLoginName] = useState("");
  const [dashLoginPassword, setDashLoginPassword] = useState("");
  const [dashLoginError, setDashLoginError] = useState("");
  const [newDashUserId, setNewDashUserId] = useState("");
  const [newDashUserPassword, setNewDashUserPassword] = useState("");
  const [newDashUserPerms, setNewDashUserPerms] = useState({});
  const [editingDashPermsFor, setEditingDashPermsFor] = useState("");
  const [editingDashPwFor, setEditingDashPwFor] = useState("");
  const [dashPwEditValue, setDashPwEditValue] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [editingDashPerms, setEditingDashPerms] = useState({});
  const [usersSubTab, setUsersSubTab] = useState("agent"); // 'agent' | 'dashboard' — the two halves of the Users tab
  const [dashTab, setDashTab] = useState("overview");

  const [newUserName, setNewUserName] = useState("");
  const [newUserId, setNewUserId] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [dashError, setDashError] = useState("");
  useAutoClearMsg(dashError, setDashError, 4000);
  const [editingPwFor, setEditingPwFor] = useState("");
  const [pwEditValue, setPwEditValue] = useState("");
  const [editingNoteFor, setEditingNoteFor] = useState("");
  const [noteEditValue, setNoteEditValue] = useState("");
  const [editingTeamFor, setEditingTeamFor] = useState("");
  const [teamEditValue, setTeamEditValue] = useState("");
  const [editingLeaveFor, setEditingLeaveFor] = useState("");
  const [leaveEditValue, setLeaveEditValue] = useState("");
  const [editingIdFor, setEditingIdFor] = useState("");
  const [idEditValue, setIdEditValue] = useState("");
  const [approvalsSubTab, setApprovalsSubTab] = useState("pending"); // "pending" | "approved"
  const [confirmDeleteFor, setConfirmDeleteFor] = useState("");
  const [confirmPurgeFor, setConfirmPurgeFor] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");

  const [reportDate, setReportDate] = useState(todayKey());
  const [overviewDate, setOverviewDate] = useState(todayKey());
  const [lastRefreshedAt, setLastRefreshedAt] = useState(Date.now());
  const [breakLimitInput, setBreakLimitInput] = useState(String(DEFAULT_SETTINGS.breakLimitMinutes));
  const [breakLimitMsg, setBreakLimitMsg] = useState("");
  const [standardHoursInput, setStandardHoursInput] = useState(String(DEFAULT_SETTINGS.standardHours));
  const [standardHoursMsg, setStandardHoursMsg] = useState("");
  const [graceMinutesInput, setGraceMinutesInput] = useState(String(DEFAULT_SETTINGS.graceMinutes));
  const [graceMinutesMsg, setGraceMinutesMsg] = useState("");
  const [minRestHoursInput, setMinRestHoursInput] = useState(String(DEFAULT_SETTINGS.minRestHours));
  const [minRestHoursMsg, setMinRestHoursMsg] = useState("");
  const [overviewRefreshInput, setOverviewRefreshInput] = useState(String(DEFAULT_SETTINGS.overviewRefreshSeconds));
  const [overviewRefreshMsg, setOverviewRefreshMsg] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);

  const [changeOwnerNew, setChangeOwnerNew] = useState("");
  const [changeOwnerMsg, setChangeOwnerMsg] = useState("");

  // Every "Saved." / error confirmation in Settings clears itself a few seconds after it appears.
  useAutoClearMsg(publishMsg, setPublishMsg);
  useAutoClearMsg(importMsg, setImportMsg);
  useAutoClearMsg(otCapHoursMsg, setOtCapHoursMsg);
  useAutoClearMsg(otMaxHoursMsg, setOtMaxHoursMsg);
  useAutoClearMsg(breakLimitMsg, setBreakLimitMsg);
  useAutoClearMsg(standardHoursMsg, setStandardHoursMsg);
  useAutoClearMsg(graceMinutesMsg, setGraceMinutesMsg);
  useAutoClearMsg(minRestHoursMsg, setMinRestHoursMsg);
  useAutoClearMsg(overviewRefreshMsg, setOverviewRefreshMsg);
  useAutoClearMsg(changeOwnerMsg, setChangeOwnerMsg);

  const [summaryPeriod, setSummaryPeriod] = useState("week"); // 'week' | 'month'
  const [summarySortBy, setSummarySortBy] = useState("hours"); // 'hours' | 'name' | 'shifts'
  const [expandedSummaryPerson, setExpandedSummaryPerson] = useState("");

  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportDateFilter, setExportDateFilter] = useState("all");
  const [exportPersonFilter, setExportPersonFilter] = useState("all");
  const [exportMode, setExportMode] = useState("summary"); // 'summary' | 'full' | 'otSessions'
  const [exportCols, setExportCols] = useState({ start: true, finish: true, worked: true, overtime: true, breaks: true, breakTime: true, meetings: true, meetingTime: true, tasks: true, taskTime: true, overLimit: true, autoClosed: true, leftEarly: true });
  const [exportFullWork, setExportFullWork] = useState(true);
  const [exportFullBreaks, setExportFullBreaks] = useState(true);
  const [exportFullOvertime, setExportFullOvertime] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useAutoClearMsg(error, setError, 4000);
  const [expandedPerson, setExpandedPerson] = useState("");
  const [, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [showIntro, setShowIntro] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [toast, setToast] = useState(null); // { text }
  const toastTimerRef = useRef(null);
  const showToast = useCallback((text) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, key: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);
  const graceRef = useRef({ shiftDate: null, lastPingIndex: -1, snoozedAt: null, autoFinished: false });
  const otGraceRef = useRef({ blockId: null, lastPingIndex: -1, snoozedAt: null, autoFinished: false });
  const presenceRef = useRef({ shiftDate: null, nextCheckAt: null, promptShownAt: null });
  const [showPresenceCheck, setShowPresenceCheck] = useState(false);
  const [showReachedPrompt, setShowReachedPrompt] = useState(false);
  const [showOtReachedPrompt, setShowOtReachedPrompt] = useState(false);

  // Switching dashboard tabs should feel like landing on a fresh page — not leave an export panel expanded,
  // an edit box open, or a stale error/confirmation message behind from whatever tab you were just on.
  const handleTabChange = useCallback((key) => {
    setDashTab(key);
    setDashError("");
    setShowExportPanel(false);
    setExpandedPerson("");
    setExpandedSummaryPerson("");
    setEditingPwFor("");
    setPwEditValue("");
    setEditingNoteFor("");
    setNoteEditValue("");
    setEditingTeamFor("");
    setTeamEditValue("");
    setEditingLeaveFor("");
    setLeaveEditValue("");
    setEditingIdFor("");
    setIdEditValue("");
    setConfirmDeleteFor("");
    setConfirmPurgeFor("");
    setConfirmDeleteSchedule(false);
    setConfirmWipe(false);
    setEditingCell(null);
    setSwapForCell(null);
    setBreakLimitMsg("");
    setStandardHoursMsg("");
    setGraceMinutesMsg("");
    setMinRestHoursMsg("");
    setOverviewRefreshMsg("");
    setOtCapHoursMsg("");
    setOtMaxHoursMsg("");
    setChangeOwnerMsg("");
    setPublishMsg("");
    setImportMsg("");
    setUsersSubTab("agent");
    setEditingDashPermsFor("");
    setEditingDashPwFor("");
    setActivityFilter("");
    setNewDashUserPerms({});
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const evRes = await window.storage.get(wsKey("attendance-events"), true).catch(() => null);
      setEvents(evRes?.value ? JSON.parse(evRes.value) : []);
    } catch (e) {}
    try {
      const usersRes = await window.storage.get(wsKey("attendance-users"), true).catch(() => null);
      setUsers(usersRes?.value ? JSON.parse(usersRes.value) : {});
    } catch (e) {}
    try {
      const dashUsersRes = await window.storage.get(wsKey("attendance-dashboard-users"), true).catch(() => null);
      setDashboardUsers(dashUsersRes?.value ? JSON.parse(dashUsersRes.value) : {});
    } catch (e) {}
    try {
      const settingsRes = await window.storage.get(wsKey("attendance-settings"), true).catch(() => null);
      const s = settingsRes?.value ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRes.value) } : DEFAULT_SETTINGS;
      setSettings(s);
      setBreakLimitInput(String(s.breakLimitMinutes));
      setStandardHoursInput(String(s.standardHours));
      setGraceMinutesInput(String(s.graceMinutes));
      setOtCapHoursInput(String(s.otCapHours));
      setOtMaxHoursInput(String(s.otMaxHours));
      setMinRestHoursInput(String(s.minRestHours ?? 0));
      setOverviewRefreshInput(String(s.overviewRefreshSeconds ?? 10));
    } catch (e) {}
    try {
      const authRes = await window.storage.get(wsKey("attendance-auth"), true).catch(() => null);
      setAuth(authRes?.value ? { ...DEFAULT_AUTH, ...JSON.parse(authRes.value) } : DEFAULT_AUTH);
    } catch (e) {}
    try {
      const auditRes = await window.storage.get(wsKey("attendance-audit"), true).catch(() => null);
      setAudit(auditRes?.value ? JSON.parse(auditRes.value) : []);
    } catch (e) {}
    try {
      const presenceRes = await window.storage.get(wsKey("attendance-presence"), true).catch(() => null);
      setPresence(presenceRes?.value ? JSON.parse(presenceRes.value) : {});
    } catch (e) {}
    try {
      const scheduleRes = await window.storage.get(wsKey("attendance-schedule"), true).catch(() => null);
      setSchedule(scheduleRes?.value ? JSON.parse(scheduleRes.value) : {});
    } catch (e) {}
    try {
      const publishedRes = await window.storage.get(wsKey("attendance-schedule-published"), true).catch(() => null);
      setPublishedSchedule(publishedRes?.value ? JSON.parse(publishedRes.value) : {});
    } catch (e) {}
    try {
      const tasksRes = await window.storage.get(wsKey("attendance-daily-tasks"), true).catch(() => null);
      setDailyTasks(tasksRes?.value ? JSON.parse(tasksRes.value) : []);
    } catch (e) {}
    try {
      const recTasksRes = await window.storage.get(wsKey("attendance-recurring-tasks"), true).catch(() => null);
      setRecurringTasks(recTasksRes?.value ? JSON.parse(recTasksRes.value) : []);
    } catch (e) {}
    try {
      const holidaysRes = await window.storage.get(wsKey("attendance-public-holidays"), true).catch(() => null);
      setPublicHolidays(holidaysRes?.value ? JSON.parse(holidaysRes.value) : []);
    } catch (e) {}
    try {
      const recCompRes = await window.storage.get(wsKey("attendance-recurring-completions"), true).catch(() => null);
      setRecurringCompletions(recCompRes?.value ? JSON.parse(recCompRes.value) : []);
    } catch (e) {}
    try {
      const swapRes = await window.storage.get(wsKey("attendance-swap-requests"), true).catch(() => null);
      const rawSwaps = swapRes?.value ? JSON.parse(swapRes.value) : [];
      // Backward-compat: older requests stored a single "date" field instead of "dates".
      const normalizedSwaps = rawSwaps.map((r) => (Array.isArray(r.dates) ? r : { ...r, dates: r.date ? [r.date] : [] }));
      setSwapRequests(normalizedSwaps);
    } catch (e) {}
    setLastRefreshedAt(Date.now());
  }, [wsKey]);

  useEffect(() => {
    setDashError("");
  }, [dashTab]);

  useEffect(() => {
    (async () => {
      try {
        const myRes = await window.storage.get(wsKey("my-user"), false).catch(() => null);
        if (myRes?.value) setMyUser(myRes.value);
      } catch (e) {}
      try {
        const myDashRes = await window.storage.get(wsKey("my-dash-user"), false).catch(() => null);
        if (myDashRes?.value) setMyDashUser(myDashRes.value);
      } catch (e) {}
      await loadAll();
      setLoading(false);
    })();
  }, [loadAll]);

  useEffect(() => {
    const id = setInterval(() => {
      loadAll();
      setTick((t) => t + 1);
    }, 20000);
    return () => clearInterval(id);
  }, [loadAll]);

  // Overview is the page people leave open to watch who's working — refresh it faster than the rest of the app.
  // Configurable in Settings; 0 turns this extra refresh off (the app-wide 20s refresh above still applies).
  useEffect(() => {
    if (dashTab !== "overview") return;
    const secs = settings.overviewRefreshSeconds;
    if (!secs || secs <= 0) return;
    const id = setInterval(() => loadAll(), secs * 1000);
    return () => clearInterval(id);
  }, [dashTab, loadAll, settings.overviewRefreshSeconds]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!myUser) return;
    (async () => {
      try {
        const seen = await window.storage.get("seen-track-intro", false).catch(() => null);
        if (!seen?.value) setShowIntro(true);
      } catch (e) {
        setShowIntro(true);
      }
    })();
  }, [myUser]);

  const dismissIntro = async () => {
    setShowIntro(false);
    try {
      await window.storage.set("seen-track-intro", "1", false);
    } catch (e) {}
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("sound-muted", false).catch(() => null);
        if (res?.value === "1") setSoundMuted(true);
      } catch (e) {}
    })();
  }, []);

  const toggleSound = async () => {
    const next = !soundMuted;
    setSoundMuted(next);
    try {
      await window.storage.set("sound-muted", next ? "1" : "0", false);
    } catch (e) {}
  };

  const playTone = (freq, muted) => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch (e) {}
  };

  const playClickSound = (type) => {
    const freq = { start: 660, break_start: 520, break_end: 660, meeting_start: 600, meeting_end: 660, task_start: 580, task_end: 660, end: 440, ot_start: 740, ot_end: 440 }[type] || 600;
    playTone(freq, soundMuted);
  };

  const playAlarm = () => {
    if (soundMuted) return;
    playTone(880, false);
    setTimeout(() => playTone(880, false), 220);
    setTimeout(() => playTone(880, false), 440);
  };

  const addAudit = async (text) => {
    const entry = { id: Date.now() + "-" + Math.random().toString(36).slice(2), timestamp: Date.now(), text, actor: myDashUser || "" };
    const updated = [entry, ...audit].slice(0, 200);
    try {
      await window.storage.set(wsKey("attendance-audit"), JSON.stringify(updated), true);
      setAudit(updated);
    } catch (e) {}
  };

  const saveUsers = async (updated, auditText) => {
    try {
      const res = await window.storage.set(wsKey("attendance-users"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setUsers(updated);
      setDashError("");
      if (auditText) addAudit(auditText);
      return true;
    } catch (e) {
      setDashError("Could not save, try again.");
      return false;
    }
  };

  const saveDashboardUsers = async (updated, auditText) => {
    try {
      const res = await window.storage.set(wsKey("attendance-dashboard-users"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setDashboardUsers(updated);
      setDashError("");
      if (auditText) addAudit(auditText);
      return true;
    } catch (e) {
      setDashError("Could not save, try again.");
      return false;
    }
  };

  const saveSettings = async (updated, auditText) => {
    try {
      const res = await window.storage.set(wsKey("attendance-settings"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setSettings(updated);
      setDashError("");
      if (auditText) addAudit(auditText);
      return true;
    } catch (e) {
      setDashError("Could not save, try again.");
      return false;
    }
  };

  const saveAuth = async (updated, auditText) => {
    try {
      const res = await window.storage.set(wsKey("attendance-auth"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setAuth(updated);
      if (auditText) addAudit(auditText);
      return true;
    } catch (e) {
      return false;
    }
  };

  const handleLogin = async () => {
    setLoginError("");
    if (!loginName) { setLoginError("Choose your name."); return; }
    const record = users[loginName];
    if (!record) { setLoginError("That user no longer exists."); return; }
    if (record.password !== loginPassword) { setLoginError("Wrong password."); return; }
    if (record.locked) { setLoginError("Your access is locked. Contact your manager."); return; }
    try {
      await window.storage.set(wsKey("my-user"), loginName, false);
      setMyUser(loginName);
      setLoginPassword("");
    } catch (e) {
      setLoginError("Could not log in, try again.");
    }
  };

  const handleTrackLogout = async () => {
    try {
      await window.storage.delete(wsKey("my-user"), false);
    } catch (e) {
      // ignore — worst case it's overwritten on next login
    }
    setMyUser("");
    setLoginName("");
    setLoginPassword("");
    setLoginError("");
  };

  const handleDashboardLogin = async () => {
    setDashLoginError("");
    const typed = dashLoginName.trim();
    if (!typed) { setDashLoginError("Enter your name."); return; }
    const matchKey = Object.keys(dashboardUsers).find((k) => k.toLowerCase() === typed.toLowerCase());
    const record = matchKey ? dashboardUsers[matchKey] : null;
    if (!record || record.password !== dashLoginPassword) { setDashLoginError("Wrong name or password."); return; }
    try {
      await window.storage.set(wsKey("my-dash-user"), matchKey, false);
      setMyDashUser(matchKey);
      setDashLoginPassword("");
    } catch (e) {
      setDashLoginError("Could not log in, try again.");
    }
  };

  const handleDashboardLock = async () => {
    try {
      await window.storage.delete(wsKey("my-dash-user"), false);
    } catch (e) {}
    setMyDashUser("");
    setDashLoginName("");
    setDashLoginPassword("");
    setDashLoginError("");
  };

  // One back button, one consistent behavior: each press steps back exactly one level. First press
  // from inside Agent/Dashboard logs out of that level only (choose a different name / log out of the
  // dashboard account) — from there, back goes to the Agent/Dashboard chooser, and only from the
  // chooser itself does "Switch workspace" actually leave.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const handleBack = () => {
    if (tab === "track" && myUser) { handleTrackLogout(); return; }
    if (tab === "dashboard" && role) { handleDashboardLock(); return; }
    if (onBackToChooser) { onBackToChooser(); return; }
    if (onSwitchWorkspace) setShowExitConfirm(true);
  };
  const backLabel =
    tab === "track" && myUser
      ? "Choose a different name"
      : tab === "dashboard" && role
      ? "Log out of Dashboard"
      : onBackToChooser
      ? "Choose Agent or Dashboard"
      : "Switch workspace";

  const handleSetupFirstDashOwner = async () => {
    setDashLoginError("");
    const trimmed = dashLoginName.trim();
    if (!trimmed || !dashLoginPassword.trim()) { setDashLoginError("Enter a name and password."); return; }
    const allPerms = Object.fromEntries(DASH_TABS.map((t) => [t.key, true]));
    const updated = { [trimmed]: { password: dashLoginPassword.trim(), role: "owner", permissions: allPerms, locked: false } };
    const ok = await saveDashboardUsers(updated, `Set up Dashboard access — "${trimmed}" is the owner`);
    if (!ok) { setDashLoginError("Could not save, try again."); return; }
    try {
      await window.storage.set(wsKey("my-dash-user"), trimmed, false);
      setMyDashUser(trimmed);
      setDashLoginPassword("");
    } catch (e) {}
  };

  const handleChangeOwnerPassword = async () => {
    setChangeOwnerMsg("");
    if (!changeOwnerNew.trim() || changeOwnerNew.trim().length < 4) { setChangeOwnerMsg("New password must be at least 4 characters."); return; }
    const updated = { ...dashboardUsers, [myDashUser]: { ...dashboardUsers[myDashUser], password: changeOwnerNew.trim() } };
    const ok = await saveDashboardUsers(updated, `Changed Dashboard password for "${myDashUser}"`);
    if (ok) { setChangeOwnerMsg("Password updated."); setChangeOwnerNew(""); } else { setChangeOwnerMsg("Could not save, try again."); }
  };

  // ---- Dashboard Team management (owner only, from Users tab → Dashboard) ----
  const handleAddDashUser = async () => {
    const trimmed = newDashUserId.trim();
    if (!trimmed || !newDashUserPassword.trim()) { setDashError("Enter a name and password."); return; }
    if (dashboardUsers[trimmed]) { setDashError("Someone with that name already exists."); return; }
    const updated = { ...dashboardUsers, [trimmed]: { password: newDashUserPassword.trim(), role: "member", permissions: newDashUserPerms, locked: false } };
    const ok = await saveDashboardUsers(updated, `Added Dashboard user "${trimmed}"`);
    if (ok) { setNewDashUserId(""); setNewDashUserPassword(""); setNewDashUserPerms({}); }
  };

  const handleSaveDashUserPerms = async (name, perms) => {
    const updated = { ...dashboardUsers, [name]: { ...dashboardUsers[name], permissions: perms } };
    const ok = await saveDashboardUsers(updated, `Updated Dashboard permissions for "${name}"`);
    if (ok) setEditingDashPermsFor("");
  };

  const handleResetDashUserPassword = async (name, newPw) => {
    if (!newPw.trim()) return;
    const updated = { ...dashboardUsers, [name]: { ...dashboardUsers[name], password: newPw.trim() } };
    const ok = await saveDashboardUsers(updated, `Reset Dashboard password for "${name}"`);
    if (ok) { setEditingDashPwFor(""); setDashPwEditValue(""); }
  };

  const handleRemoveDashUser = async (name) => {
    const updated = { ...dashboardUsers };
    delete updated[name];
    await saveDashboardUsers(updated, `Removed Dashboard user "${name}"`);
  };

  // Which tabs the logged-in Dashboard user can see — owner always sees everything, a regular
  // Dashboard user only sees what's been explicitly granted in their permissions.
  const myDashRecord = myDashUser ? dashboardUsers[myDashUser] : null;
  const canSeeTab = useCallback((key) => (myDashRecord?.role === "owner" ? true : !!myDashRecord?.permissions?.[key]), [myDashRecord]);

  const loggedInDashUserRef = useRef(null);
  useEffect(() => {
    setRole(myDashRecord ? (myDashRecord.role === "owner" ? "owner" : "member") : null);
    if (myDashRecord && myDashUser !== loggedInDashUserRef.current) {
      loggedInDashUserRef.current = myDashUser;
      const firstAllowed = myDashRecord.role === "owner" ? "overview" : DASH_TABS.find((t) => myDashRecord.permissions?.[t.key])?.key || "overview";
      setDashTab(firstAllowed);
    }
    if (!myDashRecord) loggedInDashUserRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDashUser, myDashRecord]);

  const addEvent = async (type, extra = {}) => {
    if (!myUser) return;
    setSaving(true);
    setError("");
    const newEvent = { id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type, timestamp: Date.now(), ...extra };
    const updated = [...events, newEvent];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setEvents(updated);
    } catch (e) {
      setError("Could not record that, try again.");
    }
    setSaving(false);
  };

  // Owner quick action: force Finish for someone right now (or at an explicit past timestamp when closing
  // an old forgotten shift). Never counts toward overtime.
  // Lets the owner directly force a person into any state — Available, Meeting, Task, or Finish — regardless
  // of what they're currently doing. Figures out the right event(s) itself: e.g. forcing "meeting" on someone
  // who's on break first closes the break, then opens the meeting, so the log stays clean and consistent.
  const forceUserState = async (personName, target, atTimestamp) => {
    const personEvents = events.filter((e) => e.name === personName);
    const live = computeRegularLiveState(personEvents, breakLimitMs, standardMs, Date.now());
    let ts = atTimestamp != null ? atTimestamp : Date.now();
    const newEvents = [];
    const push = (type, extra = {}) => {
      newEvents.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2), name: personName, type, timestamp: ts, byOwner: true, ...extra });
      ts += 1; // keep multi-event batches in strict order even when timestamps would otherwise tie
    };

    if (target === "finish") {
      if (live.status !== "working" && live.status !== "on_break") return; // nothing open to finish
      if (live.status === "on_break") push("break_end");
      else if (live.activity === "meeting") push("meeting_end");
      else if (live.activity === "task") push("task_end");
      push("end", { forced: true });
    } else if (target === "available") {
      if (live.status === "not_started" || live.status === "finished") push("start");
      else if (live.status === "on_break") push("break_end");
      else if (live.activity === "meeting") push("meeting_end");
      else if (live.activity === "task") push("task_end");
      // else already Available — nothing to do
    } else if (target === "meeting" || target === "task") {
      if (live.status === "not_started" || live.status === "finished") push("start");
      else if (live.status === "on_break") push("break_end");
      else if (live.activity === "meeting" && target !== "meeting") push("meeting_end");
      else if (live.activity === "task" && target !== "task") push("task_end");
      if (!(live.status === "working" && live.activity === target)) push(target === "meeting" ? "meeting_start" : "task_start");
    }

    if (newEvents.length === 0) return; // already in that exact state

    const updated = [...events, ...newEvents];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setEvents(updated);
      const targetLabel = target === "finish" ? "Finish" : target === "available" ? "Available" : target === "meeting" ? "Meeting" : "Task";
      const note = target === "finish" ? " (not counted as overtime)" : "";
      addAudit(`Owner forced "${personName}" into "${targetLabel}"${note}`);
    } catch (e) {
      setDashError("Could not apply that, try again.");
    }
  };

  const goToPersonReport = (personName) => {
    setReportDate(todayKey());
    setExpandedPerson(personName);
    setDashTab("report");
  };

  const purgeEventsFor = async (personName) => {
    const updated = events.filter((e) => e.name !== personName);
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setEvents(updated);
      addAudit(`Purged all attendance records for "${personName}"`);
      setConfirmPurgeFor("");
    } catch (e) {
      setDashError("Could not delete, try again.");
    }
  };

  const wipeAllEvents = async () => {
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify([]), true);
      if (!res) throw new Error("no result");
      setEvents([]);
      addAudit("Cleared all attendance records");
      setConfirmWipe(false);
    } catch (e) {
      setDashError("Could not clear data, try again.");
    }
  };

  // Starting overtime no longer needs a password — anyone can start it (as long as their regular shift
  // isn't open), optionally with a short reason. Every session is visible to the owner to approve/deny.
  const addOtEvent = async (type, extra = {}) => {
    if (!myUser) return;
    setSaving(true);
    setError("");
    const newEvent = { id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type, timestamp: Date.now(), ...extra };
    const updated = [...events, newEvent];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setEvents(updated);
    } catch (e) {
      setError("Could not record that, try again.");
    }
    setSaving(false);
  };

  // Owner action: approve or deny a specific overtime block, referenced by its ot_start event id.
  // Can be done anytime — before, during, or after the session — and can be changed later if needed.
  const recordOtDecision = async (personName, refId, decision) => {
    const newEvent = { id: Date.now() + "-" + Math.random().toString(36).slice(2), name: personName, type: decision, timestamp: Date.now(), refId };
    const updated = [...events, newEvent];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setEvents(updated);
      addAudit(`${decision === "ot_approve" ? "Approved" : "Denied"} overtime for "${personName}"`);
    } catch (e) {
      setDashError("Could not save that, try again.");
    }
  };

  const breakLimitMs = (settings.breakLimitMinutes || 60) * 60000;
  const standardMs = (settings.standardHours || 9) * 3600000;
  const otMaxMs = (settings.otMaxHours || 3) * 3600000;
  const otCapMs = (settings.otCapHours || 5) * 3600000;

  const myRecord = users[myUser];

  // Sorts user names by their manually-assigned ID (numeric-aware: "1171" < "2010"), not
  // alphabetically. Users without an ID sort after those with one, alphabetically among themselves.
  const compareByUserId = useCallback(
    (a, b) => {
      const idA = users[a]?.id?.trim();
      const idB = users[b]?.id?.trim();
      if (idA && idB) {
        const numA = Number(idA), numB = Number(idB);
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
        return idA.localeCompare(idB);
      }
      if (idA && !idB) return -1;
      if (!idA && idB) return 1;
      return a.localeCompare(b);
    },
    [users]
  );

  // Every date (across all weeks) where this person's schedule entry is "OFF" — used to keep
  // each person's total OFF-day count at exactly 2 when swapping touches an OFF day.
  const getOffDates = useCallback(
    (name, excludeDate) => {
      return Object.keys(schedule)
        .filter((k) => {
          const [n, d] = k.split("|");
          return n === name && d !== excludeDate && schedule[k]?.kind === "status" && schedule[k].status === "off";
        })
        .map((k) => k.split("|")[1])
        .sort();
    },
    [schedule]
  );

  // Combined pending-task count for the Agent nav badge: recurring tasks that match today's
  // shift (and aren't completed yet today) + one-off tasks assigned directly to this person.
  const myPendingTaskCount = useMemo(() => {
    if (!myUser) return 0;
    const today = todayKey();
    const myShiftToday = schedule[`${myUser}|${today}`];
    const shiftLabel = myShiftToday?.kind === "shift" ? myShiftToday.label : "";
    const doneTodayIds = new Set(
      recurringCompletions.filter((c) => c.name === myUser && c.date === today).map((c) => c.taskId)
    );
    const recurringPendingCount = shiftLabel
      ? recurringTasks.filter((t) => shiftLabel.startsWith(fmtTime12(t.time)) && !doneTodayIds.has(t.id)).length
      : 0;
    const oneOffPendingCount = dailyTasks.filter((t) => t.name === myUser && t.status === "pending").length;
    return recurringPendingCount + oneOffPendingCount;
  }, [myUser, schedule, recurringTasks, recurringCompletions, dailyTasks]);

  const myPersonEvents = useMemo(() => events.filter((e) => e.name === myUser), [events, myUser]);
  const myLiveState = useMemo(() => computeRegularLiveState(myPersonEvents, breakLimitMs, standardMs, now), [myPersonEvents, breakLimitMs, standardMs, now]);
  const { status, activity, breakLocked, openBreakStart, enriched, liveWorkedMs, liveElapsedMs, liveBreakMs, totalBreakMsSoFar, liveMeetingMs, liveTaskMs, currentMeetingMs, currentTaskMs, shiftDate: myShiftDate, shiftStart: myShiftStart } = myLiveState;
  const liveOvertime = totalBreakMsSoFar > breakLimitMs;
  const canFinishNow = liveElapsedMs >= standardMs;

  // Mandatory rest between shifts: once someone finishes a shift, they can't open a new one until this many
  // hours have passed since that Finish — configurable in Settings, 0 (default) means no restriction at all.
  const minRestMs = (settings.minRestHours || 0) * 3600000;
  const myLastShiftEndMs = useMemo(() => getLastShiftEndMs(myPersonEvents), [myPersonEvents]);
  const restRemainingMs = status === "not_started" && minRestMs > 0 && myLastShiftEndMs ? Math.max(0, myLastShiftEndMs + minRestMs - now) : 0;
  const restLocked = restRemainingMs > 0;

  const myOtLiveState = useMemo(() => computeOtLiveState(myPersonEvents, now), [myPersonEvents, now]);
  const canUseOvertime = status !== "working" && status !== "on_break";

  const autoFinishMyShift = useCallback(async (atTimestamp) => {
    if (!myUser) return;
    const ts = atTimestamp != null ? atTimestamp : Date.now();
    const newEvents = [];
    if (openBreakStart) {
      // Break was left open — close it first so we don't leave a dangling break_start behind.
      newEvents.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type: "break_end", timestamp: ts, forced: true });
    } else if (activity === "meeting") {
      newEvents.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type: "meeting_end", timestamp: ts, forced: true });
    } else if (activity === "task") {
      newEvents.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type: "task_end", timestamp: ts, forced: true });
    }
    newEvents.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type: "end", timestamp: ts, forced: true });
    const updated = [...events, ...newEvents];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (res) {
        setEvents(updated);
        addAudit(`Auto-closed shift for "${myUser}" after ${settings.graceMinutes} min with no response (not counted as overtime)${openBreakStart ? " — break was left open and closed too" : ""}`);
      }
    } catch (e) {}
  }, [myUser, events, settings.graceMinutes, openBreakStart, activity]); // eslint-disable-line react-hooks/exhaustive-deps

  const snoozeReached = () => {
    graceRef.current.snoozedAt = now;
    graceRef.current.lastPingIndex = -1;
    graceRef.current.autoFinished = false;
    setShowReachedPrompt(false);
  };

  // Alarm pings every 5 min once standard hours are reached; auto-finishes (not counted as overtime) if
  // there's still no response after the grace period. "I'm still here" snoozes without granting overtime —
  // real overtime only ever happens through the separate owner-approved Overtime tab.
  // The closing timestamp is always the calculated deadline (reached-time + grace), not "whenever the app
  // happens to be reopened" — so Worked correctly reflects roughly the standard hours even if nobody looked
  // at the page again until much later.
  useEffect(() => {
    if ((status !== "working" && status !== "on_break") || !myShiftStart) {
      graceRef.current = { shiftDate: null, lastPingIndex: -1, snoozedAt: null, autoFinished: false };
      setShowReachedPrompt(false);
      return;
    }
    if (graceRef.current.shiftDate !== myShiftDate) {
      graceRef.current = { shiftDate: myShiftDate, lastPingIndex: -1, snoozedAt: null, autoFinished: false };
    }
    const reachedAt = myShiftStart + standardMs;
    if (now < reachedAt) return;

    const graceMs = (settings.graceMinutes || 15) * 60000;
    const pingIntervalMs = 5 * 60000;
    const pingCount = Math.max(1, Math.floor(graceMs / pingIntervalMs));
    const windowStart = graceRef.current.snoozedAt || reachedAt;
    const elapsedInWindow = now - windowStart;
    const pingIndex = Math.floor(elapsedInWindow / pingIntervalMs);

    if (pingIndex > graceRef.current.lastPingIndex && pingIndex <= pingCount) {
      graceRef.current.lastPingIndex = pingIndex;
      playAlarm();
      if (pingIndex === 0) setShowReachedPrompt(true);
    }

    if (elapsedInWindow >= graceMs && !graceRef.current.autoFinished) {
      graceRef.current.autoFinished = true;
      setShowReachedPrompt(false);
      if (pingIndex > pingCount) playAlarm(); // still chime once even if we only discovered this long after the deadline passed
      autoFinishMyShift(windowStart + graceMs);
    }
  }, [status, now, myShiftStart, myShiftDate, standardMs, settings.graceMinutes, autoFinishMyShift]);

  // "Still there?" presence check — a quiet, non-blocking way for the owner to know someone is genuinely
  // around during their shift, without needing them to keep the Agent tab focused. Fires at a random time
  // roughly every 90-150 min while status is "working" (not during a break — that already implies presence).
  // If ignored for 10 minutes it just logs as "missed" and reschedules; it never pauses or blocks the shift.
  const savePresence = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-presence"), JSON.stringify(updated), true);
        if (res) setPresence(updated);
      } catch (e) {}
    },
    [wsKey]
  );

  const saveSchedule = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-schedule"), JSON.stringify(updated), true);
        if (res) setSchedule(updated);
        return !!res;
      } catch (e) {
        return false;
      }
    },
    [wsKey]
  );

  // Snapshots the current draft schedule into what employees actually see. Employees never
  // see live edits — only whatever was showing the last time the owner hit Publish.
  const publishSchedule = useCallback(async () => {
    try {
      const res = await window.storage.set(wsKey("attendance-schedule-published"), JSON.stringify(schedule), true);
      if (res) {
        setPublishedSchedule(schedule);
        setPublishMsg("Published — your team can now see this schedule.");
        setTimeout(() => setPublishMsg(""), 3000);
        return true;
      }
    } catch (e) {}
    setPublishMsg("Could not publish, try again.");
    return false;
  }, [wsKey, schedule]);

  const unpublishSchedule = useCallback(async () => {
    try {
      const res = await window.storage.set(wsKey("attendance-schedule-published"), JSON.stringify({}), true);
      if (res) {
        setPublishedSchedule({});
        setPublishMsg("Unpublished — your team won't see a schedule until you publish again.");
        setTimeout(() => setPublishMsg(""), 3000);
        return true;
      }
    } catch (e) {}
    setPublishMsg("Could not unpublish, try again.");
    return false;
  }, [wsKey]);

  const saveDailyTasks = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-daily-tasks"), JSON.stringify(updated), true);
        if (res) setDailyTasks(updated);
        return !!res;
      } catch (e) {
        return false;
      }
    },
    [wsKey]
  );

  const saveRecurringTasks = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-recurring-tasks"), JSON.stringify(updated), true);
        if (res) setRecurringTasks(updated);
        return !!res;
      } catch (e) {
        return false;
      }
    },
    [wsKey]
  );

  const savePublicHolidays = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-public-holidays"), JSON.stringify(updated), true);
        if (res) setPublicHolidays(updated);
        return !!res;
      } catch (e) {
        return false;
      }
    },
    [wsKey]
  );

  const saveRecurringCompletions = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-recurring-completions"), JSON.stringify(updated), true);
        if (res) setRecurringCompletions(updated);
        return !!res;
      } catch (e) {
        return false;
      }
    },
    [wsKey]
  );

  const saveSwapRequests = useCallback(
    async (updated) => {
      try {
        const res = await window.storage.set(wsKey("attendance-swap-requests"), JSON.stringify(updated), true);
        if (res) setSwapRequests(updated);
        return !!res;
      } catch (e) {
        return false;
      }
    },
    [wsKey]
  );

  // Applies a schedule-cell change AND keeps each person's annual leave balance in sync:
  // assigning "Annual" deducts a day, removing/replacing a prior "Annual" entry gives it back.
  const applyScheduleEntry = useCallback(
    async (name, dateStr, entry) => {
      const key = `${name}|${dateStr}`;
      const prior = schedule[key];
      const wasAnnual = prior?.kind === "status" && prior.status === "annual";
      const willBeAnnual = entry?.kind === "status" && entry.status === "annual";

      // Working an actual shift on a marked public holiday auto-credits +1 annual leave day;
      // moving them off that shift (or off the holiday date) takes the credited day back.
      const isHoliday = publicHolidays.includes(dateStr);
      const wasWorkingHoliday = isHoliday && prior?.kind === "shift";
      const willBeWorkingHoliday = isHoliday && entry?.kind === "shift";

      const updatedSchedule = { ...schedule };
      if (entry === null) delete updatedSchedule[key];
      else updatedSchedule[key] = entry;

      let leaveDelta = 0;
      if (wasAnnual !== willBeAnnual) leaveDelta += willBeAnnual ? -1 : 1;
      if (wasWorkingHoliday !== willBeWorkingHoliday) leaveDelta += willBeWorkingHoliday ? 1 : -1;

      let updatedUsers = users;
      if (leaveDelta !== 0 && users[name]) {
        const currentBalance = users[name].annualLeaveBalance ?? DEFAULT_ANNUAL_LEAVE_BALANCE;
        updatedUsers = { ...users, [name]: { ...users[name], annualLeaveBalance: currentBalance + leaveDelta } };
      }

      const auditParts = [];
      if (wasAnnual !== willBeAnnual) auditParts.push(willBeAnnual ? "deducted (Annual)" : "restored (Annual removed)");
      if (wasWorkingHoliday !== willBeWorkingHoliday) auditParts.push(willBeWorkingHoliday ? "credited (worked a public holiday)" : "reversed (no longer working that public holiday)");

      const ok = await saveSchedule(updatedSchedule);
      if (!ok) return false;
      if (updatedUsers !== users) {
        const usersOk = await saveUsers(updatedUsers, `Annual leave ${auditParts.join(", ")} for "${name}" (${fmtDateLabel(dateStr)})`);
        if (!usersOk) return false;
      }
      return true;
    },
    [schedule, users, publicHolidays, saveSchedule, saveUsers]
  );

  // Imports a roster CSV: row 1 = ID, Agent Name, then one column per date (M/D/YYYY,
  // e.g. "8/9/2026"); each data row after that = ID, Agent Name, then a value per date —
  // OFF / Annual / Training / Holiday (case-insensitive), or free text for a shift label.
  const handleImportScheduleCSV = async (file) => {
    setImportMsg("Importing...");
    try {
      const text = await file.text();
      const rows = parseSimpleCSV(text);
      if (rows.length < 2) { setImportMsg("That file looks empty."); return; }
      const header = rows[0];
      const dateCols = header.slice(2).map((h) => parseUSDateToKey(h));
      const updatedSchedule = { ...schedule };
      const leaveDelta = {};
      let matched = 0;
      const unmatched = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[1] || "").trim();
        if (!name) continue;
        if (!users[name]) { unmatched.push(name); continue; }
        matched++;
        for (let c = 0; c < dateCols.length; c++) {
          const dateStr = dateCols[c];
          if (!dateStr) continue;
          const raw = (row[2 + c] || "").trim();
          if (!raw) continue;
          const key = `${name}|${dateStr}`;
          const priorWasAnnual = updatedSchedule[key]?.kind === "status" && updatedSchedule[key].status === "annual";
          const lower = raw.toLowerCase();
          let entry;
          if (SCHEDULE_STATUSES[lower]) entry = { kind: "status", status: lower };
          else entry = { kind: "shift", label: raw };
          const nowIsAnnual = entry.kind === "status" && entry.status === "annual";
          if (nowIsAnnual && !priorWasAnnual) leaveDelta[name] = (leaveDelta[name] || 0) - 1;
          if (!nowIsAnnual && priorWasAnnual) leaveDelta[name] = (leaveDelta[name] || 0) + 1;
          updatedSchedule[key] = entry;
        }
      }

      const ok = await saveSchedule(updatedSchedule);
      let usersOk = true;
      if (ok && Object.keys(leaveDelta).length > 0) {
        const updatedUsers = { ...users };
        for (const [name, delta] of Object.entries(leaveDelta)) {
          const cur = updatedUsers[name]?.annualLeaveBalance ?? DEFAULT_ANNUAL_LEAVE_BALANCE;
          updatedUsers[name] = { ...updatedUsers[name], annualLeaveBalance: cur + delta };
        }
        usersOk = await saveUsers(updatedUsers, "Annual leave balances adjusted from schedule CSV import");
      }
      setImportMsg(
        !ok
          ? "Could not save the import, try again."
          : !usersOk
          ? `Imported ${matched} agent(s), but annual leave balances could not be updated — check them manually.`
          : `Imported ${matched} agent(s).${unmatched.length ? ` Skipped (no matching user): ${[...new Set(unmatched)].join(", ")}.` : ""}`
      );
    } catch (e) {
      setImportMsg("Could not read that file.");
    }
  };

  // Exports the currently viewed week as a CSV in the same shape handleImportScheduleCSV expects,
  // so it round-trips: export, edit in Excel, re-import.
  const handleExportScheduleCSV = () => {
    const ref = new Date();
    ref.setDate(ref.getDate() + scheduleWeekOffset * 7);
    const dates = weekDatesSat(ref);
    const names = Object.keys(users).sort(compareByUserId);
    const header = ["ID", "Agent Name", ...dates.map((d) => {
      const dd = new Date(d + "T12:00:00");
      return `${dd.getMonth() + 1}/${dd.getDate()}/${dd.getFullYear()}`;
    })];
    const rows = [header];
    names.forEach((name) => {
      const row = [users[name]?.id || "", name];
      dates.forEach((d) => {
        const entry = schedule[`${name}|${d}`];
        if (!entry) row.push("");
        else if (entry.kind === "status") row.push(SCHEDULE_STATUSES[entry.status]?.label || "");
        else row.push(entry.label || "");
      });
      rows.push(row);
    });
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedule-${dates[0]}-to-${dates[6]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const scheduleNextPresenceCheck = () => {
    const minMs = 90 * 60000;
    const maxMs = 150 * 60000;
    presenceRef.current.nextCheckAt = now + minMs + Math.random() * (maxMs - minMs);
    presenceRef.current.promptShownAt = null;
  };

  const confirmPresence = () => {
    setShowPresenceCheck(false);
    presenceRef.current.promptShownAt = null;
    scheduleNextPresenceCheck();
    if (myUser) {
      const prior = presence[myUser] || {};
      const updated = { ...presence, [myUser]: { ...prior, lastConfirmedAt: now } };
      savePresence(updated);
    }
  };

  useEffect(() => {
    if (status !== "working" || !myShiftStart) {
      presenceRef.current = { shiftDate: null, nextCheckAt: null, promptShownAt: null };
      setShowPresenceCheck(false);
      return;
    }
    if (presenceRef.current.shiftDate !== myShiftDate) {
      presenceRef.current.shiftDate = myShiftDate;
      scheduleNextPresenceCheck();
    }
    if (!presenceRef.current.nextCheckAt) return;

    // Time to show a check
    if (!showPresenceCheck && !presenceRef.current.promptShownAt && now >= presenceRef.current.nextCheckAt) {
      presenceRef.current.promptShownAt = now;
      setShowPresenceCheck(true);
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Shiftly", { body: "Quick check — still working?", silent: true });
        }
      } catch (e) {}
    }

    // Timed out with no response — log as missed, reschedule, no interruption to the shift itself
    if (showPresenceCheck && presenceRef.current.promptShownAt && now - presenceRef.current.promptShownAt >= 10 * 60000) {
      setShowPresenceCheck(false);
      presenceRef.current.promptShownAt = null;
      scheduleNextPresenceCheck();
      if (myUser) {
        const todayStr = todayKey();
        const prior = presence[myUser] || {};
        const missedToday = prior.missedDate === todayStr ? (prior.missedToday || 0) + 1 : 1;
        const updated = { ...presence, [myUser]: { ...prior, lastMissedAt: now, missedToday, missedDate: todayStr } };
        savePresence(updated);
      }
    }
  }, [status, now, myShiftStart, myShiftDate, showPresenceCheck, myUser, presence, savePresence]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same safety net as the regular shift, but for overtime: once a session runs past otMaxHours, it pings
  // every 5 min and auto-closes itself after the grace window so a forgotten "Finish" can't quietly run for
  // hours or days. Auto-closed sessions still go through the normal approval flow like any other.
  const autoFinishMyOt = useCallback(async (atTimestamp) => {
    if (!myUser) return;
    const ts = atTimestamp != null ? atTimestamp : Date.now();
    const newEvent = { id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type: "ot_end", timestamp: ts, forced: true };
    const updated = [...events, newEvent];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (res) {
        setEvents(updated);
        addAudit(`Auto-closed overtime for "${myUser}" after ${settings.graceMinutes} min with no response`);
      }
    } catch (e) {}
  }, [myUser, events, settings.graceMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const snoozeOtReached = () => {
    otGraceRef.current.snoozedAt = now;
    otGraceRef.current.lastPingIndex = -1;
    otGraceRef.current.autoFinished = false;
    setShowOtReachedPrompt(false);
  };

  useEffect(() => {
    const activeBlock = myOtLiveState.activeBlock;
    if (!activeBlock) {
      otGraceRef.current = { blockId: null, lastPingIndex: -1, snoozedAt: null, autoFinished: false };
      setShowOtReachedPrompt(false);
      return;
    }
    if (otGraceRef.current.blockId !== activeBlock.id) {
      otGraceRef.current = { blockId: activeBlock.id, lastPingIndex: -1, snoozedAt: null, autoFinished: false };
    }
    const reachedAt = activeBlock.start + otMaxMs;
    if (now < reachedAt) return;

    const graceMs = (settings.graceMinutes || 15) * 60000;
    const pingIntervalMs = 5 * 60000;
    const pingCount = Math.max(1, Math.floor(graceMs / pingIntervalMs));
    const windowStart = otGraceRef.current.snoozedAt || reachedAt;
    const elapsedInWindow = now - windowStart;
    const pingIndex = Math.floor(elapsedInWindow / pingIntervalMs);

    if (pingIndex > otGraceRef.current.lastPingIndex && pingIndex <= pingCount) {
      otGraceRef.current.lastPingIndex = pingIndex;
      playAlarm();
      if (pingIndex === 0) setShowOtReachedPrompt(true);
    }

    if (elapsedInWindow >= graceMs && !otGraceRef.current.autoFinished) {
      otGraceRef.current.autoFinished = true;
      setShowOtReachedPrompt(false);
      if (pingIndex > pingCount) playAlarm();
      autoFinishMyOt(windowStart + graceMs);
    }
  }, [myOtLiveState.activeBlock, now, otMaxMs, settings.graceMinutes, autoFinishMyOt]);

  // This week's overtime for the current user, split by approval status, to show progress against the cap.
  const myWeekOtStats = useMemo(() => {
    if (!myUser) return { approvedMs: 0, pendingMs: 0 };
    const dates = weekDatesSat();
    let approvedMs = 0;
    let pendingMs = 0;
    for (const d of dates) {
      approvedMs += otWorkedMsForDate(myPersonEvents, d);
      pendingMs += otPendingMsForDate(myPersonEvents, d);
    }
    return { approvedMs, pendingMs };
  }, [myPersonEvents, myUser]);

  // Counts shifts, not hours: how many regular shifts fell this week, and how many of those were
  // separately-tracked overtime blocks. A shift counts as soon as it's started, even if still open today.
  const myWeekStats = useMemo(() => {
    if (!myUser) return { shiftsCount: 0, otCount: 0 };
    const dates = new Set(weekDatesSat());
    const regular = myPersonEvents.filter((e) => REGULAR_TYPES.includes(e.type)).sort((a, b) => a.timestamp - b.timestamp);
    const shiftsCount = groupRegularShifts(regular).filter((sh) => dates.has(sh.shiftDate)).length;
    const otCount = groupOtBlocks(myPersonEvents).filter((b) => dates.has(b.blockDate)).length;
    return { shiftsCount, otCount };
  }, [myPersonEvents, myUser]);

  const allNames = useMemo(() => Array.from(new Set(events.map((e) => e.name))).sort(), [events]);
  const availableDates = useMemo(() => {
    const set = new Set(events.map((e) => todayKey(new Date(e.timestamp))));
    set.add(todayKey());
    return Array.from(set).sort().reverse();
  }, [events]);

  const summary = useMemo(() => {
    const base = computeDaySummary(events, reportDate, breakLimitMs, standardMs);
    const namesWithOt = new Set();
    for (const ev of events) {
      if (OT_TYPES.includes(ev.type)) {
        const d = todayKey(new Date(ev.timestamp));
        if (d === reportDate) namesWithOt.add(ev.name);
      }
    }
    // Someone can do pure overtime with no regular shift that day (e.g. weekend on-call) — make sure they
    // still show up in the Report so their session isn't invisible to the owner.
    for (const name of namesWithOt) {
      if (!base[name]) base[name] = { workedMs: 0, overtimeMs: 0, breaks: [], totalBreakMs: 0, meetings: [], totalMeetingMs: 0, tasks: [], totalTaskMs: 0, overtimeCount: 0, hasForcedClose: false, hasEarlyLeave: false, earlyLeaveNote: "", events: [], shiftCount: 0, stillOpen: false, start: null, end: null };
    }
    for (const name of Object.keys(base)) {
      const personEvents = events.filter((e) => e.name === name);
      const ot = otWorkedMsForDate(personEvents, reportDate);
      base[name].otBlockMs = ot;
      base[name].overtimeMs = base[name].overtimeMs + ot;
      base[name].otBlocks = groupOtBlocks(personEvents).filter((b) => b.blockDate === reportDate);
    }
    return base;
  }, [events, reportDate, breakLimitMs, standardMs]);

  const teamOf = useCallback((name) => users[name]?.team || "", [users]);
  const teams = useMemo(() => Array.from(new Set(Object.values(users).map((u) => u.team).filter(Boolean))).sort(), [users]);
  const matchesTeamFilter = useCallback(
    (name) => {
      if (teamFilter === "all") return true;
      if (teamFilter === "__unassigned__") return !teamOf(name);
      return teamOf(name) === teamFilter;
    },
    [teamFilter, teamOf]
  );

  const matchesSearch = useCallback(
    (name) => {
      const q = userSearch.trim().toLowerCase();
      if (!q) return true;
      return name.toLowerCase().includes(q);
    },
    [userSearch]
  );

  const filteredSummaryEntries = useMemo(() => Object.entries(summary).filter(([name]) => matchesTeamFilter(name) && matchesSearch(name)), [summary, matchesTeamFilter, matchesSearch]);

  const userInfoByUser = useMemo(() => {
    const map = {};
    const eventsByUser = {};
    for (const ev of events) {
      if (!eventsByUser[ev.name]) eventsByUser[ev.name] = [];
      eventsByUser[ev.name].push(ev);
    }
    for (const uname of Object.keys(users)) {
      const personEvents = eventsByUser[uname] || [];
      const live = computeRegularLiveState(personEvents, breakLimitMs, standardMs, now);
      const ot = computeOtLiveState(personEvents, now);
      const lastTs = personEvents.reduce((max, e) => (e.timestamp > max ? e.timestamp : max), 0);
      map[uname] = {
        status: live.status,
        activity: live.activity,
        todayWorkedMs: live.liveWorkedMs,
        liveWorkedMs: live.liveWorkedMs,
        liveElapsedMs: live.liveElapsedMs,
        otActive: ot.active,
        otLiveMs: ot.liveMs,
        lastEventTs: lastTs || null,
      };
    }
    return map;
  }, [users, events, breakLimitMs, standardMs, now]);

  const liveCounts = useMemo(() => {
    let working = 0;
    let onBreak = 0;
    let onOt = 0;
    let inMeeting = 0;
    let onTask = 0;
    for (const info of Object.values(userInfoByUser)) {
      if (info.status === "working") working += 1;
      if (info.status === "on_break") onBreak += 1;
      if (info.otActive) onOt += 1;
      if (info.status === "working" && info.activity === "meeting") inMeeting += 1;
      if (info.status === "working" && info.activity === "task") onTask += 1;
    }
    return { working, onBreak, onOt, inMeeting, onTask };
  }, [userInfoByUser]);

  const activeUsersProgress = useMemo(() => {
    return Object.entries(userInfoByUser)
      .filter(([, info]) => info.status === "working" || info.status === "on_break")
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.liveElapsedMs - a.liveElapsedMs);
  }, [userInfoByUser]);

  const coworkersNow = useMemo(() => {
    return Object.entries(userInfoByUser)
      .filter(([name, info]) => name !== myUser && (info.status === "working" || info.status === "on_break"))
      .map(([name, info]) => ({ name, status: info.status, activity: info.activity }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [userInfoByUser, myUser]);

  // Genuinely orphaned open shifts (not the person's current/most recent one — that's just live status).
  // Under the current model this should be rare (no more reopening), kept as a defensive safety net.
  const openIssues = useMemo(() => {
    const issues = [];
    const byPerson = {};
    for (const ev of events) {
      if (!REGULAR_TYPES.includes(ev.type)) continue;
      if (!byPerson[ev.name]) byPerson[ev.name] = [];
      byPerson[ev.name].push(ev);
    }
    for (const name in byPerson) {
      const sorted = byPerson[name].slice().sort((a, b) => a.timestamp - b.timestamp);
      const shifts = groupRegularShifts(sorted);
      for (let i = 0; i < shifts.length - 1; i++) {
        if (shifts[i].end === null) issues.push({ name, date: shifts[i].shiftDate });
      }
    }
    return issues;
  }, [events]);

  // Every completed overtime session across everyone that hasn't been approved or denied yet — this is
  // the owner's queue, surfaced right on Overview so it doesn't get lost inside daily Report pages.
  const pendingOtBlocks = useMemo(() => {
    const byPerson = {};
    for (const ev of events) {
      if (!byPerson[ev.name]) byPerson[ev.name] = [];
      byPerson[ev.name].push(ev);
    }
    const pending = [];
    for (const name in byPerson) {
      const blocks = groupOtBlocks(byPerson[name]);
      for (const b of blocks) {
        if (b.end && b.status === "pending") pending.push({ name, ...b });
      }
    }
    return pending.sort((a, b) => b.start - a.start);
  }, [events]);

  // Already-decided overtime sessions (approved or denied) — shown in the Approvals tab's
  // "Approved" history view, so that record doesn't have to live in Report instead.
  const resolvedOtBlocks = useMemo(() => {
    const byPerson = {};
    for (const ev of events) {
      if (!byPerson[ev.name]) byPerson[ev.name] = [];
      byPerson[ev.name].push(ev);
    }
    const resolved = [];
    for (const name in byPerson) {
      const blocks = groupOtBlocks(byPerson[name]);
      for (const b of blocks) {
        if (b.end && (b.status === "approved" || b.status === "denied")) resolved.push({ name, ...b });
      }
    }
    return resolved.sort((a, b) => b.start - a.start);
  }, [events]);

  const periodSummary = useMemo(() => {
    const dates = summaryPeriod === "week" ? weekDatesSat() : monthDates();
    const totals = {};
    const otTotals = {};
    const shiftCounts = {};
    const otCounts = {};
    const byDay = {}; // person -> [{ date, workedMs, otMs, shiftCount }]
    for (const d of dates) {
      const daySum = computeDaySummary(events, d, breakLimitMs, standardMs);
      for (const name of allNames) {
        if (!totals[name]) { totals[name] = 0; otTotals[name] = 0; shiftCounts[name] = 0; otCounts[name] = 0; byDay[name] = []; }
        const s = daySum[name];
        const dayWorked = s?.workedMs || 0;
        const personEvents = events.filter((e) => e.name === name);
        const dayOt = otWorkedMsForDate(personEvents, d);
        if (dayWorked) totals[name] += dayWorked;
        if (dayOt) otTotals[name] += dayOt;
        if (s?.shiftCount) shiftCounts[name] += s.shiftCount;
        const dayOtBlocks = groupOtBlocks(personEvents).filter((b) => b.blockDate === d && b.status === "approved").length;
        otCounts[name] += dayOtBlocks;
        if (dayWorked || dayOt || s?.shiftCount) {
          byDay[name].push({ date: d, workedMs: dayWorked, otMs: dayOt, shiftCount: s?.shiftCount || 0, stillOpen: !!s?.stillOpen });
        }
      }
    }
    for (const name of Object.keys(totals)) {
      if (!totals[name] && !otTotals[name] && !shiftCounts[name] && !otCounts[name]) {
        delete totals[name]; delete otTotals[name]; delete shiftCounts[name]; delete otCounts[name]; delete byDay[name];
      }
    }
    return { dates, totals, otTotals, shiftCounts, otCounts, byDay };
  }, [events, breakLimitMs, standardMs, summaryPeriod, allNames]);

  const teamSnapshot = useMemo(() => {
    const people = filteredSummaryEntries.map(([, s]) => s);
    const totalWorkedMs = people.reduce((sum, s) => sum + (s.workedMs || 0), 0);
    const totalOvertimeMs = people.reduce((sum, s) => sum + (s.overtimeMs || 0), 0);
    const stillOpenCount = people.filter((s) => s.stillOpen).length;
    const overLimitCount = people.filter((s) => s.overtimeCount > 0).length;
    return { peopleCount: people.length, totalWorkedMs, totalOvertimeMs, stillOpenCount, overLimitCount };
  }, [filteredSummaryEntries]);

  const todaySnapshot = useMemo(() => {
    const todaySum = computeDaySummary(events, todayKey(), breakLimitMs, standardMs);
    const byPerson = {};
    for (const ev of events) {
      if (!byPerson[ev.name]) byPerson[ev.name] = [];
      byPerson[ev.name].push(ev);
    }
    let totalWorkedMs = 0;
    let totalOvertimeMs = 0;
    for (const s of Object.values(todaySum)) totalWorkedMs += s.workedMs || 0;
    for (const name in byPerson) totalOvertimeMs += otWorkedMsForDate(byPerson[name], todayKey());
    return { peopleCount: Object.keys(todaySum).length, totalWorkedMs, totalOvertimeMs };
  }, [events, breakLimitMs, standardMs]);

  // Day summary for the Overview tab's date picker — who worked that day, from–to, and how many
  // meetings/tasks/breaks each person had.
  const overviewDaySummary = useMemo(() => computeDaySummary(events, overviewDate, breakLimitMs, standardMs), [events, overviewDate, breakLimitMs, standardMs]);

  // Meeting, Task, and Available are all just "normal, counted work" — the only thing that ever pauses the
  // clock is Break. There is no separate "Back" button anymore: returning from Break, Meeting, or Task is
  // always the same single "Available" button. You can only branch into Meeting/Task/Break from Available,
  // so you always pass back through Available before switching to something else.
  let BUTTONS;
  if (status === "not_started") {
    BUTTONS = [{ type: "start", label: "Available", icon: Play, color: "emerald", enabled: !myOtLiveState.active && !restLocked }];
  } else if (status === "on_break") {
    BUTTONS = [{ type: "break_end", label: "Available", icon: Play, color: "emerald", enabled: true }];
  } else if (status === "working" && activity === "meeting") {
    BUTTONS = [{ type: "meeting_end", label: "Available", icon: Play, color: "emerald", enabled: true }];
  } else if (status === "working" && activity === "task") {
    BUTTONS = [{ type: "task_end", label: "Available", icon: Play, color: "emerald", enabled: true }];
  } else if (status === "working") {
    BUTTONS = [
      { type: "meeting_start", label: "Meeting", icon: UsersIcon, color: "sky", enabled: true },
      { type: "task_start", label: "Task", icon: StickyNote, color: "violet", enabled: true },
      { type: "break_start", label: "Break", icon: Coffee, color: "amber", enabled: !breakLocked && !canFinishNow },
      { type: "end", label: "Finish", icon: Square, color: "rose", enabled: true },
    ];
  } else {
    BUTTONS = []; // finished for the day
  }

  if (loading) {
    return (
      <div className="w-full min-h-screen bg-neutral-950 flex items-center justify-center">
        <RefreshCw size={18} className="text-neutral-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-neutral-950 text-neutral-100" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        @keyframes logoPop {
          0% { opacity: 0; transform: scale(0.75) translateY(-6px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      {toast && (
        <div key={toast.key} className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2.5 rounded-full shadow-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            {toast.text}
          </div>
        </div>
      )}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-5" onClick={() => setShowExitConfirm(false)}>
          <div className="w-full max-w-xs bg-neutral-900 border border-neutral-800 rounded-xl p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
              <ArrowLeft size={18} className="text-amber-400" />
            </div>
            <p className="text-sm font-medium text-neutral-100 mb-1">Leave this workspace?</p>
            <p className="text-xs text-neutral-500 mb-4">
              {tab === "track" ? "You'll need to enter the workspace name again to come back to the Agent screen." : "You'll need to enter the workspace name again to come back to the Dashboard."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowExitConfirm(false); onSwitchWorkspace(); }}
                className="flex-1 bg-rose-500/10 text-rose-400 text-sm font-medium px-3 py-2 rounded-lg hover:bg-rose-500/20"
              >
                Yes, leave
              </button>
              <button onClick={() => setShowExitConfirm(false)} className="flex-1 bg-neutral-100 text-neutral-900 text-sm font-medium px-3 py-2 rounded-lg">
                No, stay
              </button>
            </div>
          </div>
        </div>
      )}
      {showPresenceCheck && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-700 text-neutral-100 text-sm font-medium pl-4 pr-2 py-2 rounded-full shadow-lg">
            <span>Still there? 👋</span>
            <button onClick={confirmPresence} className="bg-neutral-100 text-neutral-900 text-xs font-semibold px-3 py-1.5 rounded-full">
              Yes, I'm here
            </button>
          </div>
        </div>
      )}
      <div className="px-4 sm:px-5 pt-5 pb-4 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-neutral-900 border border-emerald-500/30 flex items-center justify-center">
            <Clock size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-wide leading-tight text-neutral-50">SHIFTLY</h1>
            <p className="text-xs text-neutral-500 leading-tight">{fmtDateLabel(todayKey())} · <span className="font-mono">{new Date(now).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}</span></p>
          </div>
          {workspaceDisplayName && (
            <span className="ml-1 flex items-center gap-1 text-[11px] font-medium text-violet-300/80 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-1">
              <Building2 size={11} className="text-violet-400/80" />
              {workspaceDisplayName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!lockTab ? (
            <div className="flex bg-neutral-900 rounded-lg p-1 gap-1">
              <button onClick={() => setTab("track")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "track" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
                Agent
              </button>
              <button onClick={() => setTab("dashboard")} className={`relative flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "dashboard" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
                {!role && <Lock size={11} />}
                Dashboard
                {pendingOtBlocks.length + openIssues.length + swapRequests.filter((r) => r.status === "pending").length > 0 && (
                  <span
                    title={`${pendingOtBlocks.length + openIssues.length + swapRequests.filter((r) => r.status === "pending").length} item(s) need attention`}
                    className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none"
                  >
                    {pendingOtBlocks.length + openIssues.length + swapRequests.filter((r) => r.status === "pending").length}
                  </span>
                )}
              </button>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-full px-2.5 py-1">
              {tab === "track" ? <UsersIcon size={11} /> : <Home size={11} />}
              {tab === "track" ? "Agent User" : "Dashboard User"}
            </span>
          )}
          {(onSwitchWorkspace || (tab === "track" && myUser) || (tab === "dashboard" && role)) && (
            <button
              title={backLabel}
              onClick={handleBack}
              className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-900"
            >
              <ArrowLeft size={15} />
            </button>
          )}
        </div>
      </div>

      {/* TRACK TAB */}
      {tab === "track" && (
        <div className={`p-4 sm:p-5 mx-auto ${trackView === "schedule" ? "max-w-4xl" : "max-w-md"}`}>
          {!myUser ? (
            <div className="pt-4 pb-6">
              <div
                className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center mx-auto mb-3"
                style={{ animation: "logoPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
              >
                <UserCheck size={22} className="text-sky-400" />
              </div>
              <p className="text-sm text-neutral-300 text-center mb-1">Employee sign-in</p>
              <p className="text-sm text-neutral-400 mb-4 text-center">Choose your name and enter your password</p>
              {Object.keys(users).length === 0 ? (
                <p className="text-xs text-neutral-500 text-center">No users yet. Ask your manager to add you from the dashboard.</p>
              ) : (
                <>
                  <div className="relative mb-3">
                    <select value={loginName} onChange={(e) => setLoginName(e.target.value)} className="w-full appearance-none bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500">
                      <option value="">Select your name</option>
                      {Object.keys(users).sort().map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <PasswordInput value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Password" className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <button onClick={handleLogin} className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0">Enter</button>
                  </div>
                  {loginError && <p className="mt-2 text-xs text-rose-400 text-center">{loginError}</p>}
                </>
              )}
            </div>
          ) : !myRecord ? (
            <div className="py-10 text-center">
              <p className="text-sm text-neutral-400 mb-4">Your user was removed. Contact your manager.</p>
              <button onClick={handleTrackLogout} className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-300 border border-neutral-700 rounded-lg px-3 py-1.5 hover:bg-neutral-900">
                <LogOut size={13} /> Choose a different name
              </button>
            </div>
          ) : myRecord.locked ? (
            <div className="py-10 text-center">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
                <Lock size={16} className="text-rose-400" />
              </div>
              <p className="text-sm text-neutral-300">Your access is locked.</p>
              <p className="text-xs text-neutral-500 mt-1 mb-4">Contact your manager to get it reopened.</p>
              <button onClick={handleTrackLogout} className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-300 border border-neutral-700 rounded-lg px-3 py-1.5 hover:bg-neutral-900">
                <LogOut size={13} /> Choose a different name
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor(myUser).bg} ${avatarColor(myUser).text}`}>
                    {myUser.trim()[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-neutral-200 truncate">{myUser}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button title={soundMuted ? "Unmute" : "Mute"} onClick={toggleSound} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                    {soundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1 mb-4">
                <div className="flex bg-neutral-900 rounded-lg p-1 gap-1">
                  <button
                    onClick={() => !myOtLiveState.active && setTrackView("shift")}
                    disabled={myOtLiveState.active}
                    title={myOtLiveState.active ? "Finish your overtime session first" : ""}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${trackView === "shift" ? "bg-neutral-800 text-neutral-50" : myOtLiveState.active ? "text-neutral-700 cursor-not-allowed" : "text-neutral-500"}`}
                  >
                    <Clock size={13} /> Shift
                  </button>
                  <button
                    onClick={() => canUseOvertime && setTrackView("overtime")}
                    disabled={!canUseOvertime}
                    title={!canUseOvertime ? "Finish your regular shift first" : ""}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${trackView === "overtime" ? "bg-neutral-800 text-neutral-50" : canUseOvertime ? "text-neutral-500" : "text-neutral-700 cursor-not-allowed"}`}
                  >
                    <Zap size={13} /> Overtime
                  </button>
                </div>
                <div className="flex bg-neutral-900 rounded-lg p-1 gap-1">
                  <button
                    onClick={() => setTrackView("schedule")}
                    className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${trackView === "schedule" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}
                  >
                    <LayoutGrid size={13} /> Schedule
                    {swapRequests.filter((r) => r.toName === myUser && r.status === "awaiting_colleague").length > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none">
                        {swapRequests.filter((r) => r.toName === myUser && r.status === "awaiting_colleague").length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setTrackView("dailytask")}
                    className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${trackView === "dailytask" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}
                  >
                    <StickyNote size={13} /> Daily Task
                    {myPendingTaskCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none">
                        {myPendingTaskCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              {myOtLiveState.active && trackView === "shift" && (
                <div className="mb-4 rounded-lg px-3 py-2 text-xs font-medium bg-amber-500/10 text-amber-400">
                  You have an active overtime session — finish it before starting a regular shift.
                </div>
              )}

              {trackView === "shift" && (
                <>
                  {showIntro && (
                    <div className="mb-5 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-xs font-medium text-neutral-200 flex items-center gap-1.5"><Info size={13} /> How this works</p>
                        <button onClick={dismissIntro} className="text-neutral-500 hover:text-neutral-300"><X size={14} /></button>
                      </div>
                      <ul className="text-[11px] text-neutral-500 space-y-1 mb-3">
                        <li><span className="text-neutral-300 font-medium">Available</span> — begin your shift, and this is also the button you tap to come back from a Meeting, a Task, or a Break</li>
                        <li><span className="text-neutral-300 font-medium">Meeting</span> / <span className="text-neutral-300 font-medium">Task</span> — still normal, counted work time, it just tells your manager and teammates what you're doing right now</li>
                        <li><span className="text-neutral-300 font-medium">Break</span> — step away, the clock pauses (has a time limit)</li>
                        <li><span className="text-neutral-300 font-medium">Finish</span> — end your shift for the day</li>
                      </ul>
                      <button onClick={dismissIntro} className="text-xs font-medium bg-neutral-100 text-neutral-900 px-3 py-1.5 rounded-lg">Got it</button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                      <p className="text-[10px] text-neutral-500 mb-0.5">Worked today</p>
                      <p className="text-sm font-mono text-neutral-200">{fmtDuration(liveWorkedMs)}</p>
                    </div>
                    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                      <p className="text-[10px] text-neutral-500 mb-0.5">This week</p>
                      <p className="text-sm font-mono text-neutral-200">{myWeekStats.shiftsCount} shift{myWeekStats.shiftsCount === 1 ? "" : "s"}</p>
                      {myWeekStats.otCount > 0 && (
                        <p className="text-[10px] font-mono text-amber-400">+{myWeekStats.otCount} OT shift{myWeekStats.otCount === 1 ? "" : "s"}</p>
                      )}
                    </div>
                    {(status === "working" || status === "on_break") && (
                      <>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                          <p className="text-[10px] text-neutral-500 mb-0.5">Break used (this shift)</p>
                          <p className="text-sm font-mono text-neutral-200">{fmtDuration(Math.max(0, liveElapsedMs - liveWorkedMs))}</p>
                        </div>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                          <p className="text-[10px] text-neutral-500 mb-0.5">Time remaining</p>
                          <p className={`text-sm font-mono ${liveElapsedMs >= standardMs ? "text-emerald-400" : "text-neutral-200"}`}>
                            {liveElapsedMs >= standardMs ? "Done" : fmtDuration(standardMs - liveElapsedMs)}
                          </p>
                        </div>
                        {(liveMeetingMs > 0 || activity === "meeting") && (
                          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                            <p className="text-[10px] text-neutral-500 mb-0.5">Meeting time (this shift)</p>
                            <p className={`text-sm font-mono ${activity === "meeting" ? "text-sky-400" : "text-neutral-200"}`}>{fmtDuration(liveMeetingMs)}</p>
                          </div>
                        )}
                        {(liveTaskMs > 0 || activity === "task") && (
                          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                            <p className="text-[10px] text-neutral-500 mb-0.5">Task time (this shift)</p>
                            <p className={`text-sm font-mono ${activity === "task" ? "text-violet-400" : "text-neutral-200"}`}>{fmtDuration(liveTaskMs)}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {(status === "working" || status === "on_break") && (() => {
                    const barColor =
                      status === "on_break" ? "bg-amber-500" : activity === "meeting" ? "bg-sky-500" : activity === "task" ? "bg-violet-500" : "bg-emerald-500";
                    const glow =
                      status === "on_break"
                        ? "shadow-[0_0_10px_rgba(245,158,11,0.6)]"
                        : activity === "meeting"
                        ? "shadow-[0_0_10px_rgba(14,165,233,0.6)]"
                        : activity === "task"
                        ? "shadow-[0_0_10px_rgba(139,92,246,0.6)]"
                        : "shadow-[0_0_10px_rgba(16,185,129,0.6)]";
                    const stateLabel = status === "on_break" ? " (on break)" : activity === "meeting" ? " (in a meeting)" : activity === "task" ? " (on a task)" : "";
                    return (
                      <div className="mb-5">
                        <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
                          <span>Toward {settings.standardHours}h{stateLabel}</span>
                          <span>{Math.min(100, Math.round((liveElapsedMs / standardMs) * 100))}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor} ${glow}`} style={{ width: `${Math.min(100, (liveElapsedMs / standardMs) * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })()}

                  {status === "on_break" && (
                    <div className={`mb-5 rounded-lg px-3 py-2 text-xs font-medium ${liveOvertime ? "bg-rose-500/10 text-rose-400" : breakLimitMs - totalBreakMsSoFar <= 5 * 60000 ? "bg-amber-500/10 text-amber-400" : "bg-amber-500/10 text-amber-400"}`}>
                      {liveOvertime
                        ? `On break for ${fmtDuration(liveBreakMs)} — over today's limit`
                        : breakLimitMs - totalBreakMsSoFar <= 5 * 60000
                        ? `Break limit almost up — ${fmtDuration(breakLimitMs - totalBreakMsSoFar)} left today`
                        : `On break for ${fmtDuration(liveBreakMs)}`}
                    </div>
                  )}
                  {activity === "meeting" && (
                    <div className="mb-5 rounded-lg px-3 py-2 text-xs font-medium bg-sky-500/10 text-sky-400">
                      In a meeting for {fmtDuration(currentMeetingMs)}
                    </div>
                  )}
                  {activity === "task" && (
                    <div className="mb-5 rounded-lg px-3 py-2 text-xs font-medium bg-violet-500/10 text-violet-400">
                      On a task for {fmtDuration(currentTaskMs)}
                    </div>
                  )}
                  {showReachedPrompt && (status === "working" || status === "on_break") && (
                    <div className="mb-5 rounded-lg px-3 py-2 bg-sky-500/10">
                      <p className="text-xs font-medium text-sky-400 mb-2">
                        You've reached {settings.standardHours}h{status === "on_break" ? " (including your open break)" : ""}. If there's no response, this shift auto-closes in {settings.graceMinutes} min{status === "on_break" ? ", ending your break too" : ""} (won't count as overtime). Need to keep working? Use the separate Overtime tab.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setShowReachedPrompt(false);
                            playClickSound("end");
                            if (status === "on_break") addEvent("break_end").then(() => addEvent("end"));
                            else if (activity === "meeting") addEvent("meeting_end").then(() => addEvent("end"));
                            else if (activity === "task") addEvent("task_end").then(() => addEvent("end"));
                            else addEvent("end");
                          }}
                          className="flex-1 bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          Finish now
                        </button>
                        <button onClick={snoozeReached} className="flex-1 border border-sky-800 text-sky-300 text-xs font-medium px-3 py-1.5 rounded-lg">I'm still here</button>
                      </div>
                    </div>
                  )}
                  {breakLocked && status !== "on_break" && status !== "finished" && (
                    <div className="mb-5 rounded-lg px-3 py-2 text-xs font-medium bg-rose-500/10 text-rose-400">
                      Break limit used — your break went over {settings.breakLimitMinutes} min, so break is locked for this shift.
                    </div>
                  )}

                  {restLocked ? (
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 py-6 px-4 text-center">
                      <p className="text-sm text-neutral-300 font-medium">You've finished your shift for today.</p>
                      <p className="text-xs text-neutral-500 mt-1">Check back later to start your next one.</p>
                    </div>
                  ) : BUTTONS.length === 0 ? (
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 py-6 px-4 text-center">
                      <p className="text-sm text-neutral-300 font-medium">You've finished your shift for today.</p>
                      <p className="text-xs text-neutral-500 mt-1">Need to keep working? Use the separate Overtime tab.</p>
                    </div>
                  ) : (
                    <div className={`grid gap-3 ${BUTTONS.length === 1 ? "grid-cols-1 max-w-[240px] mx-auto" : "grid-cols-2"}`}>
                      {BUTTONS.map((b) => {
                        const Icon = b.icon;
                        const c = COLOR[b.color];
                        return (
                          <button
                            key={b.type}
                            disabled={!b.enabled || saving}
                            onClick={() => {
                              if (b.type === "end" && !canFinishNow) {
                                setEarlyFinishReason("");
                                setShowEarlyFinishConfirm(true);
                                return;
                              }
                              if (b.type === "start") {
                                try {
                                  if (typeof Notification !== "undefined" && Notification.permission === "default") {
                                    Notification.requestPermission().catch(() => {});
                                  }
                                } catch (e) {}
                              }
                              playClickSound(b.type);
                              addEvent(b.type);
                            }}
                            className={`flex flex-col items-center justify-center gap-2 rounded-xl border py-5 sm:py-6 px-3 transition-all duration-150 active:scale-95 ${b.enabled ? "bg-neutral-900 border-neutral-800 hover:border-neutral-700" : "bg-neutral-900/40 border-neutral-900 opacity-30 cursor-not-allowed"}`}
                          >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${b.enabled ? c.soft : "bg-neutral-800"}`}>
                              <Icon size={18} className={b.enabled ? c.text : "text-neutral-600"} />
                            </div>
                            <span className="text-sm font-medium text-neutral-200">{b.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {showEarlyFinishConfirm && (
                    <div className="mt-3 rounded-lg px-3 py-2.5 bg-rose-500/10">
                      <p className="text-xs font-medium text-rose-400 mb-2">
                        You haven't reached {settings.standardHours}h yet ({fmtDuration(Math.max(0, standardMs - liveElapsedMs))} left). Leaving early — add a quick reason so your manager sees why:
                      </p>
                      <input
                        autoFocus
                        value={earlyFinishReason}
                        onChange={(e) => setEarlyFinishReason(e.target.value)}
                        placeholder="e.g. doctor's appointment"
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={!earlyFinishReason.trim() || saving}
                          onClick={() => {
                            playClickSound("end");
                            addEvent("end", { earlyLeave: true, note: earlyFinishReason.trim() });
                            setShowEarlyFinishConfirm(false);
                            setEarlyFinishReason("");
                          }}
                          className="flex-1 bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Confirm — leave now
                        </button>
                        <button onClick={() => { setShowEarlyFinishConfirm(false); setEarlyFinishReason(""); }} className="flex-1 border border-neutral-700 text-neutral-300 text-xs font-medium px-3 py-1.5 rounded-lg">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {error && <p className="mt-3 text-xs text-rose-400 text-center">{error}</p>}

                  {coworkersNow.length > 0 && (
                    <div className="mt-6 border-t border-neutral-800 pt-4">
                      <p className="text-xs text-neutral-500 mb-2">Working now</p>
                      <div className="flex flex-wrap gap-1.5">
                        {coworkersNow.map((c) => {
                          const b = personBadge(c.status, c.activity);
                          const dotCls =
                            c.status === "on_break" ? "bg-amber-400" : c.activity === "meeting" ? "bg-sky-400" : c.activity === "task" ? "bg-violet-400" : "bg-emerald-400";
                          return (
                            <span key={c.name} className="flex items-center gap-1.5 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-full px-2.5 py-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                              {c.name}
                              <span className="text-neutral-600">· {b.label}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {enriched.length > 0 && (
                    <div className="mt-6 border-t border-neutral-800 pt-4">
                      <p className="text-xs text-neutral-500 mb-2">This shift's log</p>
                      <div className="space-y-1.5">
                        {enriched.slice().reverse().map((ev) => {
                          const evDate = todayKey(new Date(ev.timestamp));
                          const isOtherDay = evDate !== todayKey();
                          return (
                            <div key={ev.id} className="flex items-center justify-between text-xs">
                              <span className="text-neutral-400">
                                {EVENT_LABEL[ev.type]}
                                {ev.byOwner && <span className="text-amber-400"> (set by owner)</span>}
                              </span>
                              <span className={`font-mono ${ev.overtime ? "text-rose-400 font-semibold" : "text-neutral-500"}`}>
                                {isOtherDay && <span className="text-neutral-600">{fmtDateShort(evDate)} · </span>}
                                {fmtTime(ev.timestamp)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {trackView === "overtime" && (
                <>
                  {(() => {
                    const weekOtMs = myWeekOtStats.approvedMs + myWeekOtStats.pendingMs;
                    const overCap = weekOtMs >= otCapMs;
                    const nearCap = !overCap && otCapMs > 0 && weekOtMs / otCapMs >= 0.8;
                    const lastBlock = myOtLiveState.blocks[myOtLiveState.blocks.length - 1];
                    const showLastStatus = !myOtLiveState.active && lastBlock && lastBlock.blockDate === todayKey();
                    return (
                      <>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 mb-3 text-center">
                          <p className="text-[10px] text-neutral-500 mb-1">{myOtLiveState.active ? "Overtime running" : "Overtime time today (approved)"}</p>
                          <p className="text-2xl font-mono text-amber-400">{fmtDuration(myOtLiveState.active ? myOtLiveState.liveMs : otWorkedMsForDate(myPersonEvents, todayKey()))}</p>
                          {showLastStatus && (
                            <span className={`inline-block mt-2 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                              lastBlock.status === "approved" ? "bg-emerald-500/10 text-emerald-400" : lastBlock.status === "denied" ? "bg-rose-500/10 text-rose-400" : "bg-neutral-800 text-neutral-400"
                            }`}>
                              {lastBlock.status === "approved" ? "Approved" : lastBlock.status === "denied" ? "Denied" : "Pending review"}
                            </span>
                          )}
                        </div>

                        <div className={`mb-5 rounded-lg px-3 py-2 text-xs font-medium ${overCap ? "bg-rose-500/10 text-rose-400" : nearCap ? "bg-amber-500/10 text-amber-400" : "bg-neutral-900 text-neutral-500"}`}>
                          This week: {fmtDuration(weekOtMs)} / {settings.otCapHours}h cap
                          {myWeekOtStats.pendingMs > 0 && <span> · {fmtDuration(myWeekOtStats.pendingMs)} awaiting approval</span>}
                          {overCap && <span> — over the usual cap, manager will see this</span>}
                        </div>

                        {showOtReachedPrompt && myOtLiveState.active && (
                          <div className="mb-5 rounded-lg px-3 py-2 bg-sky-500/10">
                            <p className="text-xs font-medium text-sky-400 mb-2">
                              This overtime session has run {settings.otMaxHours}h+. If there's no response, it auto-closes in {settings.graceMinutes} min.
                            </p>
                            <div className="flex gap-2">
                              <button onClick={() => { setShowOtReachedPrompt(false); playClickSound("ot_end"); addOtEvent("ot_end"); }} className="flex-1 bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg">Finish now</button>
                              <button onClick={snoozeOtReached} className="flex-1 border border-sky-800 text-sky-300 text-xs font-medium px-3 py-1.5 rounded-lg">I'm still here</button>
                            </div>
                          </div>
                        )}

                        {!myOtLiveState.active && (
                          <input
                            value={otReasonInput}
                            onChange={(e) => setOtReasonInput(e.target.value)}
                            placeholder="Reason (optional) — e.g. covering a deadline"
                            className="w-full mb-3 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                          />
                        )}

                        {myOtLiveState.active && myOtLiveState.activeBlock?.reason && (
                          <div className="mb-3 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-neutral-500 mb-0.5">Reason for this session</p>
                            <p className="text-sm text-neutral-200">{myOtLiveState.activeBlock.reason}</p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            disabled={myOtLiveState.active || saving}
                            onClick={() => { playClickSound("ot_start"); addOtEvent("ot_start", { reason: otReasonInput.trim() }); setOtReasonInput(""); }}
                            className={`flex flex-col items-center justify-center gap-2 rounded-xl border py-6 px-3 transition-all active:scale-95 ${!myOtLiveState.active ? "bg-neutral-900 border-neutral-800 hover:border-neutral-700" : "bg-neutral-900/40 border-neutral-900 opacity-30 cursor-not-allowed"}`}
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/10">
                              <Play size={18} className="text-amber-400" />
                            </div>
                            <span className="text-sm font-medium text-neutral-200">Start Overtime</span>
                          </button>
                          <button
                            disabled={!myOtLiveState.active || saving}
                            onClick={() => { playClickSound("ot_end"); addOtEvent("ot_end"); }}
                            className={`flex flex-col items-center justify-center gap-2 rounded-xl border py-6 px-3 transition-all active:scale-95 ${myOtLiveState.active ? "bg-neutral-900 border-neutral-800 hover:border-neutral-700" : "bg-neutral-900/40 border-neutral-900 opacity-30 cursor-not-allowed"}`}
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-rose-500/10">
                              <Square size={18} className="text-rose-400" />
                            </div>
                            <span className="text-sm font-medium text-neutral-200">End Overtime</span>
                          </button>
                        </div>
                        {error && <p className="mt-3 text-xs text-rose-400 text-center">{error}</p>}
                        <p className="mt-4 text-[11px] text-neutral-600 text-center">No password needed — every session is visible to your manager, who approves or denies it. Only approved time counts as paid overtime.</p>
                      </>
                    );
                  })()}
                </>
              )}

              {trackView === "schedule" && (
                <div>
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 mb-3 text-center">
                    <p className="text-[10px] text-neutral-500 mb-1">Your annual leave balance</p>
                    <p className="text-lg font-semibold text-violet-300">{myRecord?.annualLeaveBalance ?? DEFAULT_ANNUAL_LEAVE_BALANCE} days left</p>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <button onClick={() => setMyScheduleWeekOffset((o) => o - 1)} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                      <ChevronDown size={14} className="rotate-90" />
                    </button>
                    <p className="text-xs font-medium text-neutral-300 flex-1 text-center">
                      {(() => {
                        const ref = new Date();
                        ref.setDate(ref.getDate() + myScheduleWeekOffset * 7);
                        const dates = weekDatesSat(ref);
                        return `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[6])}`;
                      })()}
                    </p>
                    <button onClick={() => setMyScheduleWeekOffset((o) => o + 1)} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                      <ChevronDown size={14} className="-rotate-90" />
                    </button>
                  </div>

                  {swapForCell && (() => {
                    const [, sdate] = swapForCell.split("|");
                    const colleagues = Object.keys(users).filter((n) => n !== myUser);
                    const myEntry = schedule[`${myUser}|${sdate}`];
                    const myDayIsOff = myEntry?.kind === "status" && myEntry.status === "off";
                    const theirEntry = swapTargetName ? schedule[`${swapTargetName}|${sdate}`] : null;
                    const theirDayIsOff = theirEntry?.kind === "status" && theirEntry.status === "off";
                    const needsSecondDate = !!swapTargetName && myDayIsOff !== theirDayIsOff;
                    // Whoever is "giving up" an OFF day on the first date must "get one back" from
                    // the other person's existing OFF days, so nobody's OFF-day count changes.
                    const secondDatePool = needsSecondDate
                      ? myDayIsOff
                        ? getOffDates(swapTargetName, sdate) // colleague's OFF days
                        : getOffDates(myUser, sdate) // my own OFF days
                      : [];

                    const submitSwap = async () => {
                      if (!swapTargetName) return;
                      if (needsSecondDate && !swapSecondDate) return;
                      const dates = needsSecondDate ? [sdate, swapSecondDate] : [sdate];
                      const req = { id: Date.now(), fromName: myUser, toName: swapTargetName, dates, status: "awaiting_colleague", requestedAt: Date.now() };
                      const ok = await saveSwapRequests([...swapRequests, req]);
                      if (!ok) { setError("Could not send the request, try again."); return; }
                      setSwapForCell(null);
                      setSwapTargetName("");
                      setSwapSecondDate("");
                      showToast(`Swap request sent to ${swapTargetName}`);
                    };

                    return (
                      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 mb-3">
                        <p className="text-xs text-neutral-400 mb-2">Request a swap for {fmtDateLabel(sdate)} with:</p>
                        <select
                          value={swapTargetName}
                          onChange={(e) => { setSwapTargetName(e.target.value); setSwapSecondDate(""); }}
                          className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none mb-2"
                        >
                          <option value="">Choose a colleague...</option>
                          {colleagues.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>

                        {needsSecondDate && (
                          <div className="mb-2 bg-amber-500/5 border border-amber-900/40 rounded-lg p-2.5">
                            <p className="text-[11px] text-amber-400 mb-1.5">
                              {fmtDateLabel(sdate)} is {myDayIsOff ? "your" : `${swapTargetName}'s`} OFF day. To keep everyone at 2 OFF days, also swap one of {myDayIsOff ? swapTargetName : "your"} OFF days:
                            </p>
                            {secondDatePool.length === 0 ? (
                              <p className="text-[11px] text-neutral-500">No other OFF day found to pair with — can't complete this swap.</p>
                            ) : (
                              <select value={swapSecondDate} onChange={(e) => setSwapSecondDate(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 outline-none">
                                <option value="">Choose a day...</option>
                                {secondDatePool.map((d) => (
                                  <option key={d} value={d}>{fmtDateLabel(d)}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            disabled={!swapTargetName || (needsSecondDate && !swapSecondDate)}
                            onClick={submitSwap}
                            className="flex-1 bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-40"
                          >
                            Send request
                          </button>
                          <button onClick={() => { setSwapForCell(null); setSwapTargetName(""); setSwapSecondDate(""); }} className="text-xs text-neutral-500 hover:text-neutral-300 px-3">
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full border-separate min-w-[620px]" style={{ borderSpacing: "3px" }}>
                      <thead>
                        <tr>
                          <th className="text-left text-[9px] font-medium text-neutral-500 px-1.5 pb-1 sticky left-0 bg-neutral-950">Agent</th>
                          {(() => {
                            const ref = new Date();
                            ref.setDate(ref.getDate() + myScheduleWeekOffset * 7);
                            return weekDatesSat(ref).map((d) => {
                              const isHoliday = publicHolidays.includes(d);
                              return (
                                <th key={d} className={`text-center text-[9px] font-medium px-1 pb-1 min-w-[68px] ${isHoliday ? "text-yellow-400" : "text-neutral-500"}`}>
                                  {new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                                  <br />
                                  <span className={isHoliday ? "text-yellow-500" : "text-neutral-600"}>{fmtDateShort(d)}</span>
                                </th>
                              );
                            });
                          })()}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(users).sort(compareByUserId).map((uname) => {
                          const ref = new Date();
                          ref.setDate(ref.getDate() + myScheduleWeekOffset * 7);
                          const dates = weekDatesSat(ref);
                          const isMe = uname === myUser;
                          const pub = publishedSchedule || {};
                          return (
                            <tr key={uname}>
                              <td className={`text-[11px] font-medium px-1.5 py-0.5 whitespace-nowrap sticky left-0 bg-neutral-950 ${isMe ? "text-emerald-400" : "text-neutral-300"}`}>
                                {uname}
                              </td>
                              {dates.map((d) => {
                                const key = `${uname}|${d}`;
                                const entry = pub[key];
                                let cellContent = <span className="text-neutral-700">—</span>;
                                let cellClass = "bg-neutral-900 border border-neutral-800";
                                if (entry?.kind === "status") {
                                  const s = SCHEDULE_STATUSES[entry.status];
                                  if (s) { cellContent = s.label; cellClass = `${s.bg} ${s.text}`; }
                                } else if (entry?.kind === "shift") {
                                  cellContent = entry.label;
                                  cellClass = "bg-emerald-900/40 border border-emerald-800 text-emerald-200";
                                }
                                return (
                                  <td key={d} className="p-0">
                                    {isMe && entry ? (
                                      <button
                                        onClick={() => setSwapForCell(key)}
                                        title="Tap to request a swap"
                                        className={`w-full h-7 rounded-md text-[10px] font-medium px-1 transition-colors hover:opacity-80 ${cellClass}`}
                                      >
                                        {cellContent}
                                      </button>
                                    ) : (
                                      <div className={`w-full h-7 rounded-md text-[10px] font-medium px-1 flex items-center justify-center ${cellClass}`}>
                                        {cellContent}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-neutral-600 mt-2">Tap a scheduled cell in your own row to request a swap with a colleague.</p>

                  {swapRequests.filter((r) => r.toName === myUser && r.status === "awaiting_colleague").length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-neutral-500 mb-2">Swap requests for you</p>
                      <div className="space-y-2">
                        {swapRequests
                          .filter((r) => r.toName === myUser && r.status === "awaiting_colleague")
                          .sort((a, b) => b.requestedAt - a.requestedAt)
                          .map((r) => (
                            <div key={r.id} className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5">
                              <p className="text-sm text-neutral-200 mb-2">
                                <span className="font-medium">{r.fromName}</span> wants to swap {r.dates.map((d) => fmtDateLabel(d)).join(" and ")} with you
                              </p>
                              <div className="flex gap-2">
                                <button
                                  onClick={async () => {
                                    const ok = await saveSwapRequests(swapRequests.map((x) => (x.id === r.id ? { ...x, status: "pending" } : x)));
                                    if (ok) showToast("Accepted — waiting for owner approval");
                                    else setError("Could not accept, try again.");
                                  }}
                                  className="flex items-center gap-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md px-2.5 py-1.5 hover:bg-emerald-500/20"
                                >
                                  <Check size={13} /> Accept
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = await saveSwapRequests(swapRequests.map((x) => (x.id === r.id ? { ...x, status: "rejected_by_colleague" } : x)));
                                    if (!ok) setError("Could not decline, try again.");
                                  }}
                                  className="flex items-center gap-1 text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-md px-2.5 py-1.5 hover:bg-rose-500/20"
                                >
                                  <X size={13} /> Decline
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {swapRequests.filter((r) => r.fromName === myUser).length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-neutral-500 mb-2">Your swap requests</p>
                      <div className="space-y-1.5">
                        {swapRequests
                          .filter((r) => r.fromName === myUser)
                          .sort((a, b) => b.requestedAt - a.requestedAt)
                          .slice(0, 8)
                          .map((r) => {
                            const badge =
                              r.status === "approved"
                                ? { label: "Approved", cls: "bg-emerald-500/10 text-emerald-400" }
                                : r.status === "rejected"
                                ? { label: "Rejected by owner", cls: "bg-rose-500/10 text-rose-400" }
                                : r.status === "rejected_by_colleague"
                                ? { label: "Declined", cls: "bg-rose-500/10 text-rose-400" }
                                : r.status === "awaiting_colleague"
                                ? { label: `Waiting on ${r.toName}`, cls: "bg-neutral-800 text-neutral-400" }
                                : { label: "Waiting on owner", cls: "bg-amber-500/10 text-amber-400" };
                            return (
                              <div key={r.id} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                                <p className="text-xs text-neutral-300">
                                  Swap with <span className="font-medium">{r.toName}</span> — {r.dates.map((d) => fmtDateLabel(d)).join(" and ")}
                                </p>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {trackView === "dailytask" && (
                <div>
                  {(() => {
                    const today = todayKey();
                    // Uses the live/current schedule (not the published snapshot) — task assignment
                    // should reflect the real current shift, including swaps the owner just approved,
                    // without waiting for a separate Publish.
                    const myShiftToday = schedule[`${myUser}|${today}`];
                    const shiftLabel = myShiftToday?.kind === "shift" ? myShiftToday.label : "";
                    const matchingRecurring = shiftLabel
                      ? recurringTasks.filter((t) => shiftLabel.startsWith(fmtTime12(t.time)))
                      : [];
                    const doneTodayIds = new Set(
                      recurringCompletions.filter((c) => c.name === myUser && c.date === today).map((c) => c.taskId)
                    );

                    const markOneOffDone = async (id) => {
                      const updated = dailyTasks.map((t) => (t.id === id ? { ...t, status: "done", doneAt: Date.now() } : t));
                      const ok = await saveDailyTasks(updated);
                      if (ok) showToast("Task marked done");
                    };
                    const markRecurringDone = async (taskId) => {
                      const updated = [...recurringCompletions, { id: Date.now(), taskId, name: myUser, date: today, doneAt: Date.now() }];
                      const ok = await saveRecurringCompletions(updated);
                      if (ok) showToast("Task marked done");
                    };

                    const rows = [
                      ...matchingRecurring.map((t) => ({
                        key: `r-${t.id}`,
                        text: t.text,
                        tag: `Today's ${shiftLabel} shift`,
                        done: doneTodayIds.has(t.id),
                        onDone: () => markRecurringDone(t.id),
                      })),
                      ...dailyTasks
                        .filter((t) => t.name === myUser)
                        .map((t) => ({
                          key: `o-${t.id}`,
                          text: t.text,
                          tag: null,
                          done: t.status === "done",
                          onDone: () => markOneOffDone(t.id),
                        })),
                    ];

                    if (rows.length === 0) return <p className="text-sm text-neutral-600">Nothing assigned right now.</p>;

                    return (
                      <div className="space-y-2">
                        {rows.map((row) => (
                          <div key={row.key} className={`border rounded-lg p-3 ${row.done ? "bg-neutral-900/50 border-neutral-800" : "bg-neutral-900 border-neutral-800"}`}>
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              {row.tag && <span className="text-[10px] font-medium bg-violet-500/10 text-violet-300 rounded-full px-2 py-0.5">{row.tag}</span>}
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ml-auto ${row.done ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                                {row.done ? "Done" : "Pending"}
                              </span>
                            </div>
                            <p className={`text-sm mb-2 ${row.done ? "text-neutral-400 line-through decoration-neutral-600" : "text-neutral-200"}`}>{row.text}</p>
                            {!row.done && (
                              <button onClick={row.onDone} className="flex items-center gap-1.5 text-xs font-medium bg-neutral-100 text-neutral-900 rounded-lg px-3 py-1.5">
                                <Check size={13} /> Mark as done
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* DASHBOARD LOGIN — per-account, owner-managed (no email/verification). First person ever
          becomes the owner; everyone else needs the owner to add their account first
          (Users tab → Dashboard). */}
      {tab === "dashboard" && !role && (
        <div className="p-4 sm:p-5">
          <div className="max-w-sm mx-auto pt-8 pb-8 text-center">
            <div
              className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4"
              style={{ animation: "logoPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
            >
              <Lock size={20} className="text-emerald-400" />
            </div>
            {Object.keys(dashboardUsers).length === 0 ? (
              <>
                <p className="text-sm text-neutral-400 mb-1">Set up the Dashboard</p>
                <p className="text-xs text-neutral-600 mb-4">Nobody's set up Dashboard access for this workspace yet. Do it now — you'll be the owner.</p>
                <div className="text-left space-y-2">
                  {dashLoginError && <p className="text-xs text-rose-400">{dashLoginError}</p>}
                  <input value={dashLoginName} onChange={(e) => setDashLoginName(e.target.value)} placeholder="Your name" className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                  <PasswordInput value={dashLoginPassword} onChange={(e) => setDashLoginPassword(e.target.value)} placeholder="Choose a password" className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                  <button onClick={handleSetupFirstDashOwner} className="w-full bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg">Create owner account</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-neutral-400 mb-3">Dashboard access</p>
                <div className="text-left space-y-2">
                  {dashLoginError && <p className="text-xs text-rose-400">{dashLoginError}</p>}
                  <input
                    value={dashLoginName}
                    onChange={(e) => setDashLoginName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDashboardLogin()}
                    placeholder="Your name"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                  />
                  <PasswordInput
                    value={dashLoginPassword}
                    onChange={(e) => setDashLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDashboardLogin()}
                    placeholder="Password"
                    className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                  />
                  <button onClick={handleDashboardLogin} className="w-full bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg">Log in</button>
                </div>
                <p className="mt-4 text-[11px] text-neutral-600">Don't have access yet? Ask the owner to add you from Users → Dashboard.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* DASHBOARD */}
      {tab === "dashboard" && role && (
        <div className="p-4 sm:p-5">
          <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex flex-wrap bg-neutral-900 rounded-lg p-1 gap-1">
              {[
                canSeeTab("overview") && { key: "overview", label: "Overview", icon: Home, badge: openIssues.length },
                canSeeTab("approvals") && { key: "approvals", label: "Approvals", icon: ShieldQuestion, badge: pendingOtBlocks.length + swapRequests.filter((r) => r.status === "pending").length },
                canSeeTab("users") && { key: "users", label: "Users", icon: UsersIcon },
                canSeeTab("actions") && { key: "actions", label: "Actions", icon: Zap },
                canSeeTab("report") && { key: "report", label: "Report", icon: BarChart3 },
                canSeeTab("summary") && { key: "summary", label: "Summary", icon: CalendarRange },
                canSeeTab("schedule") && { key: "schedule", label: "Schedule", icon: LayoutGrid },
                canSeeTab("dailytask") && { key: "dailytask", label: "Daily Task", icon: StickyNote },
                canSeeTab("settings") && { key: "settings", label: "Settings", icon: SettingsIcon },
                canSeeTab("activity") && { key: "activity", label: "Activity", icon: ActivityIcon },
              ].filter(Boolean).map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => handleTabChange(t.key)} className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${dashTab === t.key ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
                    <Icon size={13} />
                    {t.label}
                    {!!t.badge && (
                      <span
                        title={`${t.badge} item(s) need attention`}
                        className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none"
                      >
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-neutral-500">{liveCounts.working} working · {liveCounts.onBreak} on break · {liveCounts.onOt} on OT</span>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] text-neutral-600 px-2">{myDashUser} · {role === "owner" ? "Owner" : "Member"}</span>
            </div>
          </div>

          {dashError && <p className="mb-3 text-xs text-rose-400">{dashError}</p>}

          {/* OVERVIEW */}
          {dashTab === "overview" && (
            <div className="max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-neutral-500">Today at a glance — {fmtDateLabel(todayKey())}</p>
                <div className="flex items-center gap-2 text-[11px] text-neutral-600">
                  <span>
                    Updated {now - lastRefreshedAt < 3000 ? "just now" : `${Math.floor((now - lastRefreshedAt) / 1000)}s ago`}
                    {settings.overviewRefreshSeconds > 0 && ` · auto-refreshes every ${settings.overviewRefreshSeconds}s`}
                  </span>
                  <button onClick={() => loadAll()} title="Refresh now" className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Working now</p>
                  <p className="text-lg font-semibold text-emerald-400">{liveCounts.working}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">In a meeting</p>
                  <p className="text-lg font-semibold text-sky-400">{liveCounts.inMeeting}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">On a task</p>
                  <p className="text-lg font-semibold text-violet-400">{liveCounts.onTask}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">On break</p>
                  <p className="text-lg font-semibold text-amber-400">{liveCounts.onBreak}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Worked today</p>
                  <p className="text-lg font-semibold text-neutral-100">{todaySnapshot.totalWorkedMs ? fmtDuration(todaySnapshot.totalWorkedMs) : "—"}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Overtime today</p>
                  <p className={`text-lg font-semibold ${todaySnapshot.totalOvertimeMs > 0 ? "text-amber-400" : "text-neutral-100"}`}>{todaySnapshot.totalOvertimeMs ? fmtDuration(todaySnapshot.totalOvertimeMs) : "—"}</p>
                </div>
              </div>

              {openIssues.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-900/40 rounded-xl p-4 mb-4">
                  <p className="text-xs text-rose-400 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {openIssues.length} unclosed shift{openIssues.length > 1 ? "s" : ""} need attention</p>
                  <div className="space-y-1.5">
                    {openIssues.slice(0, 5).map((issue) => (
                      <div key={issue.name + issue.date} className="flex items-center justify-between text-xs">
                        <span className="text-neutral-300">{issue.name} <span className="text-neutral-600">— {fmtDateShort(issue.date)}</span></span>
                        {role === "owner" && (
                          <button onClick={() => forceUserState(issue.name, "finish", new Date(issue.date + "T23:59:00").getTime())} className="text-amber-400 hover:text-amber-300 font-medium">Close out now</button>
                        )}
                      </div>
                    ))}
                    {openIssues.length > 5 && <p className="text-[11px] text-neutral-600">+{openIssues.length - 5} more — see Report</p>}
                  </div>
                </div>
              )}

              {activeUsersProgress.length === 0 ? (
                <div className="py-8 text-center text-neutral-600 text-sm">No one is working right now</div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-500 mb-1">Live progress</p>
                  {activeUsersProgress.map((p) => {
                    const pct = Math.min(100, (p.liveElapsedMs / standardMs) * 100);
                    const ac = avatarColor(p.name);
                    const pr = presence[p.name];
                    const confirmedAt = pr?.lastConfirmedAt || 0;
                    const missedAt = pr?.lastMissedAt || 0;
                    const presenceNote =
                      missedAt > confirmedAt
                        ? { text: `Missed last check (${fmtDuration(now - missedAt)} ago)`, cls: "text-amber-500" }
                        : confirmedAt
                        ? { text: `Last check-in: ${fmtDuration(now - confirmedAt)} ago`, cls: "text-neutral-600" }
                        : null;
                    const pBadge = personBadge(p.status, p.activity);
                    return (
                      <button key={p.name} onClick={() => goToPersonReport(p.name)} className="w-full text-left bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold ${ac.bg} ${ac.text}`}>{p.name.trim()[0].toUpperCase()}</div>
                            <span className="text-sm font-medium text-neutral-200">{p.name}</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${pBadge.cls}`}>
                              {pBadge.label}
                            </span>
                            {p.otActive && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap bg-amber-500/10 text-amber-400">OT</span>}
                          </div>
                          <span className="text-xs font-mono text-neutral-400 shrink-0">{fmtDuration(p.liveElapsedMs)}</span>
                        </div>
                        <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden mb-1.5">
                          <div
                            className={`h-full rounded-full transition-all ${
                              p.status === "on_break"
                                ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"
                                : p.activity === "meeting"
                                ? "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.6)]"
                                : p.activity === "task"
                                ? "bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]"
                                : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {presenceNote && <p className={`text-[10px] ${presenceNote.cls}`}>{presenceNote.text}</p>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* DAY SUMMARY — pick any date to see who worked that day, from–to, and how many
                  meetings/tasks/breaks each person had. */}
              <div className="mt-6 pt-5 border-t border-neutral-800">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-neutral-500">
                    Day summary — {Object.keys(overviewDaySummary).length} {Object.keys(overviewDaySummary).length === 1 ? "person" : "people"} worked
                  </p>
                  <div className="relative">
                    <select value={overviewDate} onChange={(e) => setOverviewDate(e.target.value)} className="appearance-none bg-neutral-900 border border-neutral-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 outline-none">
                      {availableDates.map((d) => (
                        <option key={d} value={d}>{fmtDateLabel(d)}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                  </div>
                </div>

                {Object.keys(overviewDaySummary).length === 0 ? (
                  <div className="py-8 text-center text-neutral-600 text-sm">No one worked on {fmtDateLabel(overviewDate)}</div>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(overviewDaySummary)
                      .sort(([a], [b]) => compareByUserId(a, b))
                      .map(([name, s]) => {
                        const ac = avatarColor(name);
                        return (
                          <button key={name} onClick={() => goToPersonReport(name)} className="w-full text-left bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold ${ac.bg} ${ac.text}`}>{name.trim()[0].toUpperCase()}</div>
                                <span className="text-sm font-medium text-neutral-200 truncate">{name}</span>
                              </div>
                              <span className="text-xs font-mono text-neutral-400 shrink-0">
                                {s.start ? fmtTime(s.start) : "—"} – {s.end ? fmtTime(s.end) : s.stillOpen ? "now" : "—"}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-center">
                              <div>
                                <p className="text-[10px] text-neutral-500">Worked</p>
                                <p className="text-xs font-mono text-neutral-200">{s.workedMs ? fmtDuration(s.workedMs) : s.stillOpen ? "live" : "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-neutral-500">Meetings</p>
                                <p className="text-xs font-mono text-sky-300">{s.meetings.length || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-neutral-500">Tasks</p>
                                <p className="text-xs font-mono text-violet-300">{s.tasks.length || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-neutral-500">Breaks</p>
                                <p className="text-xs font-mono text-amber-300">{s.breaks.length || "—"}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* APPROVALS (owner only) — every action-needed item lives here and nowhere else:
              overtime sessions awaiting a decision, and shift-swap requests. */}
          {dashTab === "approvals" && canSeeTab("approvals") && (
            <div className="max-w-2xl">
              <div className="flex bg-neutral-900 rounded-lg p-1 gap-1 mb-4 w-fit">
                <button
                  onClick={() => setApprovalsSubTab("pending")}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${approvalsSubTab === "pending" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}
                >
                  Pending
                  {pendingOtBlocks.length + swapRequests.filter((r) => r.status === "pending").length > 0 && (
                    <span className="ml-0.5 text-[10px] font-bold text-rose-400">
                      {pendingOtBlocks.length + swapRequests.filter((r) => r.status === "pending").length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setApprovalsSubTab("approved")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md ${approvalsSubTab === "approved" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}
                >
                  Approved
                </button>
              </div>

              {approvalsSubTab === "pending" ? (
                pendingOtBlocks.length === 0 && swapRequests.filter((r) => r.status === "pending").length === 0 ? (
                  <p className="text-sm text-neutral-600">Nothing needs your approval right now.</p>
                ) : (
                  <>
                    {pendingOtBlocks.length > 0 && (
                      <div className="bg-amber-500/5 border border-amber-900/40 rounded-xl p-4 mb-4">
                        <p className="text-xs text-amber-400 mb-2 flex items-center gap-1.5"><Zap size={12} /> {pendingOtBlocks.length} overtime session{pendingOtBlocks.length > 1 ? "s" : ""} awaiting your review</p>
                        <div className="space-y-2">
                          {pendingOtBlocks.map((b) => (
                            <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-neutral-300 min-w-0 truncate">
                                {b.name} <span className="text-neutral-600">— {fmtDateShort(b.blockDate)}, {fmtDuration(b.end - b.start)}</span>
                                {b.reason && <span className="text-neutral-600 italic"> "{b.reason}"</span>}
                              </span>
                              <div className="flex gap-1.5 shrink-0">
                                <button onClick={() => recordOtDecision(b.name, b.id, "ot_approve")} className="text-emerald-400 hover:text-emerald-300 font-medium">Approve</button>
                                <button onClick={() => recordOtDecision(b.name, b.id, "ot_deny")} className="text-rose-400 hover:text-rose-300 font-medium">Deny</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {swapRequests.filter((r) => r.status === "pending").length > 0 && (
                      <div>
                        <p className="text-xs text-neutral-500 mb-2">Pending swap requests</p>
                        <div className="space-y-2">
                          {swapRequests.filter((r) => r.status === "pending").map((r) => {
                            const describe = (name, date) => {
                              const e = schedule[`${name}|${date}`];
                              if (!e) return "no shift set";
                              if (e.kind === "status") return SCHEDULE_STATUSES[e.status]?.label || e.status;
                              return e.label;
                            };
                            const applySwapDates = (updatedSchedule) => {
                              r.dates.forEach((d) => {
                                const key1 = `${r.fromName}|${d}`;
                                const key2 = `${r.toName}|${d}`;
                                const e1 = updatedSchedule[key1];
                                const e2 = updatedSchedule[key2];
                                if (e2) updatedSchedule[key1] = e2; else delete updatedSchedule[key1];
                                if (e1) updatedSchedule[key2] = e1; else delete updatedSchedule[key2];
                              });
                            };
                            return (
                              <div key={r.id} className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5">
                                {r.dates.map((d) => (
                                  <div key={d} className="mb-1.5 last:mb-2">
                                    <p className="text-xs text-neutral-500 mb-0.5">{fmtDateLabel(d)}</p>
                                    <p className="text-sm text-neutral-200">
                                      <span className="font-medium">{r.fromName}</span> <span className="text-neutral-500">({describe(r.fromName, d)})</span> ⇄ <span className="font-medium">{r.toName}</span> <span className="text-neutral-500">({describe(r.toName, d)})</span>
                                    </p>
                                  </div>
                                ))}
                                <div className="flex gap-2 mt-1">
                                  <button
                                    onClick={async () => {
                                      const updatedSchedule = { ...schedule };
                                      applySwapDates(updatedSchedule);
                                      const ok = await saveSchedule(updatedSchedule);
                                      if (!ok) { setDashError("Could not update the schedule, try again."); return; }
                                      await saveSwapRequests(swapRequests.map((x) => (x.id === r.id ? { ...x, status: "approved" } : x)));
                                      addAudit(`Approved shift swap between "${r.fromName}" and "${r.toName}" for ${r.dates.map((d) => fmtDateLabel(d)).join(" and ")}`);
                                    }}
                                    className="flex items-center gap-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md px-2.5 py-1.5 hover:bg-emerald-500/20"
                                  >
                                    <Check size={13} /> Approve
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const ok = await saveSwapRequests(swapRequests.map((x) => (x.id === r.id ? { ...x, status: "rejected" } : x)));
                                      if (!ok) setDashError("Could not reject, try again.");
                                    }}
                                    className="flex items-center gap-1 text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-md px-2.5 py-1.5 hover:bg-rose-500/20"
                                  >
                                    <X size={13} /> Reject
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : resolvedOtBlocks.length === 0 && swapRequests.filter((r) => r.status !== "pending").length === 0 ? (
                <p className="text-sm text-neutral-600">Nothing decided yet.</p>
              ) : (
                <>
                  {resolvedOtBlocks.length > 0 && (
                    <div className="mb-5">
                      <p className="text-xs text-neutral-500 mb-2 flex items-center gap-1.5"><Zap size={12} className="text-amber-400" /> Overtime decisions</p>
                      <div className="space-y-1.5">
                        {resolvedOtBlocks.map((b) => (
                          <div key={b.id} className="flex items-center justify-between gap-2 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                            <span className="text-xs text-neutral-300 min-w-0 truncate">
                              {b.name} <span className="text-neutral-600">— {fmtDateShort(b.blockDate)}, {fmtDuration(b.end - b.start)}</span>
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${b.status === "approved" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                                {b.status === "approved" ? "Approved" : "Denied"}
                              </span>
                              <button
                                onClick={() => recordOtDecision(b.name, b.id, b.status === "approved" ? "ot_deny" : "ot_approve")}
                                title="Made a mistake? Flip this decision"
                                className="text-[10px] font-medium text-neutral-500 hover:text-neutral-300 underline"
                              >
                                {b.status === "approved" ? "Deny instead" : "Approve instead"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {swapRequests.filter((r) => r.status === "approved" || r.status === "rejected" || r.status === "rejected_by_colleague").length > 0 && (
                    <div>
                      <p className="text-xs text-neutral-500 mb-2">Swap decisions</p>
                      <div className="space-y-1.5">
                        {swapRequests
                          .filter((r) => r.status === "approved" || r.status === "rejected" || r.status === "rejected_by_colleague")
                          .sort((a, b) => b.requestedAt - a.requestedAt)
                          .map((r) => {
                            const flipSwapDecision = async () => {
                              // Approving swaps the cells for every date in the request; reversing that
                              // decision swaps them back (and vice versa to force-approve one later).
                              const updatedSchedule = { ...schedule };
                              r.dates.forEach((d) => {
                                const key1 = `${r.fromName}|${d}`;
                                const key2 = `${r.toName}|${d}`;
                                const e1 = updatedSchedule[key1];
                                const e2 = updatedSchedule[key2];
                                if (e2) updatedSchedule[key1] = e2; else delete updatedSchedule[key1];
                                if (e1) updatedSchedule[key2] = e1; else delete updatedSchedule[key2];
                              });
                              const ok = await saveSchedule(updatedSchedule);
                              if (!ok) { setDashError("Could not update the schedule, try again."); return; }
                              const newStatus = r.status === "approved" ? "rejected" : "approved";
                              const statusOk = await saveSwapRequests(swapRequests.map((x) => (x.id === r.id ? { ...x, status: newStatus } : x)));
                              if (!statusOk) { setDashError("Schedule updated, but the request status couldn't be saved — try again."); return; }
                              addAudit(`${newStatus === "approved" ? "Approved" : "Reversed"} shift swap between "${r.fromName}" and "${r.toName}" for ${r.dates.map((d) => fmtDateLabel(d)).join(" and ")}`);
                            };
                            const badge =
                              r.status === "approved"
                                ? { label: "Approved", cls: "bg-emerald-500/10 text-emerald-400" }
                                : r.status === "rejected"
                                ? { label: "Rejected by owner", cls: "bg-rose-500/10 text-rose-400" }
                                : { label: "Declined by colleague", cls: "bg-rose-500/10 text-rose-400" };
                            return (
                              <div key={r.id} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                                <p className="text-xs text-neutral-300">
                                  <span className="font-medium">{r.fromName}</span> ⇄ <span className="font-medium">{r.toName}</span> — {r.dates.map((d) => fmtDateLabel(d)).join(" and ")}
                                </p>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                                  <button
                                    onClick={flipSwapDecision}
                                    title="Made a mistake? Flip this decision"
                                    className="text-[10px] font-medium text-neutral-500 hover:text-neutral-300 underline"
                                  >
                                    {r.status === "approved" ? "Undo" : "Approve instead"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* USERS (owner only) */}
          {dashTab === "users" && canSeeTab("users") && (
            <div>
              <div className="flex bg-neutral-900 rounded-lg p-1 gap-1 mb-4 max-w-xs">
                <button onClick={() => setUsersSubTab("agent")} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${usersSubTab === "agent" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
                  Agent User
                </button>
                <button onClick={() => setUsersSubTab("dashboard")} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${usersSubTab === "dashboard" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
                  Dashboard User
                </button>
              </div>

              {usersSubTab === "agent" && (
              <>
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4 max-w-md">
                <p className="text-xs text-neutral-500 mb-2">Add a new user</p>
                <div className="flex flex-col sm:flex-row gap-2 mb-2">
                  <input value={newUserId} onChange={(e) => setNewUserId(e.target.value)} placeholder="ID" className="w-24 shrink-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                  <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Name" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                  <PasswordInput value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Password" className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                </div>
                <button
                  onClick={async () => {
                    setDashError("");
                    const trimmed = newUserName.trim();
                    if (!trimmed || !newUserPassword.trim()) { setDashError("Enter a name and password."); return; }
                    if (users[trimmed]) { setDashError("That name already exists."); return; }
                    const updated = { ...users, [trimmed]: { id: newUserId.trim(), password: newUserPassword.trim(), locked: false, note: "", team: "", annualLeaveBalance: DEFAULT_ANNUAL_LEAVE_BALANCE } };
                    const ok = await saveUsers(updated, `Added user "${trimmed}"`);
                    if (ok) { setNewUserName(""); setNewUserId(""); setNewUserPassword(""); }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg"
                >
                  <Plus size={14} /> Add user
                </button>
              </div>

              <div className="max-w-md mb-3">
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                />
              </div>

              <div className="space-y-2 max-w-md">
                {Object.keys(users).length === 0 && <p className="text-sm text-neutral-600">No users yet.</p>}
                {Object.keys(users).length > 0 && Object.entries(users).filter(([uname]) => matchesSearch(uname)).length === 0 && (
                  <p className="text-sm text-neutral-600">No users match "{userSearch}".</p>
                )}
                {Object.entries(users).filter(([uname]) => matchesSearch(uname)).sort(([a], [b]) => compareByUserId(a, b)).map(([uname, rec]) => {
                  const info = userInfoByUser[uname] || { status: "not_started", activity: "available", todayWorkedMs: 0, lastEventTs: null };
                  const badge = personBadge(info.status, info.activity);
                  const canForceFinish = info.status === "working" || info.status === "on_break";
                  const ac = avatarColor(uname);
                  return (
                    <div key={uname} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button onClick={() => goToPersonReport(uname)} className="flex items-center gap-2 min-w-0 hover:opacity-80">
                            <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${ac.bg} ${ac.text}`}>
                              {uname.trim()[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-neutral-100 truncate">{uname}</span>
                            {rec.id && <span className="text-[10px] font-mono text-neutral-500 shrink-0">#{rec.id}</span>}
                          </button>
                          {rec.team && <span className="text-[10px] font-medium text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full whitespace-nowrap">{rec.team}</span>}
                          <span className="text-[10px] font-medium text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">{rec.annualLeaveBalance ?? DEFAULT_ANNUAL_LEAVE_BALANCE}d annual</span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                          {info.otActive && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-500/10 text-amber-400">On OT</span>}
                          {rec.locked && <span className="text-[10px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">Locked</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            title={rec.locked ? "Unlock" : "Lock"}
                            onClick={async () => {
                              const updated = { ...users, [uname]: { ...rec, locked: !rec.locked } };
                              await saveUsers(updated, `${rec.locked ? "Unlocked" : "Locked"} user "${uname}"`);
                            }}
                            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
                          >
                            {rec.locked ? <UserCheck size={14} /> : <UserX size={14} />}
                          </button>
                          <button title="Change password" onClick={() => { setEditingPwFor(editingPwFor === uname ? "" : uname); setPwEditValue(""); }} className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
                            <Key size={14} />
                          </button>
                          <button title="Note" onClick={() => { setEditingNoteFor(editingNoteFor === uname ? "" : uname); setNoteEditValue(rec.note || ""); }} className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
                            <StickyNote size={14} />
                          </button>
                          <button title="ID" onClick={() => { setEditingIdFor(editingIdFor === uname ? "" : uname); setIdEditValue(rec.id || ""); }} className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
                            <Hash size={14} />
                          </button>
                          <button title="Team" onClick={() => { setEditingTeamFor(editingTeamFor === uname ? "" : uname); setTeamEditValue(rec.team || ""); }} className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
                            <Tag size={14} />
                          </button>
                          <button title="Annual leave balance" onClick={() => { setEditingLeaveFor(editingLeaveFor === uname ? "" : uname); setLeaveEditValue(String(rec.annualLeaveBalance ?? DEFAULT_ANNUAL_LEAVE_BALANCE)); }} className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
                            <CalendarRange size={14} />
                          </button>
                          <button title="Delete" onClick={() => setConfirmDeleteFor(confirmDeleteFor === uname ? "" : uname)} className="p-1.5 rounded-md text-neutral-400 hover:text-rose-400 hover:bg-neutral-800">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                          <span>Today: <span className="text-neutral-300 font-mono">{info.todayWorkedMs ? fmtDuration(info.todayWorkedMs) : "—"}</span></span>
                          <span>Last active: <span className="text-neutral-300 font-mono">{info.lastEventTs ? (todayKey(new Date(info.lastEventTs)) === todayKey() ? fmtTime(info.lastEventTs) : fmtDateShort(todayKey(new Date(info.lastEventTs)))) : "never"}</span></span>
                        </div>
                        {canForceFinish && (
                          <button onClick={() => forceUserState(uname, "finish")} className="text-[11px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Force Finish now
                          </button>
                        )}
                      </div>

                      {rec.note && editingNoteFor !== uname && <p className="mt-2 text-[11px] text-neutral-500 italic">"{rec.note}"</p>}

                      {editingPwFor === uname && (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <PasswordInput value={pwEditValue} onChange={(e) => setPwEditValue(e.target.value)} placeholder="New password" className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                          <button
                            onClick={async () => {
                              if (!pwEditValue.trim()) return;
                              const updated = { ...users, [uname]: { ...rec, password: pwEditValue.trim() } };
                              const ok = await saveUsers(updated, `Changed password for "${uname}"`);
                              if (ok) setEditingPwFor("");
                            }}
                            className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      )}

                      {editingNoteFor === uname && (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <input value={noteEditValue} onChange={(e) => setNoteEditValue(e.target.value)} placeholder="e.g. On leave until Friday" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                          <button
                            onClick={async () => {
                              const updated = { ...users, [uname]: { ...rec, note: noteEditValue.trim() } };
                              const ok = await saveUsers(updated, `Updated note for "${uname}"`);
                              if (ok) setEditingNoteFor("");
                            }}
                            className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      )}

                      {editingTeamFor === uname && (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <input value={teamEditValue} onChange={(e) => setTeamEditValue(e.target.value)} placeholder="e.g. Support, Sales" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                          <button
                            onClick={async () => {
                              const updated = { ...users, [uname]: { ...rec, team: teamEditValue.trim() } };
                              const ok = await saveUsers(updated, `Updated team for "${uname}"`);
                              if (ok) setEditingTeamFor("");
                            }}
                            className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      )}

                      {editingLeaveFor === uname && (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <input
                            type="number"
                            value={leaveEditValue}
                            onChange={(e) => setLeaveEditValue(e.target.value)}
                            placeholder="Days"
                            className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                          />
                          <button
                            onClick={async () => {
                              const n = parseInt(leaveEditValue, 10);
                              if (Number.isNaN(n)) return;
                              const updated = { ...users, [uname]: { ...rec, annualLeaveBalance: n } };
                              const ok = await saveUsers(updated, `Set annual leave balance for "${uname}" to ${n} day(s)`);
                              if (ok) setEditingLeaveFor("");
                            }}
                            className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      )}

                      {editingIdFor === uname && (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <input
                            value={idEditValue}
                            onChange={(e) => setIdEditValue(e.target.value)}
                            placeholder="ID"
                            className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                          />
                          <button
                            onClick={async () => {
                              const updated = { ...users, [uname]: { ...rec, id: idEditValue.trim() } };
                              const ok = await saveUsers(updated, `Set ID for "${uname}" to "${idEditValue.trim()}"`);
                              if (ok) setEditingIdFor("");
                            }}
                            className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      )}

                      {confirmDeleteFor === uname && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 bg-rose-500/10 rounded-lg px-3 py-2">
                          <span className="text-xs text-rose-300">Delete {uname} permanently?</span>
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                const updated = { ...users };
                                delete updated[uname];
                                const ok = await saveUsers(updated, `Deleted user "${uname}"`);
                                if (ok) setConfirmDeleteFor("");
                              }}
                              className="text-xs font-medium text-rose-400"
                            >
                              Delete
                            </button>
                            <button onClick={() => setConfirmDeleteFor("")} className="text-xs text-neutral-400">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>
              )}

              {usersSubTab === "dashboard" && (
                <>
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4 max-w-md">
                    <p className="text-xs text-neutral-500 mb-2">Add a Dashboard user</p>
                    <p className="text-[11px] text-neutral-600 mb-3">They'll log in from the Dashboard side (not Agent), and only see the tabs you tick below.</p>
                    <div className="flex flex-col sm:flex-row gap-2 mb-2">
                      <input value={newDashUserId} onChange={(e) => setNewDashUserId(e.target.value)} placeholder="Name" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                      <PasswordInput value={newDashUserPassword} onChange={(e) => setNewDashUserPassword(e.target.value)} placeholder="Password" className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {DASH_TABS.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setNewDashUserPerms((p) => ({ ...p, [t.key]: !p[t.key] }))}
                          className={`text-[10px] font-medium px-2 py-1 rounded-full border cursor-pointer hover:border-neutral-600 transition-colors ${
                            newDashUserPerms[t.key] ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-neutral-950 border-neutral-800 text-neutral-600"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <button onClick={handleAddDashUser} className="w-full flex items-center justify-center gap-1.5 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg">
                      <Plus size={14} /> Add Dashboard user
                    </button>
                  </div>

                  <div className="space-y-2 max-w-md">
                    {Object.keys(dashboardUsers).length === 0 && <p className="text-sm text-neutral-600">No Dashboard users yet.</p>}
                    {Object.entries(dashboardUsers).sort(([a], [b]) => a.localeCompare(b)).map(([name, rec]) => {
                      const isEditing = editingDashPermsFor === name;
                      const perms = isEditing ? editingDashPerms : rec.permissions || {};
                      return (
                        <div key={name} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-neutral-100 truncate">{name}</span>
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${rec.role === "owner" ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-800 text-neutral-400"}`}>
                                {rec.role === "owner" ? "Owner" : "Member"}
                              </span>
                            </div>
                            {rec.role !== "owner" && (
                              <div className="flex items-center gap-2 shrink-0">
                                {!isEditing ? (
                                  <button onClick={() => { setEditingDashPermsFor(name); setEditingDashPerms(rec.permissions || {}); }} className="text-[11px] font-medium text-sky-400 hover:text-sky-300">
                                    Edit access
                                  </button>
                                ) : (
                                  <>
                                    <button onClick={() => handleSaveDashUserPerms(name, editingDashPerms)} className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300">Save</button>
                                    <button onClick={() => setEditingDashPermsFor("")} className="text-[11px] text-neutral-500 hover:text-neutral-300">Cancel</button>
                                  </>
                                )}
                                <button onClick={() => { setEditingDashPwFor(editingDashPwFor === name ? "" : name); setDashPwEditValue(""); }} className="text-[11px] font-medium text-amber-400 hover:text-amber-300">
                                  Reset password
                                </button>
                                <button onClick={() => handleRemoveDashUser(name)} className="text-[11px] font-medium text-rose-400 hover:text-rose-300">Remove</button>
                              </div>
                            )}
                          </div>
                          {editingDashPwFor === name && (
                            <div className="flex gap-2 mt-2 mb-1">
                              <PasswordInput value={dashPwEditValue} onChange={(e) => setDashPwEditValue(e.target.value)} placeholder="New password" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                              <button onClick={() => handleResetDashUserPassword(name, dashPwEditValue)} className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0">Save</button>
                            </div>
                          )}
                          {rec.role !== "owner" && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {DASH_TABS.map((t) => (
                                <button
                                  key={t.key}
                                  disabled={!isEditing}
                                  onClick={() => setEditingDashPerms((p) => ({ ...p, [t.key]: !p[t.key] }))}
                                  className={`text-[10px] font-medium px-2 py-1 rounded-full border transition-colors ${
                                    perms[t.key] ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-neutral-900 border-neutral-800 text-neutral-600"
                                  } ${isEditing ? "cursor-pointer hover:border-neutral-600" : "cursor-default opacity-70"}`}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ACTIONS — the owner can force any user directly into Available / Meeting / Task / Finish,
              regardless of what they're currently doing. */}
          {dashTab === "actions" && canSeeTab("actions") && (
            <div>
              <p className="text-xs text-neutral-500 mb-3">Force any user's current state directly — useful if someone forgot to press a button, or you need to override remotely.</p>

              <div className="max-w-md mb-3">
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                />
              </div>

              <div className="space-y-2 max-w-lg">
                {Object.keys(users).length === 0 && <p className="text-sm text-neutral-600">No users yet.</p>}
                {Object.entries(users).filter(([uname]) => matchesSearch(uname)).sort(([a], [b]) => compareByUserId(a, b)).map(([uname]) => {
                  const info = userInfoByUser[uname] || { status: "not_started", activity: "available" };
                  const badge = personBadge(info.status, info.activity);
                  const ac = avatarColor(uname);
                  const isAvailableNow = info.status === "working" && info.activity === "available";
                  const isMeetingNow = info.status === "working" && info.activity === "meeting";
                  const isTaskNow = info.status === "working" && info.activity === "task";
                  const canFinish = info.status === "working" || info.status === "on_break";
                  const FORCE_BUTTONS = [
                    { target: "available", label: "Available", icon: Play, color: "emerald", disabled: isAvailableNow },
                    { target: "meeting", label: "Meeting", icon: UsersIcon, color: "sky", disabled: isMeetingNow },
                    { target: "task", label: "Task", icon: StickyNote, color: "violet", disabled: isTaskNow },
                    { target: "finish", label: "Finish", icon: Square, color: "rose", disabled: !canFinish },
                  ];
                  return (
                    <div key={uname} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${ac.bg} ${ac.text}`}>
                          {uname.trim()[0].toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-neutral-100 truncate">{uname}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {FORCE_BUTTONS.map((b) => {
                          const Icon = b.icon;
                          const c = COLOR[b.color];
                          return (
                            <button
                              key={b.target}
                              disabled={b.disabled}
                              onClick={() => forceUserState(uname, b.target)}
                              title={`Force ${b.label}`}
                              className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2.5 transition-all active:scale-95 ${b.disabled ? "bg-neutral-900/40 border-neutral-900 opacity-30 cursor-not-allowed" : "bg-neutral-950 border-neutral-800 hover:border-neutral-700"}`}
                            >
                              <Icon size={14} className={b.disabled ? "text-neutral-600" : c.text} />
                              <span className="text-[10px] font-medium text-neutral-300">{b.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* REPORT */}
          {dashTab === "report" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4 max-w-2xl">
                <span className="text-xs text-neutral-500">{allNames.length} names on record</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search name..."
                    className="bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 outline-none focus:border-neutral-500 w-32"
                  />
                  {teams.length > 0 && (
                    <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none">
                      <option value="all">All teams</option>
                      {teams.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                      <option value="__unassigned__">Unassigned</option>
                    </select>
                  )}
                  <div className="relative">
                    <select value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="appearance-none bg-neutral-900 border border-neutral-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 outline-none">
                      {availableDates.map((d) => (
                        <option key={d} value={d}>{fmtDateLabel(d)}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                  </div>
                  <button onClick={() => setShowExportPanel((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 border border-neutral-700 rounded-lg px-3 py-1.5 hover:bg-neutral-900">
                    <Download size={13} /> Export CSV
                  </button>
                </div>
              </div>

              {/* TEAM SNAPSHOT */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 max-w-2xl">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">People tracked</p>
                  <p className="text-lg font-semibold text-neutral-100">{teamSnapshot.peopleCount}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Total worked</p>
                  <p className="text-lg font-semibold text-neutral-100">{teamSnapshot.totalWorkedMs ? fmtDuration(teamSnapshot.totalWorkedMs) : "—"}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Total overtime</p>
                  <p className={`text-lg font-semibold ${teamSnapshot.totalOvertimeMs > 0 ? "text-amber-400" : "text-neutral-100"}`}>{teamSnapshot.totalOvertimeMs ? fmtDuration(teamSnapshot.totalOvertimeMs) : "—"}</p>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Still open / over limit</p>
                  <p className="text-lg font-semibold text-neutral-100">
                    {teamSnapshot.stillOpenCount}<span className="text-neutral-600"> / </span>{teamSnapshot.overLimitCount}
                  </p>
                </div>
              </div>

              {showExportPanel && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4 max-w-2xl space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-[11px] text-neutral-500 mb-1">Date</p>
                      <select value={exportDateFilter} onChange={(e) => setExportDateFilter(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none">
                        <option value="all">All dates</option>
                        {availableDates.map((d) => (
                          <option key={d} value={d}>{fmtDateLabel(d)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-[11px] text-neutral-500 mb-1">Person</p>
                      <select value={exportPersonFilter} onChange={(e) => setExportPersonFilter(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none">
                        <option value="all">Everyone</option>
                        {allNames.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-[11px] text-neutral-500 mb-1">Format</p>
                      <select value={exportMode} onChange={(e) => setExportMode(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none">
                        <option value="summary">Summary (one row per day)</option>
                        <option value="activitySessions">Meetings & Tasks (one row per instance)</option>
                        <option value="otSessions">Overtime sessions (one row per session)</option>
                        <option value="full">Full log (every button press)</option>
                      </select>
                    </div>
                  </div>
                  {exportMode === "summary" && (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ["start", "Available"],
                        ["finish", "Finish"],
                        ["worked", "Worked"],
                        ["overtime", "Overtime"],
                        ["breaks", "Breaks"],
                        ["breakTime", "Break time"],
                        ["meetings", "Meetings"],
                        ["meetingTime", "Meeting time"],
                        ["tasks", "Tasks"],
                        ["taskTime", "Task time"],
                        ["overLimit", "Over limit"],
                        ["autoClosed", "Auto-closed"],
                        ["leftEarly", "Left early reason"],
                      ].map(([key, label]) => {
                        const active = exportCols[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setExportCols((c) => ({ ...c, [key]: !c[key] }))}
                            aria-pressed={active}
                            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                              active
                                ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                                : "bg-transparent text-neutral-400 border-neutral-700 hover:border-neutral-500 hover:text-neutral-300"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {exportMode === "activitySessions" && (
                    <p className="text-xs text-neutral-500">One row per Meeting or Task — each instance with its own start, end, and duration (e.g. meeting #1 vs meeting #2 on the same day). Nothing to configure.</p>
                  )}
                  {exportMode === "otSessions" && (
                    <p className="text-xs text-neutral-500">One row per overtime session — start, end, duration, reason, and approval status. Nothing to configure.</p>
                  )}
                  {exportMode === "full" && (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        [exportFullWork, setExportFullWork, "Work events (Available / Meeting / Task / Finish)"],
                        [exportFullBreaks, setExportFullBreaks, "Break events"],
                        [exportFullOvertime, setExportFullOvertime, "Overtime events"],
                      ].map(([active, setter, label]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setter((v) => !v)}
                          aria-pressed={active}
                          className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                            active
                              ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                              : "bg-transparent text-neutral-400 border-neutral-700 hover:border-neutral-500 hover:text-neutral-300"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      const dates = exportDateFilter === "all" ? availableDates : [exportDateFilter];
                      const filteredEvents = events.filter((e) => (exportPersonFilter === "all" || e.name === exportPersonFilter) && dates.includes(todayKey(new Date(e.timestamp))));
                      const csv =
                        exportMode === "summary"
                          ? toSummaryCSV(filteredEvents, dates, breakLimitMs, standardMs, exportCols)
                          : exportMode === "activitySessions"
                          ? toActivitySessionsCSV(filteredEvents, dates)
                          : exportMode === "otSessions"
                          ? toOtSessionsCSV(filteredEvents, dates)
                          : toFullLogCSV(filteredEvents, exportFullWork, exportFullBreaks, exportFullOvertime);
                      downloadCSV(csv, "attendance-export.csv");
                    }}
                    className="w-full flex items-center justify-center gap-1.5 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    <Download size={14} /> Download
                  </button>
                </div>
              )}

              {filteredSummaryEntries.length === 0 ? (
                <div className="py-12 text-center text-neutral-600 text-sm">No data for this day yet</div>
              ) : (
                <div className="space-y-2 max-w-2xl">
                  {filteredSummaryEntries.map(([person, s]) => {
                    const isPast = reportDate < todayKey();
                    const isOrphan = !users[person];
                    const isLiveShift = s.stillOpen && (userInfoByUser[person]?.status === "working" || userInfoByUser[person]?.status === "on_break");
                    const crossesMidnight = isLiveShift && s.start && todayKey(new Date(s.start)) !== todayKey();
                    // For the shift that's actually running right now, s.workedMs is frozen at 0 (nothing has
                    // closed yet) — pull the live, ticking figure instead so the owner isn't staring at "0m".
                    // For an open shift that ISN'T the live one (forgotten/orphaned, no finish recorded), we
                    // genuinely don't know how long it ran, so show "—" rather than a misleading "0m".
                    const workedDisplay = isLiveShift
                      ? fmtDuration(userInfoByUser[person]?.liveWorkedMs || 0)
                      : s.stillOpen
                      ? "—"
                      : fmtDuration(s.workedMs || 0);
                    const ac = avatarColor(person);
                    return (
                      <div key={person} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <button className="flex items-center gap-2 min-w-0" onClick={() => setExpandedPerson(expandedPerson === person ? "" : person)}>
                            <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${ac.bg} ${ac.text}`}>
                              {person.trim()[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-neutral-100 truncate">{person}</span>
                            {users[person]?.note && <StickyNote size={11} className="text-neutral-600 shrink-0" />}
                            <ChevronDown size={12} className={`text-neutral-500 shrink-0 transition-transform ${expandedPerson === person ? "rotate-180" : ""}`} />
                          </button>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isOrphan && <span className="text-[11px] font-medium text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full whitespace-nowrap">No active user</span>}
                            {s.overtimeCount > 0 && <span className="text-[11px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">over limit x{s.overtimeCount}</span>}
                            {s.hasForcedClose && <span className="text-[11px] font-medium text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full whitespace-nowrap">auto-closed</span>}
                            {s.hasEarlyLeave && <span title={s.earlyLeaveNote || ""} className="text-[11px] font-medium text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">left early{s.earlyLeaveNote ? `: ${s.earlyLeaveNote}` : ""}</span>}
                            {s.shiftCount > 1 && <span className="text-[11px] font-medium text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">{s.shiftCount} shifts</span>}
                            {isPast && s.stillOpen && !isLiveShift && role === "owner" && (
                              <button onClick={() => forceUserState(person, "finish", new Date(reportDate + "T23:59:00").getTime())} className="text-[11px] font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                                No finish recorded · Close out now
                              </button>
                            )}
                            {isPast && s.stillOpen && !isLiveShift && role !== "owner" && (
                              <span className="text-[11px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">No finish recorded</span>
                            )}
                            {s.stillOpen && isLiveShift && (
                              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                                {crossesMidnight ? "Still working (crosses into today)" : "Still working"}
                                {userInfoByUser[person]?.status === "on_break"
                                  ? " · on break"
                                  : userInfoByUser[person]?.activity === "meeting"
                                  ? " · in a meeting"
                                  : userInfoByUser[person]?.activity === "task"
                                  ? " · on a task"
                                  : ""}
                              </span>
                            )}
                            {s.overtimeMs > 0 && (
                              <span className="text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">+{fmtDuration(s.overtimeMs)} overtime</span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Available</p>
                            <p className="text-xs font-mono text-neutral-200">{s.start ? fmtTime(s.start) : "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Finish</p>
                            <p className="text-xs font-mono text-neutral-200">{s.end ? fmtTime(s.end) : "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Worked{isLiveShift ? " (live)" : ""}</p>
                            <p className={`text-xs font-mono ${isLiveShift ? "text-emerald-400" : "text-neutral-200"}`}>{workedDisplay}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Overtime</p>
                            <p className={`text-xs font-mono ${s.overtimeMs > 0 ? "text-amber-400" : "text-neutral-200"}`}>{s.overtimeMs > 0 ? fmtDuration(s.overtimeMs) : "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Breaks</p>
                            <p className="text-xs font-mono text-neutral-200">{s.breaks.length}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Break time</p>
                            <p className="text-xs font-mono text-neutral-200">{s.totalBreakMs ? fmtDuration(s.totalBreakMs) : "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Meetings</p>
                            <p className="text-xs font-mono text-sky-300">{s.meetings.length > 0 ? `${s.meetings.length} · ${fmtDuration(s.totalMeetingMs)}` : "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Tasks</p>
                            <p className="text-xs font-mono text-violet-300">{s.tasks.length > 0 ? `${s.tasks.length} · ${fmtDuration(s.totalTaskMs)}` : "—"}</p>
                          </div>
                        </div>
                        {s.otBlocks && s.otBlocks.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2">
                            <p className="text-[11px] text-neutral-500 flex items-center gap-1.5"><Zap size={11} className="text-amber-400" /> Overtime sessions</p>
                            {s.otBlocks.map((b) => (
                              <div key={b.id} className="bg-neutral-950/60 rounded-lg px-3 py-2">
                                <span className="text-xs text-neutral-300 font-mono">
                                  {fmtTime(b.start)} – {b.end ? fmtTime(b.end) : "…"}
                                  {b.end && <span className="text-neutral-500"> ({fmtDuration(b.end - b.start)})</span>}
                                  {b.forced && <span className="text-neutral-600"> (auto-closed)</span>}
                                </span>
                                {b.reason && <p className="mt-1 text-[11px] text-neutral-500 italic">"{b.reason}"</p>}
                              </div>
                            ))}
                          </div>
                        )}

                        {expandedPerson === person && (
                          <div className="mt-3 border-t border-neutral-800 pt-3 space-y-1.5">
                            {users[person]?.note && <p className="text-[11px] text-neutral-500 italic mb-1">"{users[person].note}"</p>}
                            {(() => {
                              const sorted = s.events.slice().sort((a, b) => a.timestamp - b.timestamp);
                              let openBreak = null;
                              let openMeeting = null;
                              let openTask = null;
                              let meetingIdx = 0;
                              let taskIdx = 0;
                              return sorted.map((ev, idx) => {
                                let durationLabel = "";
                                let isOver = false;
                                let seqLabel = "";
                                if (ev.type === "break_start") openBreak = ev.timestamp;
                                if (ev.type === "break_end" && openBreak) {
                                  const dur = ev.timestamp - openBreak;
                                  durationLabel = fmtDuration(dur);
                                  isOver = dur > breakLimitMs;
                                  openBreak = null;
                                }
                                if (ev.type === "meeting_start") { openMeeting = ev.timestamp; meetingIdx += 1; seqLabel = ` #${meetingIdx}`; }
                                if (ev.type === "meeting_end" && openMeeting) {
                                  durationLabel = fmtDuration(ev.timestamp - openMeeting);
                                  seqLabel = ` (meeting #${meetingIdx})`;
                                  openMeeting = null;
                                }
                                if (ev.type === "task_start") { openTask = ev.timestamp; taskIdx += 1; seqLabel = ` #${taskIdx}`; }
                                if (ev.type === "task_end" && openTask) {
                                  durationLabel = fmtDuration(ev.timestamp - openTask);
                                  seqLabel = ` (task #${taskIdx})`;
                                  openTask = null;
                                }
                                return (
                                  <div key={ev.id}>
                                    {idx > 0 && ev.type === "start" && <div className="h-px bg-neutral-800 my-2" />}
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-neutral-400">
                                        {EVENT_LABEL[ev.type]}
                                        {seqLabel}
                                        {ev.byOwner && <span className="text-amber-400"> (forced by owner)</span>}
                                        {!ev.byOwner && ev.forced && <span className="text-neutral-600"> (auto)</span>}
                                        {ev.earlyLeave && <span className="text-violet-400"> (left early{ev.note ? `: ${ev.note}` : ""})</span>}
                                        {durationLabel && <span className={isOver ? "text-rose-400" : "text-neutral-600"}> · {durationLabel}</span>}
                                      </span>
                                      <span className={`font-mono ${isOver ? "text-rose-400 font-semibold" : "text-neutral-500"}`}>{fmtTime(ev.timestamp)}</span>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                            {role === "owner" && isOrphan && (
                              <div className="pt-2 mt-2 border-t border-neutral-800">
                                {confirmPurgeFor === person ? (
                                  <div className="flex items-center justify-between bg-rose-500/10 rounded-lg px-3 py-2">
                                    <span className="text-xs text-rose-300">Delete all records for "{person}" permanently?</span>
                                    <div className="flex gap-2">
                                      <button onClick={() => purgeEventsFor(person)} className="text-xs font-medium text-rose-400">Delete</button>
                                      <button onClick={() => setConfirmPurgeFor("")} className="text-xs text-neutral-400">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setConfirmPurgeFor(person)} className="text-xs text-neutral-500 hover:text-rose-400 flex items-center gap-1">
                                    <Trash2 size={12} /> Delete all records for this name
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {(dailyTasks.length > 0 || recurringCompletions.length > 0) && (
                <div className="mt-6">
                  <p className="text-xs text-neutral-500 mb-2">Daily tasks</p>
                  <div className="space-y-1.5 max-w-2xl">
                    {[
                      ...dailyTasks.map((t) => ({
                        key: `o-${t.id}`,
                        name: t.name,
                        text: t.text,
                        status: t.status,
                        sortAt: t.doneAt || t.assignedAt,
                        sub: `Assigned ${new Date(t.assignedAt).toLocaleString()}${t.status === "done" ? ` · Done ${new Date(t.doneAt).toLocaleString()}` : ""}`,
                      })),
                      ...recurringCompletions.map((c) => {
                        const task = recurringTasks.find((t) => t.id === c.taskId);
                        return {
                          key: `r-${c.id}`,
                          name: c.name,
                          text: task ? `[${fmtTime12(task.time)}] ${task.text}` : "(deleted recurring task)",
                          status: "done",
                          sortAt: c.doneAt,
                          sub: `Done ${new Date(c.doneAt).toLocaleString()}`,
                        };
                      }),
                    ]
                      .sort((a, b) => b.sortAt - a.sortAt)
                      .map((row) => (
                        <div key={row.key} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs text-neutral-300 truncate">
                              <span className="font-medium">{row.name}</span> — {row.text}
                            </p>
                            <p className="text-[10px] text-neutral-600">{row.sub}</p>
                          </div>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${row.status === "done" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                            {row.status === "done" ? "Done" : "Pending"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SUMMARY */}
          {dashTab === "summary" && (
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="text-xs text-neutral-500">
                  {summaryPeriod === "week"
                    ? `Week of ${fmtDateShort(periodSummary.dates[0])} – ${fmtDateShort(periodSummary.dates[periodSummary.dates.length - 1])}`
                    : new Date(periodSummary.dates[0] + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search name..."
                    className="bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 outline-none focus:border-neutral-500 w-28"
                  />
                  {teams.length > 0 && (
                    <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none">
                      <option value="all">All teams</option>
                      {teams.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                      <option value="__unassigned__">Unassigned</option>
                    </select>
                  )}
                  <select value={summarySortBy} onChange={(e) => setSummarySortBy(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none">
                    <option value="hours">Sort: Hours</option>
                    <option value="shifts">Sort: Shifts</option>
                    <option value="name">Sort: Name</option>
                  </select>
                  <div className="flex bg-neutral-900 rounded-lg p-1 gap-1">
                    <button onClick={() => setSummaryPeriod("week")} className={`px-2.5 py-1 text-xs font-medium rounded-md ${summaryPeriod === "week" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>Week</button>
                    <button onClick={() => setSummaryPeriod("month")} className={`px-2.5 py-1 text-xs font-medium rounded-md ${summaryPeriod === "month" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>Month</button>
                  </div>
                </div>
              </div>
              {Object.keys(periodSummary.totals).length === 0 ? (
                <div className="py-12 text-center text-neutral-600 text-sm">No completed shifts in this period yet</div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(periodSummary.totals)
                    .filter(([name]) => matchesTeamFilter(name) && matchesSearch(name))
                    .sort(([nameA, msA], [nameB, msB]) => {
                      if (summarySortBy === "name") return nameA.localeCompare(nameB);
                      if (summarySortBy === "shifts") return (periodSummary.shiftCounts[nameB] || 0) - (periodSummary.shiftCounts[nameA] || 0);
                      return msB - msA;
                    })
                    .map(([person, ms]) => {
                      const ot = periodSummary.otTotals[person] || 0;
                      const shiftCount = periodSummary.shiftCounts[person] || 0;
                      const otCount = periodSummary.otCounts[person] || 0;
                      const days = periodSummary.byDay[person] || [];
                      const isExpanded = expandedSummaryPerson === person;
                      const ac = avatarColor(person);
                      return (
                        <div key={person} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <button onClick={() => goToPersonReport(person)} className="flex items-center gap-2 min-w-0 hover:opacity-80">
                              <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${ac.bg} ${ac.text}`}>
                                {person.trim()[0].toUpperCase()}
                              </div>
                              <div className="min-w-0 text-left">
                                <span className="text-sm font-medium text-neutral-100 truncate block">{person}</span>
                                <span className="text-[10px] text-neutral-500">
                                  {shiftCount} shift{shiftCount === 1 ? "" : "s"}{otCount > 0 ? ` · ${otCount} OT` : ""}
                                </span>
                              </div>
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                <p className="text-sm font-mono text-neutral-300">{fmtHours(ms)}</p>
                                {ot > 0 && <p className="text-[10px] font-mono text-amber-400">+{fmtHours(ot)} OT</p>}
                              </div>
                              {days.length > 0 && (
                                <button onClick={() => setExpandedSummaryPerson(isExpanded ? "" : person)} className="p-1 text-neutral-500 hover:text-neutral-300">
                                  <ChevronDown size={14} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                </button>
                              )}
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="mt-2.5 pt-2.5 border-t border-neutral-800 space-y-1">
                              {days.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((d) => (
                                <div key={d.date} className="flex items-center justify-between text-xs">
                                  <span className="text-neutral-500">
                                    {fmtDateShort(d.date)}
                                    {d.shiftCount > 1 && <span className="text-sky-400"> · {d.shiftCount} shifts</span>}
                                    {d.stillOpen && <span className="text-emerald-400"> · in progress</span>}
                                  </span>
                                  <span className="font-mono text-neutral-300">
                                    {fmtDuration(d.workedMs)}
                                    {d.otMs > 0 && <span className="text-amber-400"> +{fmtDuration(d.otMs)} OT</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* SCHEDULE (owner only) — a weekly roster: pick a time/label per person per day, or OFF / Annual / Training / Holiday */}
          {dashTab === "schedule" && canSeeTab("schedule") && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setScheduleWeekOffset((o) => o - 1)} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                  <ChevronDown size={14} className="rotate-90" />
                </button>
                <p className="text-sm font-medium text-neutral-200 min-w-[180px]">
                  {(() => {
                    const ref = new Date();
                    ref.setDate(ref.getDate() + scheduleWeekOffset * 7);
                    const dates = weekDatesSat(ref);
                    return `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[6])}`;
                  })()}
                </p>
                <button onClick={() => setScheduleWeekOffset((o) => o + 1)} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                  <ChevronDown size={14} className="-rotate-90" />
                </button>
                {scheduleWeekOffset !== 0 && (
                  <button onClick={() => setScheduleWeekOffset(0)} className="text-xs text-neutral-500 hover:text-neutral-300 underline">
                    This week
                  </button>
                )}
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportScheduleCSV(file);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => csvFileInputRef.current?.click()}
                  className="ml-auto flex items-center gap-1.5 text-xs font-medium text-neutral-300 border border-neutral-700 rounded-lg px-3 py-1.5 hover:bg-neutral-900"
                >
                  <Download size={13} className="rotate-180" /> Import CSV
                </button>
                <button
                  onClick={handleExportScheduleCSV}
                  className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 border border-neutral-700 rounded-lg px-3 py-1.5 hover:bg-neutral-900"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
              {importMsg && <p className="text-xs text-neutral-500 mb-4">{importMsg}</p>}
              {!importMsg && (
                <p className="text-[10px] text-neutral-600 mb-4">
                  CSV format: first row = ID, Agent Name, then one column per date (e.g. "8/9/2026"). Each row after = ID, exact Agent Name, then OFF / Annual / Training / Holiday or a custom shift label per date.
                </p>
              )}

              {/* Public holidays — company-wide dates. Anyone with an actual shift assigned on one
                  of these dates (not OFF/Annual/Training/Holiday-status) auto-gets +1 annual leave
                  day, and loses it again if that shift is later removed or the date is unmarked. */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 mb-4 max-w-md">
                <p className="text-xs text-neutral-500 mb-1">Public holidays</p>
                <p className="text-[10px] text-neutral-600 mb-2">Anyone actually working (not OFF) on one of these dates automatically gets +1 annual leave day.</p>
                <div className="flex gap-2 mb-2">
                  <DatePickerButton value={newHolidayDate} onConfirm={setNewHolidayDate} direction="up" />
                  <button
                    disabled={!newHolidayDate || publicHolidays.includes(newHolidayDate)}
                    onClick={() => {
                      savePublicHolidays([...publicHolidays, newHolidayDate].sort());
                      setNewHolidayDate("");
                    }}
                    className="text-xs font-medium bg-neutral-100 text-neutral-900 rounded-lg px-3 py-1.5 disabled:opacity-40 shrink-0"
                  >
                    Add
                  </button>
                </div>
                {publicHolidays.length === 0 ? (
                  <p className="text-xs text-neutral-600">None yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {publicHolidays.map((d) => (
                      <span key={d} className="flex items-center gap-1 text-xs bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-full pl-2.5 pr-1 py-1">
                        {fmtDateLabel(d)}
                        <button
                          onClick={() => savePublicHolidays(publicHolidays.filter((x) => x !== d))}
                          className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {editingCell && (() => {
                const [ename, edate] = editingCell.split("|");
                const applyEntry = async (entry) => {
                  const ok = await applyScheduleEntry(ename, edate, entry);
                  if (ok) { setEditingCell(null); setCellTimeInput(""); setCellSuffixInput(""); }
                };
                return (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4 max-w-md">
                    <p className="text-xs text-neutral-500 mb-3">
                      Editing <span className="text-neutral-300 font-medium">{ename}</span> — {fmtDateLabel(edate)}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {Object.entries(SCHEDULE_STATUSES).map(([key, s]) => (
                        <button
                          key={key}
                          onClick={() => applyEntry({ kind: "status", status: key })}
                          className={`text-xs font-medium px-3 py-1.5 rounded-full ${s.bg} ${s.text}`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-neutral-600 mb-1.5">Or pick a custom time:</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <TimePickerButton value={cellTimeInput} onConfirm={setCellTimeInput} direction="up" />
                      <input
                        value={cellSuffixInput}
                        onChange={(e) => setCellSuffixInput(e.target.value)}
                        placeholder="Optional label"
                        className="flex-1 min-w-[100px] bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                      />
                      <button
                        disabled={!cellTimeInput}
                        onClick={() => applyEntry({ kind: "shift", label: `${fmtTime12(cellTimeInput)}${cellSuffixInput.trim() ? " " + cellSuffixInput.trim() : ""}` })}
                        className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {schedule[editingCell] && (
                        <button onClick={() => applyEntry(null)} className="flex items-center gap-1 text-xs font-medium text-rose-400 hover:text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-1.5">
                          <Trash2 size={12} /> Delete
                        </button>
                      )}
                      <button onClick={() => { setEditingCell(null); setCellTimeInput(""); setCellSuffixInput(""); }} className="text-xs text-neutral-500 hover:text-neutral-300 ml-auto">
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                <table className="w-full border-separate min-w-[620px]" style={{ borderSpacing: "3px" }}>
                  <thead>
                    <tr>
                      <th className="text-left text-[9px] font-medium text-neutral-500 px-1.5 pb-1 sticky left-0 bg-neutral-950">Agent</th>
                      {(() => {
                        const ref = new Date();
                        ref.setDate(ref.getDate() + scheduleWeekOffset * 7);
                        return weekDatesSat(ref).map((d) => {
                          const isHoliday = publicHolidays.includes(d);
                          return (
                            <th key={d} className={`text-center text-[9px] font-medium px-1 pb-1 min-w-[68px] ${isHoliday ? "text-yellow-400" : "text-neutral-500"}`}>
                              {new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                              <br />
                              <span className={isHoliday ? "text-yellow-500" : "text-neutral-600"}>{fmtDateShort(d)}</span>
                            </th>
                          );
                        });
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(users).sort(compareByUserId).map((uname) => {
                      const ref = new Date();
                      ref.setDate(ref.getDate() + scheduleWeekOffset * 7);
                      const dates = weekDatesSat(ref);
                      const balance = users[uname]?.annualLeaveBalance ?? DEFAULT_ANNUAL_LEAVE_BALANCE;
                      return (
                        <tr key={uname}>
                          <td className="text-[11px] font-medium text-neutral-300 px-1.5 py-0.5 whitespace-nowrap sticky left-0 bg-neutral-950">
                            {uname}
                            <span className="block text-[8.5px] font-normal text-neutral-600">{balance}d annual</span>
                          </td>
                          {dates.map((d) => {
                            const key = `${uname}|${d}`;
                            const entry = schedule[key];
                            let cellContent = <span className="text-neutral-700">—</span>;
                            let cellClass = "bg-neutral-900 border border-neutral-800 hover:border-neutral-700";
                            if (entry?.kind === "status") {
                              const s = SCHEDULE_STATUSES[entry.status];
                              if (s) {
                                cellContent = s.label;
                                cellClass = `${s.bg} ${s.text}`;
                              }
                            } else if (entry?.kind === "shift") {
                              cellContent = entry.label;
                              cellClass = "bg-emerald-900/40 border border-emerald-800 text-emerald-200";
                            }
                            return (
                              <td key={d} className="p-0">
                                <button
                                  onClick={() => { setEditingCell(key); setCellTimeInput(""); setCellSuffixInput(""); }}
                                  className={`w-full h-7 rounded-md text-[10px] font-medium px-1 transition-colors ${cellClass}`}
                                >
                                  {cellContent}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {Object.keys(users).length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-sm text-neutral-600 px-2 py-4">No users yet — add some from the Users tab first.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Danger zone — wipes every cell for the week currently shown above. Doesn't
                  retroactively restore annual leave balances that were already deducted. */}
              <div className="mt-6 max-w-md">
                {!confirmDeleteSchedule ? (
                  <button
                    onClick={() => setConfirmDeleteSchedule(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 size={13} /> Delete this week's schedule
                  </button>
                ) : (
                  <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                    <p className="text-xs text-rose-300 mb-2">Delete every cell for this week ({(() => { const ref = new Date(); ref.setDate(ref.getDate() + scheduleWeekOffset * 7); const dates = weekDatesSat(ref); return `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[6])}`; })()})? This can't be undone, and won't restore any annual leave days already deducted.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const ref = new Date();
                          ref.setDate(ref.getDate() + scheduleWeekOffset * 7);
                          const dates = weekDatesSat(ref);
                          const updated = { ...schedule };
                          Object.keys(users).forEach((uname) => {
                            dates.forEach((d) => { delete updated[`${uname}|${d}`]; });
                          });
                          const ok = await saveSchedule(updated);
                          if (!ok) { setDashError("Could not delete, try again."); return; }
                          setConfirmDeleteSchedule(false);
                        }}
                        className="text-xs font-medium bg-rose-500 text-white rounded-md px-3 py-1.5"
                      >
                        Yes, delete this week
                      </button>
                      <button onClick={() => setConfirmDeleteSchedule(false)} className="text-xs text-neutral-400 hover:text-neutral-200 px-2">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DAILY TASK (owner only) */}
          {dashTab === "dailytask" && canSeeTab("dailytask") && (
            <div>
              {/* Recurring tasks — tied to a shift's start time instead of a specific person.
                  Whoever's shift for a given day starts at that time automatically gets the
                  task that day (based on the live schedule, so swaps move it instantly). */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 mb-4 max-w-md">
                <p className="text-xs text-neutral-500 mb-1">Recurring tasks (by shift)</p>
                <p className="text-[10px] text-neutral-600 mb-2">Applies automatically to whoever's shift starts at that time — no need to reassign it every day.</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <TimePickerButton value={newRecurringTime} onConfirm={setNewRecurringTime} />
                  <input
                    value={newRecurringText}
                    onChange={(e) => setNewRecurringText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newRecurringTime && newRecurringText.trim()) {
                        saveRecurringTasks([...recurringTasks, { id: Date.now(), time: newRecurringTime, text: newRecurringText.trim(), createdAt: Date.now() }]);
                        setNewRecurringTime(""); setNewRecurringText("");
                      }
                    }}
                    placeholder="Task for that shift"
                    className="flex-1 min-w-[120px] bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                  />
                  <button
                    disabled={!newRecurringTime || !newRecurringText.trim()}
                    onClick={() => {
                      saveRecurringTasks([...recurringTasks, { id: Date.now(), time: newRecurringTime, text: newRecurringText.trim(), createdAt: Date.now() }]);
                      setNewRecurringTime(""); setNewRecurringText("");
                    }}
                    className="text-xs font-medium bg-neutral-100 text-neutral-900 rounded-lg px-3 py-1.5 disabled:opacity-40 shrink-0"
                  >
                    Add
                  </button>
                </div>
                {recurringTasks.length === 0 ? (
                  <p className="text-xs text-neutral-600">None yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {recurringTasks.map((t) => (
                      <div key={t.id} className="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5">
                        <p className="text-xs text-neutral-300 truncate">
                          <span className="font-medium bg-violet-500/10 text-violet-300 rounded px-1.5 py-0.5 mr-1.5">{fmtTime12(t.time)}</span>
                          {t.text}
                        </p>
                        <button onClick={() => saveRecurringTasks(recurringTasks.filter((x) => x.id !== t.id))} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-neutral-800 text-neutral-600 hover:text-neutral-300 shrink-0">
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Daily tasks — assign a one-off task to a specific employee. */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 mb-4 max-w-md">
                <p className="text-xs text-neutral-500 mb-2">One-off task</p>
                <div className="flex flex-col gap-2 mb-3">
                  <select value={newTaskUser} onChange={(e) => setNewTaskUser(e.target.value)} className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 outline-none">
                    <option value="">Assign to...</option>
                    {Object.keys(users).sort((a, b) => a.localeCompare(b)).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      value={newTaskText}
                      onChange={(e) => setNewTaskText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newTaskUser && newTaskText.trim()) {
                          saveDailyTasks([...dailyTasks, { id: Date.now(), name: newTaskUser, text: newTaskText.trim(), assignedAt: Date.now(), status: "pending" }]);
                          setNewTaskText("");
                        }
                      }}
                      placeholder="What do they need to do?"
                      className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                    />
                    <button
                      disabled={!newTaskUser || !newTaskText.trim()}
                      onClick={() => {
                        saveDailyTasks([...dailyTasks, { id: Date.now(), name: newTaskUser, text: newTaskText.trim(), assignedAt: Date.now(), status: "pending" }]);
                        setNewTaskText("");
                      }}
                      className="text-xs font-medium bg-neutral-100 text-neutral-900 rounded-lg px-3 py-1.5 disabled:opacity-40"
                    >
                      Assign
                    </button>
                  </div>
                </div>
              </div>

              {/* Unified activity list — every task instance (one-off assignments + recurring
                  completions), each with its own status and, for done ones, who did it. */}
              <div className="max-w-2xl">
                <p className="text-xs text-neutral-500 mb-2">All tasks</p>
                {(() => {
                  const rows = [
                    ...dailyTasks.map((t) => ({
                      key: `o-${t.id}`,
                      name: t.name,
                      text: t.text,
                      status: t.status,
                      sortAt: t.doneAt || t.assignedAt,
                      sub: t.status === "done" ? `Done ${new Date(t.doneAt).toLocaleString()}` : `Assigned ${new Date(t.assignedAt).toLocaleString()}`,
                      onDelete: () => saveDailyTasks(dailyTasks.filter((x) => x.id !== t.id)),
                    })),
                    ...recurringCompletions.map((c) => {
                      const task = recurringTasks.find((t) => t.id === c.taskId);
                      return {
                        key: `r-${c.id}`,
                        name: c.name,
                        text: task ? `[${fmtTime12(task.time)}] ${task.text}` : "(deleted recurring task)",
                        status: "done",
                        sortAt: c.doneAt,
                        sub: `Done ${new Date(c.doneAt).toLocaleString()}`,
                        onDelete: () => saveRecurringCompletions(recurringCompletions.filter((x) => x.id !== c.id)),
                      };
                    }),
                  ].sort((a, b) => b.sortAt - a.sortAt);

                  if (rows.length === 0) return <p className="text-sm text-neutral-600">No tasks yet.</p>;

                  return (
                    <div className="space-y-1.5">
                      {rows.map((row) => (
                        <div key={row.key} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs text-neutral-300 truncate">
                              <span className="font-medium">{row.name}</span> — {row.text}
                            </p>
                            <p className="text-[10px] text-neutral-600">{row.sub}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${row.status === "done" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                              {row.status === "done" ? "Done" : "Pending"}
                            </span>
                            <button onClick={row.onDelete} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-neutral-800 text-neutral-600 hover:text-neutral-300">
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* SETTINGS (owner only) */}
          {dashTab === "settings" && canSeeTab("settings") && (
            <div className="max-w-sm space-y-4">
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2 flex items-center gap-1.5"><LayoutGrid size={13} /> Team schedule</p>
                <p className="text-[11px] text-neutral-600 mb-3">
                  Employees only ever see the last <span className="text-neutral-400">published</span> version of the schedule — your edits in the Schedule tab stay private until you publish them here.
                </p>
                {publishMsg && <p className={`text-[11px] mb-2 ${publishMsg.startsWith("Published") ? "text-emerald-400" : publishMsg.startsWith("Unpublished") ? "text-amber-400" : "text-rose-400"}`}>{publishMsg}</p>}
                <div className="flex gap-2">
                  <button onClick={publishSchedule} className="flex-1 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg">
                    Publish current schedule
                  </button>
                  <button onClick={unpublishSchedule} className="text-xs font-medium text-rose-400 hover:text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3">
                    Unpublish
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2">Break time limit (minutes)</p>
                <p className="text-[11px] text-neutral-600 mb-3">If a break runs longer than this, break gets locked for the rest of that shift and shows in red.</p>
                {breakLimitMsg && <p className={`text-[11px] mb-1.5 ${breakLimitMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{breakLimitMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="1" value={breakLimitInput} onChange={(e) => { setBreakLimitInput(e.target.value); setBreakLimitMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseInt(breakLimitInput, 10);
                      if (!val || val < 1) { setBreakLimitMsg("Enter a valid number of minutes."); return; }
                      const ok = await saveSettings({ ...settings, breakLimitMinutes: val }, `Set break limit to ${val} min`);
                      setBreakLimitMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2">Standard shift length (hours)</p>
                <p className="text-[11px] text-neutral-600 mb-3">Finish stays locked until this many hours pass since Available (break included). Once reached, a sound alert repeats every 5 minutes until there's a response. Extra work beyond this goes through the separate Overtime tab.</p>
                {standardHoursMsg && <p className={`text-[11px] mb-1.5 ${standardHoursMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{standardHoursMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="1" step="0.5" value={standardHoursInput} onChange={(e) => { setStandardHoursInput(e.target.value); setStandardHoursMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseFloat(standardHoursInput);
                      if (!val || val < 0) { setStandardHoursMsg("Enter a valid number of hours."); return; }
                      const ok = await saveSettings({ ...settings, standardHours: val }, `Set standard shift length to ${val}h`);
                      setStandardHoursMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2">Minimum rest between shifts (hours)</p>
                <p className="text-[11px] text-neutral-600 mb-3">Once someone finishes a shift, the Available button stays locked until this many hours have passed since that Finish — they'll see exactly when it unlocks. Set to 0 to turn this off (anyone can start a new shift right away).</p>
                {minRestHoursMsg && <p className={`text-[11px] mb-1.5 ${minRestHoursMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{minRestHoursMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="0" step="0.5" value={minRestHoursInput} onChange={(e) => { setMinRestHoursInput(e.target.value); setMinRestHoursMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseFloat(minRestHoursInput);
                      if (val === "" || isNaN(val) || val < 0) { setMinRestHoursMsg("Enter a valid number of hours (0 to disable)."); return; }
                      const ok = await saveSettings({ ...settings, minRestHours: val }, val > 0 ? `Set minimum rest between shifts to ${val}h` : "Turned off minimum rest between shifts");
                      setMinRestHoursMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2">Overview auto-refresh (seconds)</p>
                <p className="text-[11px] text-neutral-600 mb-3">How often the Overview tab quietly refreshes itself while it's open — on top of the app-wide 20s refresh everywhere else. Set to 0 to turn off this extra refresh (Overview still gets the app-wide 20s one).</p>
                {overviewRefreshMsg && <p className={`text-[11px] mb-1.5 ${overviewRefreshMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{overviewRefreshMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="0" step="1" value={overviewRefreshInput} onChange={(e) => { setOverviewRefreshInput(e.target.value); setOverviewRefreshMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseInt(overviewRefreshInput, 10);
                      if (isNaN(val) || val < 0) { setOverviewRefreshMsg("Enter a valid number of seconds (0 to disable)."); return; }
                      const ok = await saveSettings({ ...settings, overviewRefreshSeconds: val }, val > 0 ? `Set Overview auto-refresh to every ${val}s` : "Turned off the extra Overview auto-refresh");
                      setOverviewRefreshMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2">Auto-close grace period (minutes)</p>
                <p className="text-[11px] text-neutral-600 mb-3">If someone reaches standard hours and doesn't respond to any alert within this window, the shift closes itself automatically and is never counted as overtime. They can press "I'm still here" on the alert to reset this window without it counting as overtime either.</p>
                {graceMinutesMsg && <p className={`text-[11px] mb-1.5 ${graceMinutesMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{graceMinutesMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="5" step="5" value={graceMinutesInput} onChange={(e) => { setGraceMinutesInput(e.target.value); setGraceMinutesMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseInt(graceMinutesInput, 10);
                      if (!val || val < 5) { setGraceMinutesMsg("Enter a valid number of minutes (5 or more)."); return; }
                      const ok = await saveSettings({ ...settings, graceMinutes: val }, `Set auto-close grace period to ${val} min`);
                      setGraceMinutesMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2 flex items-center gap-1.5"><Zap size={12} /> Weekly overtime cap (hours)</p>
                <p className="text-[11px] text-neutral-600 mb-3">Just a soft guideline — shown to employees as a progress bar, and flagged in red once they go over. Doesn't block anyone from starting overtime; you still approve or deny every session yourself.</p>
                {otCapHoursMsg && <p className={`text-[11px] mb-1.5 ${otCapHoursMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{otCapHoursMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="0" step="0.5" value={otCapHoursInput} onChange={(e) => { setOtCapHoursInput(e.target.value); setOtCapHoursMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseFloat(otCapHoursInput);
                      if (!val || val < 0) { setOtCapHoursMsg("Enter a valid number of hours."); return; }
                      const ok = await saveSettings({ ...settings, otCapHours: val }, `Set weekly overtime cap to ${val}h`);
                      setOtCapHoursMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <p className="text-xs text-neutral-500 mb-2">Max overtime session length (hours)</p>
                <p className="text-[11px] text-neutral-600 mb-3">Same safety net as the regular shift: once a single overtime session runs past this, it starts pinging every 5 min and auto-closes itself after the grace period above if nobody responds.</p>
                {otMaxHoursMsg && <p className={`text-[11px] mb-1.5 ${otMaxHoursMsg === "Saved." ? "text-emerald-400" : "text-rose-400"}`}>{otMaxHoursMsg}</p>}
                <div className="flex gap-2">
                  <input type="number" min="0.5" step="0.5" value={otMaxHoursInput} onChange={(e) => { setOtMaxHoursInput(e.target.value); setOtMaxHoursMsg(""); }} className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
                  <button
                    onClick={async () => {
                      const val = parseFloat(otMaxHoursInput);
                      if (!val || val < 0.5) { setOtMaxHoursMsg("Enter a valid number of hours (0.5 or more)."); return; }
                      const ok = await saveSettings({ ...settings, otMaxHours: val }, `Set max overtime session to ${val}h`);
                      setOtMaxHoursMsg(ok ? "Saved." : "Could not save, try again.");
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-4">
                <p className="text-xs text-neutral-500">My Dashboard account</p>
                <div>
                  <p className="text-[11px] text-neutral-600 mb-2">Signed in as {myDashUser} — set a new password</p>
                  {changeOwnerMsg && <p className={`text-[11px] mb-1.5 ${changeOwnerMsg === "Password updated." ? "text-emerald-400" : "text-rose-400"}`}>{changeOwnerMsg}</p>}
                  <div className="flex gap-2">
                    <PasswordInput value={changeOwnerNew} onChange={(e) => setChangeOwnerNew(e.target.value)} placeholder="New password" className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <button onClick={handleChangeOwnerPassword} className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0">Save</button>
                  </div>
                </div>
                <p className="text-[10px] text-neutral-600 pt-2 border-t border-neutral-800">To add more Dashboard users or change who can see what, go to Users → Dashboard.</p>
              </div>

              <div className="bg-neutral-900 border border-rose-900/50 rounded-xl p-4">
                <p className="text-xs text-rose-400 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> Danger zone</p>
                <p className="text-[11px] text-neutral-600 mb-3">Permanently delete every attendance record for everyone (users, passwords, and settings are kept). Useful for clearing out test data before going live.</p>
                {confirmWipe ? (
                  <div className="flex items-center justify-between bg-rose-500/10 rounded-lg px-3 py-2">
                    <span className="text-xs text-rose-300">Are you sure? This can't be undone.</span>
                    <div className="flex gap-2">
                      <button onClick={wipeAllEvents} className="text-xs font-medium text-rose-400">Clear all data</button>
                      <button onClick={() => setConfirmWipe(false)} className="text-xs text-neutral-400">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmWipe(true)} className="flex items-center gap-1.5 text-xs font-medium text-rose-400 border border-rose-900/50 rounded-lg px-3 py-1.5 hover:bg-rose-500/10">
                    <Trash2 size={13} /> Clear all attendance records
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ACTIVITY (owner only) */}
          {dashTab === "activity" && canSeeTab("activity") && (
            <div className="max-w-md">
              <div className="relative mb-3">
                <input
                  list="activity-actors"
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                  placeholder="Filter by who did it — type or pick a name..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                />
                <datalist id="activity-actors">
                  {Array.from(new Set(audit.map((a) => a.actor).filter(Boolean))).sort().map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                {activityFilter && (
                  <button onClick={() => setActivityFilter("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300">
                    <X size={14} />
                  </button>
                )}
              </div>
              {(() => {
                const filtered = activityFilter.trim()
                  ? audit.filter((a) => (a.actor || "").toLowerCase().includes(activityFilter.trim().toLowerCase()))
                  : audit;
                return filtered.length === 0 ? (
                  <div className="py-12 text-center text-neutral-600 text-sm">{activityFilter ? `No activity from "${activityFilter}"` : "No activity yet"}</div>
                ) : (
                  <div className="space-y-1.5">
                    {filtered.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 text-xs bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <span className="text-neutral-300">{a.text}</span>
                          {a.actor && <span className="text-sky-400"> — {a.actor}</span>}
                        </div>
                        <span className="text-neutral-600 font-mono shrink-0 whitespace-nowrap">{fmtDateLabel(todayKey(new Date(a.timestamp)))} {fmtTime(a.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================================
// WORKSPACE GATE — the very first screen. Isolates data per "Dashboard name"
// so this same deployed app can serve more than one team, each with its own
// completely separate attendance data behind its own name + password. New
// Dashboards need the builder's approval (via the hidden ?admin= screen)
// before their name + password can be used to sign in. Once signed in, this
// device stays signed in permanently (like a saved login) until someone
// taps the logout button — closing/reopening the browser does NOT ask again.
// ============================================================================

function normalizeWorkspaceName(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

async function loadRegistry() {
  try {
    const res = await window.storage.get("workspace-registry", true).catch(() => null);
    return res?.value ? JSON.parse(res.value) : {};
  } catch (e) {
    return {};
  }
}

async function saveRegistry(reg) {
  try {
    return await window.storage.set("workspace-registry", JSON.stringify(reg), true);
  } catch (e) {
    return null;
  }
}

const gatePopStyle = (
  <style>{`
    @keyframes logoPop {
      0% { opacity: 0; transform: scale(0.75) translateY(-6px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
  `}</style>
);

function SplashScreen() {
  return (
    <div className="relative w-full min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-100 overflow-hidden">
      <style>{`
        @keyframes splashIn {
          0% { opacity: 0; transform: scale(0.4) translateY(12px); }
          60% { opacity: 1; transform: scale(1.12) translateY(0); }
          80% { transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes splashGlow {
          0%, 100% { box-shadow: 0 0 0 rgba(52, 211, 153, 0); }
          50% { box-shadow: 0 0 22px rgba(52, 211, 153, 0.35); }
        }
        @keyframes fadeUp {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        className="w-16 h-16 rounded-2xl bg-neutral-900 border border-emerald-500/30 flex items-center justify-center"
        style={{ animation: "splashIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both, splashGlow 2.4s ease-in-out 0.8s infinite" }}
      >
        <Clock size={28} className="text-emerald-400" />
      </div>
      <h1
        className="text-2xl font-bold tracking-widest text-neutral-50 mt-1"
        style={{ animation: "splashIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both" }}
      >
        SHIFTLY
      </h1>
      <p
        className="text-xs font-medium text-neutral-500 tracking-wide"
        style={{ animation: "fadeUp 0.6s ease-out 0.55s both" }}
      >
        (WFH Attendance Tracker)
      </p>
      <p
        className="absolute bottom-10 text-xs text-neutral-600"
        style={{ animation: "fadeUp 0.6s ease-out 0.9s both" }}
      >
        Every shift, right on time.
      </p>
    </div>
  );
}

function GateLogo() {
  return (
    <div
      className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center mx-auto mb-4"
      style={{ animation: "logoPop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
    >
      <Building2 size={28} className="text-violet-400" />
    </div>
  );
}

function AdminApprovalScreen({ onBack }) {
  const [registry, setRegistry] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const [resetKey, setResetKey] = useState("");
  const [resetValue, setResetValue] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  useAutoClearMsg(resetMsg, setResetMsg);
  const [confirmDeleteWs, setConfirmDeleteWs] = useState("");

  const refresh = useCallback(async () => {
    setRegistry(await loadRegistry());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (key, action) => {
    setBusyKey(key);
    const reg = await loadRegistry();
    const updated = { ...reg };
    if (action === "approve") {
      updated[key] = { ...updated[key], status: "approved", approvedAt: Date.now() };
    } else if (action === "reject") {
      delete updated[key];
    } else if (action === "lock") {
      updated[key] = { ...updated[key], locked: true };
    } else if (action === "unlock") {
      updated[key] = { ...updated[key], locked: false };
    }
    await saveRegistry(updated);
    setRegistry(updated);
    setBusyKey("");
  };

  // Wipes EVERYTHING for a workspace: every "ws:{key}:*" storage key (events, users, auth,
  // settings, schedule, tasks, everything) plus its registry entry. Cannot be undone.
  const deleteWorkspaceEntirely = async (key) => {
    setBusyKey(key);
    try {
      const listRes = await window.storage.list(`ws:${key}:`, true).catch(() => null);
      const keys = listRes?.keys || [];
      for (const k of keys) {
        await window.storage.delete(k, true).catch(() => {});
      }
    } catch (e) {}
    const reg = await loadRegistry();
    const updated = { ...reg };
    delete updated[key];
    await saveRegistry(updated);
    setRegistry(updated);
    setConfirmDeleteWs("");
    setBusyKey("");
  };

  const submitReset = async (key) => {
    if (!resetValue || resetValue.length < 4) {
      setResetMsg("Password must be at least 4 characters.");
      return;
    }
    setBusyKey(key);
    const reg = await loadRegistry();
    const updated = { ...reg, [key]: { ...reg[key], password: resetValue } };
    await saveRegistry(updated);
    setRegistry(updated);
    setBusyKey("");
    setResetKey("");
    setResetValue("");
    setResetMsg("Password updated.");
    setTimeout(() => setResetMsg(""), 2500);
  };

  if (!registry) {
    return (
      <div className="w-full min-h-screen bg-neutral-950 flex items-center justify-center">
        <RefreshCw size={18} className="text-neutral-600 animate-spin" />
      </div>
    );
  }

  const entries = Object.entries(registry).sort((a, b) => (b[1].requestedAt || b[1].createdAt || 0) - (a[1].requestedAt || a[1].createdAt || 0));
  const pending = entries.filter(([, v]) => v.status === "pending");
  const approved = entries.filter(([, v]) => v.status === "approved");

  return (
    <div className="w-full min-h-screen bg-neutral-950 text-neutral-100 p-5" style={{ fontFamily: "system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold flex items-center gap-2"><ShieldQuestion size={18} className="text-violet-400" /> Dashboard approvals</h1>
          <div className="flex items-center gap-1">
            {onBack && (
              <button onClick={onBack} className="text-xs font-medium text-neutral-400 hover:text-neutral-200 border border-neutral-800 rounded-md px-2.5 py-1.5 mr-1">
                ← Back to my Dashboard
              </button>
            )}
            <button onClick={refresh} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900" title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        <p className="text-xs text-neutral-500 mb-2">Pending requests ({pending.length})</p>
        <div className="space-y-2 mb-6">
          {pending.length === 0 && <p className="text-sm text-neutral-600">No pending requests.</p>}
          {pending.map(([key, v]) => (
            <div key={key} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5">
              <div>
                <p className="text-sm text-neutral-200">{v.displayName || key}</p>
                <p className="text-[10px] text-neutral-600">requested {v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button disabled={busyKey === key} onClick={() => act(key, "approve")} className="flex items-center gap-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md px-2.5 py-1.5 hover:bg-emerald-500/20">
                  <Check size={13} /> Approve
                </button>
                <button disabled={busyKey === key} onClick={() => act(key, "reject")} className="flex items-center gap-1 text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-md px-2.5 py-1.5 hover:bg-rose-500/20">
                  <X size={13} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-neutral-500 mb-2">Approved Dashboards ({approved.length})</p>
        <div className="space-y-2">
          {approved.length === 0 && <p className="text-sm text-neutral-600">None yet.</p>}
          {approved.map(([key, v]) => (
            <div key={key} className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-neutral-200 flex items-center gap-1.5">
                    {v.displayName || key}
                    {v.locked && <span className="text-[10px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-full px-1.5 py-0.5">Locked</span>}
                  </p>
                  <p className="text-[10px] text-neutral-600">approved {v.approvedAt ? new Date(v.approvedAt).toLocaleString() : ""}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={busyKey === key}
                    onClick={() => { setResetKey(resetKey === key ? "" : key); setResetValue(""); setResetMsg(""); }}
                    className="text-xs font-medium text-neutral-500 border border-neutral-700 rounded-md px-2.5 py-1.5 hover:bg-neutral-900 hover:text-neutral-300"
                  >
                    Reset password
                  </button>
                  {v.locked ? (
                    <button disabled={busyKey === key} onClick={() => act(key, "unlock")} className="flex items-center gap-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md px-2.5 py-1.5 hover:bg-emerald-500/20">
                      Unlock
                    </button>
                  ) : (
                    <button disabled={busyKey === key} onClick={() => act(key, "lock")} className="flex items-center gap-1 text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-md px-2.5 py-1.5 hover:bg-rose-500/20">
                      <Lock size={12} /> Lock
                    </button>
                  )}
                  <button
                    disabled={busyKey === key}
                    onClick={() => setConfirmDeleteWs(confirmDeleteWs === key ? "" : key)}
                    className="p-1.5 rounded-md text-neutral-600 hover:text-rose-400 hover:bg-rose-500/10"
                    title="Delete this Dashboard entirely"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {resetKey === key && (
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-neutral-800">
                  <PasswordInput
                    value={resetValue}
                    onChange={(e) => setResetValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitReset(key); }}
                    placeholder="New password"
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50"
                  />
                  <button disabled={busyKey === key} onClick={() => submitReset(key)} className="text-xs font-medium bg-neutral-100 text-neutral-900 rounded-md px-3 py-1.5">
                    Save
                  </button>
                </div>
              )}
              {resetKey === key && resetMsg && <p className="text-[10px] text-emerald-400 mt-1.5">{resetMsg}</p>}
              {confirmDeleteWs === key && (
                <div className="mt-2.5 pt-2.5 border-t border-neutral-800 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
                  <p className="text-[11px] text-rose-300 mb-2">
                    Permanently delete "{v.displayName || key}" — every event, user, and setting for this Dashboard. This can't be undone.
                  </p>
                  <div className="flex gap-2">
                    <button disabled={busyKey === key} onClick={() => deleteWorkspaceEntirely(key)} className="text-xs font-medium bg-rose-500 text-white rounded-md px-3 py-1.5">
                      {busyKey === key ? "Deleting..." : "Yes, delete everything"}
                    </button>
                    <button onClick={() => setConfirmDeleteWs("")} className="text-xs text-neutral-400 hover:text-neutral-200 px-2">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceNameGate({ mode, setMode, name, setName, password, setPassword, confirmPassword, setConfirmPassword, error, submitting, onEnter, onCreate }) {
  const submit = () => (mode === "enter" ? onEnter() : onCreate());
  return (
    <div className="w-full min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-5" style={{ fontFamily: "system-ui, sans-serif" }}>
      {gatePopStyle}
      <div className="w-full max-w-sm text-center">
        <GateLogo />
        <h1 className="text-lg font-bold text-neutral-50 mb-1">Enter Your Dashboard Name</h1>
        <p className="text-sm text-neutral-500 mb-6">This keeps your team's attendance data separate and private.</p>

        <div className="flex bg-neutral-900 rounded-lg p-1 gap-1 mb-4">
          <button
            onClick={() => setMode("enter")}
            className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${mode === "enter" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}
          >
            I already have one
          </button>
          <button
            onClick={() => setMode("create")}
            className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${mode === "create" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}
          >
            Set up a new one
          </button>
        </div>

        {error && <p className="text-xs text-rose-400 mb-3">{error}</p>}

        <div className="space-y-2 mb-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dashboard name"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50 text-center"
          />
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && mode === "enter") submit(); }}
            placeholder={mode === "enter" ? "Password" : "Choose a password"}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50 text-center"
          />
          {mode === "create" && (
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Confirm password"
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50 text-center"
            />
          )}
        </div>

        <button onClick={submit} disabled={submitting} className="w-full bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50">
          {mode === "enter" ? "Enter" : "Request this Dashboard"}
        </button>

        {mode === "create" && (
          <p className="text-[10px] text-neutral-600 mt-3">New Dashboards need approval before they can be used. You'll see a waiting screen until then.</p>
        )}
      </div>
    </div>
  );
}

function WorkspacePendingScreen({ displayName, onCheckAgain, onUseDifferent, onAdminTest, checking }) {
  return (
    <div className="w-full min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-5" style={{ fontFamily: "system-ui, sans-serif" }}>
      {gatePopStyle}
      <div className="w-full max-w-sm text-center">
        <GateLogo />
        <h1 className="text-lg font-bold text-neutral-50 mb-1">Waiting for approval</h1>
        <p className="text-sm text-neutral-500 mb-6">"{displayName}" is waiting to be approved.</p>
        <button onClick={onCheckAgain} disabled={checking} className="w-full bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2.5 rounded-lg mb-2 disabled:opacity-50">
          {checking ? "Checking..." : "Check again"}
        </button>
        <button onClick={onUseDifferent} className="w-full text-xs text-neutral-500 hover:text-neutral-300 px-4 py-2">
          Use a different name
        </button>
        {onAdminTest && (
          <button onClick={onAdminTest} className="w-full text-[11px] text-violet-400/70 hover:text-violet-300 px-4 py-2 mt-2 border-t border-neutral-900 pt-3">
            🔧 Open admin approval (testing only — remove before you deploy)
          </button>
        )}
      </div>
    </div>
  );
}

function ChooserScreen({ displayName, onPick, onSwitchWorkspace }) {
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  return (
    <div className="w-full min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-5" style={{ fontFamily: "system-ui, sans-serif" }}>
      {gatePopStyle}
      <div className="w-full max-w-sm text-center">
        <GateLogo />
        <h1 className="text-lg font-bold text-neutral-50 mb-1">{displayName}</h1>
        <p className="text-sm text-neutral-500 mb-6">Which one do you want to open?</p>
        <div className="grid grid-cols-1 gap-3 mb-4">
          <button onClick={() => onPick("track")} className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl px-4 py-3.5 text-left transition-colors">
            <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
              <UsersIcon size={16} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-100">Agent User</p>
              <p className="text-xs text-neutral-500">Clock in, take a break, log a meeting or task</p>
            </div>
          </button>
          <button onClick={() => onPick("dashboard")} className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl px-4 py-3.5 text-left transition-colors">
            <div className="w-9 h-9 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
              <Home size={16} className="text-sky-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-100">Dashboard User</p>
              <p className="text-xs text-neutral-500">Reports, exports, users, and settings</p>
            </div>
          </button>
        </div>
        {onSwitchWorkspace && !confirmSwitch && (
          <button onClick={() => setConfirmSwitch(true)} className="text-xs text-neutral-600 hover:text-neutral-400">
            Not your workspace? Switch
          </button>
        )}
        {confirmSwitch && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-left">
            <p className="text-xs text-neutral-300 mb-1">Leave this workspace?</p>
            <p className="text-[11px] text-neutral-500 mb-3">You'll need to enter the workspace name again to come back.</p>
            <div className="flex gap-2">
              <button onClick={onSwitchWorkspace} className="flex-1 bg-rose-500/10 text-rose-400 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-rose-500/20">Yes, leave</button>
              <button onClick={() => setConfirmSwitch(false)} className="flex-1 bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg">No, stay</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [phase, setPhase] = useState("loading"); // loading | admin | gate | pending | ready
  const [showSplash, setShowSplash] = useState(true);
  const [workspaceKey, setWorkspaceKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState("enter");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [adminViaShortcut, setAdminViaShortcut] = useState(false);

  // Which side of the app this URL points to. "/agent" and "/dashboard" lock Shiftly to that one
  // screen (no switcher pills, clean bookmarkable link); plain "/" shows a small chooser once the
  // workspace is resolved, so people can pick which one they want.
  const intendedTab = location.pathname === "/agent" ? "track" : location.pathname === "/dashboard" ? "dashboard" : null;

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 1900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // The real way into /admin: the secret in the URL. The "testing only" shortcut on the pending
    // screen sets phase directly instead (see onAdminTest below) and never goes through this check.
    if (location.pathname === "/admin" && searchParams.get("admin") === ADMIN_SECRET) {
      setPhase("admin");
      return;
    }
    // Permanent per-device sign-in: only cleared by the logout button.
    const saved = safeGetLocal("workspace-name");
    if (saved) {
      (async () => {
        try {
          const reg = await loadRegistry();
          const entry = reg[saved];
          if (entry?.status === "approved" && !entry.locked) {
            setWorkspaceKey(saved);
            setDisplayName(entry.displayName || saved);
            setPhase("ready");
          } else if (entry?.status === "approved" && entry.locked) {
            safeRemoveLocal("workspace-name");
            setError("This Dashboard is locked. Contact your administrator.");
            setPhase("gate");
          } else if (entry?.status === "pending") {
            setWorkspaceKey(saved);
            setDisplayName(entry.displayName || saved);
            setPhase("pending");
          } else {
            safeRemoveLocal("workspace-name");
            setPhase("gate");
          }
        } catch (e) {
          setPhase("gate");
        }
      })();
    } else {
      setPhase("gate");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetGateFields = () => {
    setName("");
    setPassword("");
    setConfirmPassword("");
    setError("");
  };

  const handleEnter = async () => {
    setError("");
    const norm = normalizeWorkspaceName(name);
    if (!norm) { setError("Type your Dashboard name."); return; }
    if (!password) { setError("Type the password."); return; }
    setSubmitting(true);
    const reg = await loadRegistry();
    const entry = reg[norm];
    if (!entry) {
      setError("That Dashboard name doesn't exist.");
      setSubmitting(false);
      return;
    }
    if (entry.locked) {
      setError("This Dashboard is locked. Contact your administrator.");
      setSubmitting(false);
      return;
    }
    if (entry.password !== password) {
      setError("Wrong password.");
      setSubmitting(false);
      return;
    }
    safeSetLocal("workspace-name", norm);
    setWorkspaceKey(norm);
    setDisplayName(entry.displayName || norm);
    setPhase(entry.status === "approved" ? "ready" : "pending");
    setSubmitting(false);
  };

  const handleCreate = async () => {
    setError("");
    const norm = normalizeWorkspaceName(name);
    if (norm.length < 3) { setError("Dashboard name must be at least 3 characters."); return; }
    if (!password || password.length < 4) { setError("Password must be at least 4 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    setSubmitting(true);
    const reg = await loadRegistry();
    if (reg[norm]) {
      setError("That name is already taken. Choose another.");
      setSubmitting(false);
      return;
    }
    const updated = { ...reg, [norm]: { displayName: name.trim(), password, status: "pending", createdAt: Date.now() } };
    const res = await saveRegistry(updated);
    if (!res) {
      setError("Could not submit, try again.");
      setSubmitting(false);
      return;
    }
    safeSetLocal("workspace-name", norm);
    setWorkspaceKey(norm);
    setDisplayName(name.trim());
    setPhase("pending");
    setSubmitting(false);
  };

  const handleCheckAgain = async () => {
    setSubmitting(true);
    const reg = await loadRegistry();
    const entry = reg[workspaceKey];
    if (entry?.status === "approved") {
      setPhase("ready");
    } else if (!entry) {
      safeRemoveLocal("workspace-name");
      setPhase("gate");
      setError("That request was declined. Try a different name.");
    }
    setSubmitting(false);
  };

  const handleUseDifferent = () => {
    safeRemoveLocal("workspace-name");
    resetGateFields();
    setMode("enter");
    setPhase("gate");
  };

  const handleSwitchWorkspace = () => {
    safeRemoveLocal("workspace-name");
    setWorkspaceKey("");
    resetGateFields();
    setMode("enter");
    setPhase("gate");
    navigate("/");
  };

  if (showSplash || phase === "loading") {
    return <SplashScreen />;
  }
  if (phase === "admin") {
    return <AdminApprovalScreen onBack={adminViaShortcut ? () => { setAdminViaShortcut(false); setPhase("pending"); navigate(-1); } : null} />;
  }
  if (phase === "gate") {
    return (
      <WorkspaceNameGate
        mode={mode}
        setMode={setMode}
        name={name}
        setName={setName}
        password={password}
        setPassword={setPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        error={error}
        submitting={submitting}
        onEnter={handleEnter}
        onCreate={handleCreate}
      />
    );
  }
  if (phase === "pending") {
    return (
      <WorkspacePendingScreen
        displayName={displayName}
        checking={submitting}
        onCheckAgain={handleCheckAgain}
        onUseDifferent={handleUseDifferent}
        onAdminTest={() => { setAdminViaShortcut(true); setPhase("admin"); navigate("/admin"); }}
      />
    );
  }

  // phase === "ready": workspace resolved. If the URL didn't say which side (plain "/"), let them pick.
  if (!intendedTab) {
    return <ChooserScreen displayName={displayName} onPick={(t) => navigate(t === "track" ? "/agent" : "/dashboard")} onSwitchWorkspace={handleSwitchWorkspace} />;
  }
  return <Shiftly key={workspaceKey} workspaceName={workspaceKey} workspaceDisplayName={displayName} onSwitchWorkspace={handleSwitchWorkspace} onBackToChooser={() => navigate("/")} initialTab={intendedTab} lockTab />;
}
