import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Play, Coffee, RotateCcw, Square, Clock, Lock, ChevronDown, Plus, Trash2, Key,
  UserX, UserCheck, Download, Settings as SettingsIcon, Users as UsersIcon,
  BarChart3, Activity as ActivityIcon, CalendarRange, AlertTriangle,
  StickyNote, Tag, ShieldQuestion, Home, Info, X, Volume2, VolumeX, Zap, Timer, LogOut,
  Building2, RefreshCw, Check,
} from "lucide-react";

const OWNER_PASSWORD_FALLBACK = "owner2026"; // used only until the owner sets a custom password in Settings
const VIEWER_PASSWORD_FALLBACK = "viewer2026"; // used only until the owner sets a custom viewer password in Settings
// Emergency master key — only for you (the builder), never share this with the business owner.
// If the owner ever loses BOTH their password and their recovery code, this wipes auth
// (owner/viewer passwords + recovery code) back to defaults WITHOUT touching attendance data.
// Change this string to your own secret before handing the app off.
const MASTER_RESET_KEY = "8122000";
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
function weekDates(refDate = new Date()) {
  const d = new Date(refDate);
  const day = (d.getDay() + 6) % 7; // Monday = 0
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

const REGULAR_TYPES = ["start", "break_start", "break_end", "end"];

// Groups one person's REGULAR-shift events into shifts, one per Start. A shift is attributed to the local
// calendar date its Start happened on — so a shift that runs past midnight (e.g. 5pm-2am) is reported
// entirely under the day it began, exactly like a real timesheet. There is no "reopening" anymore: once
// Finished, that shift is done — extra work goes through the separate Overtime flow instead.
function groupRegularShifts(sortedRegularEvents) {
  const shifts = [];
  let current = null;
  let openBreakStart = null;
  for (const ev of sortedRegularEvents) {
    if (ev.type === "start") {
      current = { shiftDate: todayKey(new Date(ev.timestamp)), start: ev.timestamp, end: null, breakMs: 0, breaks: [], forced: false, earlyLeave: false, earlyLeaveNote: "", events: [ev] };
      shifts.push(current);
      openBreakStart = null;
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

// Live status for the Track page (or any person, e.g. the Users tab): looks at that person's most recent
// regular shift. If it's still open they're working/on break — correctly true even past midnight. If it's
// closed: same calendar date => stays "finished" for the rest of that day (use Overtime for more work); a
// different (older) date => treated as fully fresh, so a brand new shift can always start.
function computeRegularLiveState(personEvents, breakLimitMs, standardMs, nowTs) {
  const empty = { status: "not_started", breakLocked: false, openBreakStart: null, enriched: [], liveWorkedMs: 0, liveElapsedMs: 0, liveBreakMs: 0, shiftDate: null, shiftStart: null };
  const regular = personEvents.filter((e) => REGULAR_TYPES.includes(e.type)).sort((a, b) => a.timestamp - b.timestamp);
  const shifts = groupRegularShifts(regular);
  const shift = shifts[shifts.length - 1];
  if (!shift || shift.end != null) return empty; // no shift yet, or the last one is already closed — fully fresh, start anytime

  let status = "working";
  let breakLocked = false;
  let openBreakStart = null;
  const enriched = [];
  for (const ev of shift.events) {
    let overtime = false;
    if (ev.type === "start") {
      status = "working";
    } else if (ev.type === "break_start") {
      status = "on_break";
      openBreakStart = ev.timestamp;
    } else if (ev.type === "break_end") {
      status = "working";
      if (openBreakStart) {
        const dur = ev.timestamp - openBreakStart;
        if (dur > breakLimitMs) { breakLocked = true; overtime = true; }
      }
      openBreakStart = null;
    }
    enriched.push({ ...ev, overtime });
  }

  const liveWorkedMs = computeLiveWorkedMs(shift.events, nowTs);
  const liveElapsedMs = computeLiveElapsedMs(shift.events, nowTs);
  const liveBreakMs = status === "on_break" && openBreakStart ? nowTs - openBreakStart : 0;

  return { status, breakLocked, openBreakStart, enriched, liveWorkedMs, liveElapsedMs, liveBreakMs, shiftDate: shift.shiftDate, shiftStart: shift.start };
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
    let allEvents = [];
    let anyOpen = false;
    let anyForced = false;
    let earlyLeaveNotes = [];
    let latestEnd = null;

    for (const sh of dayShifts) {
      allEvents.push(...sh.events);
      totalBreakMs += sh.breakMs;
      allBreaks.push(...sh.breaks);
      if (sh.forced) anyForced = true;
      if (sh.earlyLeave) earlyLeaveNotes.push(sh.earlyLeaveNote);
      if (sh.end == null) {
        anyOpen = true;
      } else {
        workedMs += sh.end - sh.start - sh.breakMs;
        latestEnd = sh.end;
      }
    }
    const overtimeBreakCount = allBreaks.filter((ms) => ms > breakLimitMs).length;

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
  rose: { soft: "bg-rose-500/10", text: "text-rose-400" },
};
const STATUS_BADGE = {
  not_started: { label: "Not started", cls: "bg-neutral-800 text-neutral-400" },
  working: { label: "Working", cls: "bg-emerald-500/10 text-emerald-400" },
  on_break: { label: "On break", cls: "bg-amber-500/10 text-amber-400" },
  finished: { label: "Finished", cls: "bg-sky-500/10 text-sky-400" },
};

const DEFAULT_SETTINGS = { breakLimitMinutes: 60, standardHours: 9, graceMinutes: 15, otCapHours: 5, otMaxHours: 3 };
const DEFAULT_AUTH = { ownerPassword: null, viewerPassword: null, recoveryCode: null };
const EVENT_LABEL = { start: "Start", break_start: "Break", break_end: "Back", end: "Finish", ot_start: "OT Start", ot_end: "OT Finish", ot_approve: "OT Approved", ot_deny: "OT Denied" };

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
    .map((e) => [e.name, EVENT_LABEL[e.type] || e.type, todayKey(new Date(e.timestamp)), fmtTime(e.timestamp), e.reason || e.note || e.decisionNote || ""]);
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
  if (cols.start) header.push("Start");
  if (cols.finish) header.push("Finish");
  if (cols.worked) header.push("Worked");
  if (cols.overtime) header.push("Overtime");
  if (cols.breaks) header.push("Breaks");
  if (cols.breakTime) header.push("Break time");
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

function Shiftly({ workspaceName, workspaceDisplayName, onSwitchWorkspace }) {
  const wsKey = useCallback((base) => `ws:${workspaceName}:${base}`, [workspaceName]);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [users, setUsers] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [auth, setAuth] = useState(DEFAULT_AUTH);
  const [audit, setAudit] = useState([]);

  const [tab, setTab] = useState("track");
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

  const [role, setRole] = useState(null); // 'owner' | 'viewer' | null
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [dashTab, setDashTab] = useState("overview");

  const [showForgotPanel, setShowForgotPanel] = useState(false);
  const [forgotRecoveryCode, setForgotRecoveryCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotError, setForgotError] = useState("");

  const [showMasterReset, setShowMasterReset] = useState(false);
  const [masterKeyInput, setMasterKeyInput] = useState("");
  const [masterResetError, setMasterResetError] = useState("");
  const [masterResetDone, setMasterResetDone] = useState(false);

  const [firstRunRecoveryInput, setFirstRunRecoveryInput] = useState("");
  const [firstRunRecoveryError, setFirstRunRecoveryError] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [dashError, setDashError] = useState("");
  const [editingPwFor, setEditingPwFor] = useState("");
  const [pwEditValue, setPwEditValue] = useState("");
  const [editingNoteFor, setEditingNoteFor] = useState("");
  const [noteEditValue, setNoteEditValue] = useState("");
  const [editingTeamFor, setEditingTeamFor] = useState("");
  const [teamEditValue, setTeamEditValue] = useState("");
  const [confirmDeleteFor, setConfirmDeleteFor] = useState("");
  const [confirmPurgeFor, setConfirmPurgeFor] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");

  const [reportDate, setReportDate] = useState(todayKey());
  const [breakLimitInput, setBreakLimitInput] = useState(String(DEFAULT_SETTINGS.breakLimitMinutes));
  const [breakLimitMsg, setBreakLimitMsg] = useState("");
  const [standardHoursInput, setStandardHoursInput] = useState(String(DEFAULT_SETTINGS.standardHours));
  const [standardHoursMsg, setStandardHoursMsg] = useState("");
  const [graceMinutesInput, setGraceMinutesInput] = useState(String(DEFAULT_SETTINGS.graceMinutes));
  const [graceMinutesMsg, setGraceMinutesMsg] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);

  const [changeOwnerNew, setChangeOwnerNew] = useState("");
  const [changeOwnerMsg, setChangeOwnerMsg] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [recoveryMsg, setRecoveryMsg] = useState("");
  const [viewerPasswordInput, setViewerPasswordInput] = useState("");
  const [viewerPwMsg, setViewerPwMsg] = useState("");

  const [summaryPeriod, setSummaryPeriod] = useState("week"); // 'week' | 'month'
  const [summarySortBy, setSummarySortBy] = useState("hours"); // 'hours' | 'name' | 'shifts'
  const [expandedSummaryPerson, setExpandedSummaryPerson] = useState("");

  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportDateFilter, setExportDateFilter] = useState("all");
  const [exportPersonFilter, setExportPersonFilter] = useState("all");
  const [exportMode, setExportMode] = useState("summary"); // 'summary' | 'full' | 'otSessions'
  const [exportCols, setExportCols] = useState({ start: true, finish: true, worked: true, overtime: true, breaks: true, breakTime: true, overLimit: true, autoClosed: true, leftEarly: true });
  const [exportFullWork, setExportFullWork] = useState(true);
  const [exportFullBreaks, setExportFullBreaks] = useState(true);
  const [exportFullOvertime, setExportFullOvertime] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  const [showReachedPrompt, setShowReachedPrompt] = useState(false);
  const [showOtReachedPrompt, setShowOtReachedPrompt] = useState(false);

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
      const settingsRes = await window.storage.get(wsKey("attendance-settings"), true).catch(() => null);
      const s = settingsRes?.value ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRes.value) } : DEFAULT_SETTINGS;
      setSettings(s);
      setBreakLimitInput(String(s.breakLimitMinutes));
      setStandardHoursInput(String(s.standardHours));
      setGraceMinutesInput(String(s.graceMinutes));
      setOtCapHoursInput(String(s.otCapHours));
      setOtMaxHoursInput(String(s.otMaxHours));
    } catch (e) {}
    try {
      const authRes = await window.storage.get(wsKey("attendance-auth"), true).catch(() => null);
      setAuth(authRes?.value ? { ...DEFAULT_AUTH, ...JSON.parse(authRes.value) } : DEFAULT_AUTH);
    } catch (e) {}
    try {
      const auditRes = await window.storage.get(wsKey("attendance-audit"), true).catch(() => null);
      setAudit(auditRes?.value ? JSON.parse(auditRes.value) : []);
    } catch (e) {}
  }, [wsKey]);

  useEffect(() => {
    (async () => {
      try {
        const myRes = await window.storage.get(wsKey("my-user"), false).catch(() => null);
        if (myRes?.value) setMyUser(myRes.value);
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
    const freq = { start: 660, break_start: 520, break_end: 660, end: 440, ot_start: 740, ot_end: 440 }[type] || 600;
    playTone(freq, soundMuted);
  };

  const playAlarm = () => {
    if (soundMuted) return;
    playTone(880, false);
    setTimeout(() => playTone(880, false), 220);
    setTimeout(() => playTone(880, false), 440);
  };

  const addAudit = async (text) => {
    const entry = { id: Date.now() + "-" + Math.random().toString(36).slice(2), timestamp: Date.now(), text };
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

  const effectiveOwnerPassword = auth.ownerPassword || OWNER_PASSWORD_FALLBACK;
  const effectiveViewerPassword = auth.viewerPassword || VIEWER_PASSWORD_FALLBACK;

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

  const handleDashboardLock = () => {
    setRole(null);
    setPwInput("");
    setPwError(false);
    setDashTab("overview");
  };

  const handleForgotReset = async () => {
    setForgotError("");
    if (!auth.recoveryCode) { setForgotError("No recovery code has been set up for this dashboard. Ask whoever configured it to reset your access from Settings."); return; }
    if (forgotRecoveryCode.trim() !== auth.recoveryCode) { setForgotError("That recovery code doesn't match."); return; }
    if (!forgotNewPassword.trim() || forgotNewPassword.trim().length < 4) { setForgotError("Choose a new password, at least 4 characters."); return; }
    const ok = await saveAuth({ ...auth, ownerPassword: forgotNewPassword.trim() }, "Owner password was reset using the recovery code");
    if (ok) {
      setRole("owner");
      setDashTab("overview");
      setShowForgotPanel(false);
      setForgotRecoveryCode("");
      setForgotNewPassword("");
    } else {
      setForgotError("Could not save the new password, try again.");
    }
  };

  const handleChangeOwnerPassword = async () => {
    setChangeOwnerMsg("");
    if (!changeOwnerNew.trim() || changeOwnerNew.trim().length < 4) { setChangeOwnerMsg("New password must be at least 4 characters."); return; }
    const ok = await saveAuth({ ...auth, ownerPassword: changeOwnerNew.trim() }, "Owner password changed");
    if (ok) { setChangeOwnerMsg("Password updated."); setChangeOwnerNew(""); } else { setChangeOwnerMsg("Could not save, try again."); }
  };

  const handleSetRecoveryCode = async () => {
    setRecoveryMsg("");
    if (!recoveryCodeInput.trim() || recoveryCodeInput.trim().length < 4) { setRecoveryMsg("Recovery code must be at least 4 characters."); return; }
    const ok = await saveAuth({ ...auth, recoveryCode: recoveryCodeInput.trim() }, "Recovery code updated");
    if (ok) { setRecoveryMsg("Recovery code saved."); setRecoveryCodeInput(""); } else { setRecoveryMsg("Could not save, try again."); }
  };

  const handleSetViewerPassword = async () => {
    setViewerPwMsg("");
    if (!viewerPasswordInput.trim() || viewerPasswordInput.trim().length < 4) { setViewerPwMsg("Password must be at least 4 characters."); return; }
    const ok = await saveAuth({ ...auth, viewerPassword: viewerPasswordInput.trim() }, "Viewer password changed");
    if (ok) { setViewerPwMsg("Viewer password saved."); setViewerPasswordInput(""); } else { setViewerPwMsg("Could not save, try again."); }
  };

  // Mandatory first-time recovery code setup — shown right after the owner's first successful
  // login while auth.recoveryCode is still empty. Blocks the dashboard until saved.
  const handleFirstRunRecoverySave = async () => {
    setFirstRunRecoveryError("");
    if (!firstRunRecoveryInput.trim() || firstRunRecoveryInput.trim().length < 4) {
      setFirstRunRecoveryError("Recovery code must be at least 4 characters.");
      return;
    }
    const ok = await saveAuth({ ...auth, recoveryCode: firstRunRecoveryInput.trim() }, "Recovery code set (first-time setup)");
    if (ok) { setFirstRunRecoveryInput(""); } else { setFirstRunRecoveryError("Could not save, try again."); }
  };

  // Last-resort escape hatch: only works if you (the builder) know MASTER_RESET_KEY.
  // Wipes owner/viewer passwords + recovery code back to the hardcoded fallbacks — never
  // touches attendance events, users, or settings.
  const handleMasterReset = async () => {
    setMasterResetError("");
    if (masterKeyInput.trim() !== MASTER_RESET_KEY) { setMasterResetError("That key doesn't match."); return; }
    const ok = await saveAuth(DEFAULT_AUTH, "Full auth reset via master key (owner locked out)");
    if (ok) {
      setMasterResetDone(true);
      setMasterKeyInput("");
    } else {
      setMasterResetError("Could not reset, try again.");
    }
  };

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
      showToast(`${EVENT_LABEL[type] || type} recorded · ${fmtTime(newEvent.timestamp)}`);
    } catch (e) {
      setError("Could not record that, try again.");
    }
    setSaving(false);
  };

  // Owner quick action: force Finish for someone right now (or at an explicit past timestamp when closing
  // an old forgotten shift). Never counts toward overtime.
  const forceUserAction = async (personName, type, atTimestamp) => {
    const ts = atTimestamp != null ? atTimestamp : Date.now();
    const newEvent = { id: Date.now() + "-" + Math.random().toString(36).slice(2), name: personName, type, timestamp: ts };
    if (type === "end") newEvent.forced = true;
    const updated = [...events, newEvent];
    try {
      const res = await window.storage.set(wsKey("attendance-events"), JSON.stringify(updated), true);
      if (!res) throw new Error("no result");
      setEvents(updated);
      const note = type === "end" ? " (not counted as overtime)" : "";
      addAudit(`Owner forced "${EVENT_LABEL[type]}" for "${personName}"${note}`);
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
      showToast(`${EVENT_LABEL[type] || type} recorded · ${fmtTime(newEvent.timestamp)}`);
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
  const myPersonEvents = useMemo(() => events.filter((e) => e.name === myUser), [events, myUser]);
  const myLiveState = useMemo(() => computeRegularLiveState(myPersonEvents, breakLimitMs, standardMs, now), [myPersonEvents, breakLimitMs, standardMs, now]);
  const { status, breakLocked, openBreakStart, enriched, liveWorkedMs, liveElapsedMs, liveBreakMs, shiftDate: myShiftDate, shiftStart: myShiftStart } = myLiveState;
  const liveOvertime = liveBreakMs > breakLimitMs;
  const canFinishNow = liveElapsedMs >= standardMs;

  const myOtLiveState = useMemo(() => computeOtLiveState(myPersonEvents, now), [myPersonEvents, now]);
  const canUseOvertime = status !== "working" && status !== "on_break";

  const autoFinishMyShift = useCallback(async (atTimestamp) => {
    if (!myUser) return;
    const ts = atTimestamp != null ? atTimestamp : Date.now();
    const newEvents = [];
    if (openBreakStart) {
      // Break was left open — close it first so we don't leave a dangling break_start behind.
      newEvents.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2), name: myUser, type: "break_end", timestamp: ts, forced: true });
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
  }, [myUser, events, settings.graceMinutes, openBreakStart]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const dates = weekDates();
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
    const dates = new Set(weekDates());
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
      if (!base[name]) base[name] = { workedMs: 0, overtimeMs: 0, breaks: [], totalBreakMs: 0, overtimeCount: 0, hasForcedClose: false, hasEarlyLeave: false, earlyLeaveNote: "", events: [], shiftCount: 0, stillOpen: false, start: null, end: null };
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
    for (const info of Object.values(userInfoByUser)) {
      if (info.status === "working") working += 1;
      if (info.status === "on_break") onBreak += 1;
      if (info.otActive) onOt += 1;
    }
    return { working, onBreak, onOt };
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
      .map(([name, info]) => ({ name, status: info.status }))
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

  const periodSummary = useMemo(() => {
    const dates = summaryPeriod === "week" ? weekDates() : monthDates();
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

  const BUTTONS = [
    { type: "start", label: "Start", icon: Play, color: "emerald", enabled: status === "not_started" && !myOtLiveState.active },
    { type: "break_start", label: "Break", icon: Coffee, color: "amber", enabled: status === "working" && !breakLocked && !canFinishNow },
    { type: "break_end", label: "Back", icon: RotateCcw, color: "sky", enabled: status === "on_break" },
    { type: "end", label: "Finish", icon: Square, color: "rose", enabled: status === "working" },
  ];

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
          <div className="flex bg-neutral-900 rounded-lg p-1 gap-1">
            <button onClick={() => setTab("track")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "track" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
              Track
            </button>
            <button onClick={() => setTab("dashboard")} className={`relative flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === "dashboard" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
              {!role && <Lock size={11} />}
              Dashboard
              {pendingOtBlocks.length + openIssues.length > 0 && (
                <span
                  title={`${pendingOtBlocks.length + openIssues.length} item(s) need attention`}
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none"
                >
                  {pendingOtBlocks.length + openIssues.length}
                </span>
              )}
            </button>
          </div>
          {onSwitchWorkspace && (
            <button
              title="Switch dashboard"
              onClick={onSwitchWorkspace}
              className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-900"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </div>

      {/* TRACK TAB */}
      {tab === "track" && (
        <div className="p-4 sm:p-5 max-w-md mx-auto">
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
                    <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Password" className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <button onClick={handleLogin} className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0">Enter</button>
                  </div>
                  {loginError && <p className="mt-2 text-xs text-rose-400 text-center">{loginError}</p>}
                </>
              )}
            </div>
          ) : !myRecord ? (
            <div className="py-10 text-center">
              <p className="text-sm text-neutral-400">Your user was removed. Contact your manager.</p>
            </div>
          ) : myRecord.locked ? (
            <div className="py-10 text-center">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
                <Lock size={16} className="text-rose-400" />
              </div>
              <p className="text-sm text-neutral-300">Your access is locked.</p>
              <p className="text-xs text-neutral-500 mt-1">Contact your manager to get it reopened.</p>
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
                  <button title="Log out" onClick={handleTrackLogout} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                    <LogOut size={15} />
                  </button>
                </div>
              </div>

              <div className="flex bg-neutral-900 rounded-lg p-1 gap-1 mb-4">
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
                        <li><span className="text-neutral-300 font-medium">Start</span> — begin your shift</li>
                        <li><span className="text-neutral-300 font-medium">Break</span> — step away, the clock keeps track</li>
                        <li><span className="text-neutral-300 font-medium">Back</span> — you're back from break</li>
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
                      </>
                    )}
                  </div>

                  {(status === "working" || status === "on_break") && (
                    <div className="mb-5">
                      <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
                        <span>Toward {settings.standardHours}h{status === "on_break" ? " (on break)" : ""}</span>
                        <span>{Math.min(100, Math.round((liveElapsedMs / standardMs) * 100))}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${status === "on_break" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (liveElapsedMs / standardMs) * 100)}%` }} />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-5">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${breakLocked ? "bg-rose-500/10 text-rose-400" : "bg-neutral-900 text-neutral-500"}`}>
                      {breakLocked ? "Break used — locked" : "Break available"}
                    </span>
                  </div>

                  {status === "on_break" && (
                    <div className={`mb-5 rounded-lg px-3 py-2 text-xs font-medium ${liveOvertime ? "bg-rose-500/10 text-rose-400" : breakLimitMs - liveBreakMs <= 5 * 60000 ? "bg-amber-500/10 text-amber-400" : "bg-amber-500/10 text-amber-400"}`}>
                      {liveOvertime
                        ? `On break for ${fmtDuration(liveBreakMs)} — over the limit`
                        : breakLimitMs - liveBreakMs <= 5 * 60000
                        ? `Break limit almost up — ${fmtDuration(breakLimitMs - liveBreakMs)} left`
                        : `On break for ${fmtDuration(liveBreakMs)}`}
                    </div>
                  )}
                  {showReachedPrompt && (status === "working" || status === "on_break") && (
                    <div className="mb-5 rounded-lg px-3 py-2 bg-sky-500/10">
                      <p className="text-xs font-medium text-sky-400 mb-2">
                        You've reached {settings.standardHours}h{status === "on_break" ? " (including your open break)" : ""}. If there's no response, this shift auto-closes in {settings.graceMinutes} min{status === "on_break" ? ", ending your break too" : ""} (won't count as overtime). Need to keep working? Use the separate Overtime tab.
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => { setShowReachedPrompt(false); playClickSound("end"); if (status === "on_break") addEvent("break_end").then(() => addEvent("end")); else addEvent("end"); }} className="flex-1 bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg">Finish now</button>
                        <button onClick={snoozeReached} className="flex-1 border border-sky-800 text-sky-300 text-xs font-medium px-3 py-1.5 rounded-lg">I'm still here</button>
                      </div>
                    </div>
                  )}
                  {breakLocked && status !== "on_break" && status !== "finished" && (
                    <div className="mb-5 rounded-lg px-3 py-2 text-xs font-medium bg-rose-500/10 text-rose-400">
                      Break limit used — your break went over {settings.breakLimitMinutes} min, so break is locked for this shift.
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
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
                        {coworkersNow.map((c) => (
                          <span key={c.name} className="flex items-center gap-1.5 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-full px-2.5 py-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${c.status === "working" ? "bg-emerald-400" : "bg-amber-400"}`} />
                            {c.name}
                          </span>
                        ))}
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
                              <span className="text-neutral-400">{EVENT_LABEL[ev.type]}</span>
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
            </>
          )}
        </div>
      )}

      {/* DASHBOARD LOGIN */}
      {tab === "dashboard" && !role && (
        <div className="p-4 sm:p-5">
          <div className="max-w-sm mx-auto pt-8 pb-8 text-center">
            <div
              className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4"
              style={{ animation: "logoPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
            >
              <Lock size={20} className="text-emerald-400" />
            </div>
            <p className="text-sm text-neutral-400 mb-3">Dashboard access</p>
            {!showForgotPanel ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={pwInput}
                    onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (pwInput === effectiveOwnerPassword) { setRole("owner"); setDashTab("overview"); }
                        else if (pwInput === effectiveViewerPassword) { setRole("viewer"); setDashTab("overview"); }
                        else setPwError(true);
                      }
                    }}
                    placeholder="Password"
                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
                  />
                  <button
                    onClick={() => {
                      if (pwInput === effectiveOwnerPassword) { setRole("owner"); setDashTab("overview"); }
                      else if (pwInput === effectiveViewerPassword) { setRole("viewer"); setDashTab("overview"); }
                      else setPwError(true);
                    }}
                    className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                  >
                    Unlock
                  </button>
                </div>
                {pwError && <p className="mt-2 text-xs text-rose-400">Wrong password.</p>}
                <button onClick={() => setShowForgotPanel(true)} className="mt-4 text-xs text-neutral-500 hover:text-neutral-300 underline">
                  Forgot owner password?
                </button>
              </>
            ) : !showMasterReset ? (
              <div className="text-left space-y-2">
                <p className="text-xs text-neutral-400 flex items-center gap-1.5"><ShieldQuestion size={13} /> Enter your recovery code to set a new owner password</p>
                {forgotError && <p className="text-xs text-rose-400">{forgotError}</p>}
                <input value={forgotRecoveryCode} onChange={(e) => setForgotRecoveryCode(e.target.value)} placeholder="Recovery code" className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                <input type="password" value={forgotNewPassword} onChange={(e) => setForgotNewPassword(e.target.value)} placeholder="New owner password" className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                <div className="flex gap-2 pt-1">
                  <button onClick={handleForgotReset} className="flex-1 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg">Reset password</button>
                  <button onClick={() => { setShowForgotPanel(false); setForgotError(""); }} className="text-sm text-neutral-400 px-2">Cancel</button>
                </div>
                <button
                  onClick={() => { setShowMasterReset(true); setForgotError(""); setMasterResetError(""); setMasterResetDone(false); }}
                  className="w-full text-center text-[11px] text-neutral-600 hover:text-neutral-400 underline pt-1"
                >
                  Lost the recovery code too?
                </button>
              </div>
            ) : (
              <div className="text-left space-y-2">
                {!masterResetDone ? (
                  <>
                    <p className="text-xs text-neutral-400 flex items-center gap-1.5"><ShieldQuestion size={13} /> Enter the master key to fully reset dashboard access</p>
                    <p className="text-[10px] text-neutral-600">This only works if you have the master key from whoever built this dashboard. It resets owner + viewer passwords and the recovery code back to defaults — nothing else is touched.</p>
                    {masterResetError && <p className="text-xs text-rose-400">{masterResetError}</p>}
                    <input type="password" value={masterKeyInput} onChange={(e) => setMasterKeyInput(e.target.value)} placeholder="Master key" className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <div className="flex gap-2 pt-1">
                      <button onClick={handleMasterReset} className="flex-1 bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg">Reset access</button>
                      <button onClick={() => { setShowMasterReset(false); setMasterKeyInput(""); setMasterResetError(""); }} className="text-sm text-neutral-400 px-2">Back</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-emerald-400">Access reset. Log back in with the default passwords, then set new ones right away from Settings:</p>
                    <p className="text-[11px] text-neutral-400">Owner: <span className="text-neutral-200 font-mono">{OWNER_PASSWORD_FALLBACK}</span> · Viewer: <span className="text-neutral-200 font-mono">{VIEWER_PASSWORD_FALLBACK}</span></p>
                    <button
                      onClick={() => { setShowForgotPanel(false); setShowMasterReset(false); setMasterResetDone(false); setPwError(false); }}
                      className="w-full bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg mt-1"
                    >
                      Back to login
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANDATORY FIRST-RUN RECOVERY CODE SETUP — blocks the dashboard until the owner sets one */}
      {tab === "dashboard" && role === "owner" && !auth.recoveryCode && (
        <div className="p-4 sm:p-5">
          <div className="max-w-sm mx-auto py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
              <ShieldQuestion size={16} className="text-amber-400" />
            </div>
            <p className="text-sm text-neutral-200 font-medium mb-1.5">Set a recovery code before you continue</p>
            <p className="text-xs text-neutral-500 mb-4">If you ever forget your owner password, this code is the only way to get back in without wiping everyone's data. Choose something you'll remember or write down — not the password itself.</p>
            {firstRunRecoveryError && <p className="text-xs text-rose-400 mb-2">{firstRunRecoveryError}</p>}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={firstRunRecoveryInput}
                onChange={(e) => { setFirstRunRecoveryInput(e.target.value); setFirstRunRecoveryError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleFirstRunRecoverySave(); }}
                placeholder="Recovery code"
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500"
              />
              <button onClick={handleFirstRunRecoverySave} className="bg-neutral-100 text-neutral-900 text-sm font-medium px-4 py-2 rounded-lg shrink-0">
                Save & continue
              </button>
            </div>
            <p className="mt-4 text-[10px] text-neutral-600">You can change this anytime later from Settings → Dashboard passwords.</p>
          </div>
        </div>
      )}

      {/* DASHBOARD */}
      {tab === "dashboard" && role && (role === "viewer" || auth.recoveryCode) && (
        <div className="p-4 sm:p-5">
          <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex flex-wrap bg-neutral-900 rounded-lg p-1 gap-1">
              {[
                { key: "overview", label: "Overview", icon: Home, badge: pendingOtBlocks.length + openIssues.length },
                role === "owner" && { key: "users", label: "Users", icon: UsersIcon },
                { key: "report", label: "Report", icon: BarChart3 },
                { key: "summary", label: "Summary", icon: CalendarRange },
                role === "owner" && { key: "settings", label: "Settings", icon: SettingsIcon },
                role === "owner" && { key: "activity", label: "Activity", icon: ActivityIcon },
              ].filter(Boolean).map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => setDashTab(t.key)} className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${dashTab === t.key ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"}`}>
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
              <span className="text-[10px] text-neutral-600 px-2">{role === "owner" ? "Owner" : "Viewer"}</span>
              <button title="Lock dashboard" onClick={handleDashboardLock} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900">
                <LogOut size={15} />
              </button>
            </div>
          </div>

          {dashError && <p className="mb-3 text-xs text-rose-400">{dashError}</p>}

          {/* OVERVIEW */}
          {dashTab === "overview" && (
            <div className="max-w-2xl">
              <p className="text-xs text-neutral-500 mb-3">Today at a glance — {fmtDateLabel(todayKey())}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <p className="text-[10px] text-neutral-500 mb-1">Working now</p>
                  <p className="text-lg font-semibold text-emerald-400">{liveCounts.working}</p>
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

              {role === "owner" && pendingOtBlocks.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-900/40 rounded-xl p-4 mb-4">
                  <p className="text-xs text-amber-400 mb-2 flex items-center gap-1.5"><Zap size={12} /> {pendingOtBlocks.length} overtime session{pendingOtBlocks.length > 1 ? "s" : ""} awaiting your review</p>
                  <div className="space-y-2">
                    {pendingOtBlocks.slice(0, 6).map((b) => (
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
                    {pendingOtBlocks.length > 6 && <p className="text-[11px] text-neutral-600">+{pendingOtBlocks.length - 6} more — see Report</p>}
                  </div>
                </div>
              )}

              {openIssues.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-900/40 rounded-xl p-4 mb-4">
                  <p className="text-xs text-rose-400 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {openIssues.length} unclosed shift{openIssues.length > 1 ? "s" : ""} need attention</p>
                  <div className="space-y-1.5">
                    {openIssues.slice(0, 5).map((issue) => (
                      <div key={issue.name + issue.date} className="flex items-center justify-between text-xs">
                        <span className="text-neutral-300">{issue.name} <span className="text-neutral-600">— {fmtDateShort(issue.date)}</span></span>
                        {role === "owner" && (
                          <button onClick={() => forceUserAction(issue.name, "end", new Date(issue.date + "T23:59:00").getTime())} className="text-amber-400 hover:text-amber-300 font-medium">Close out now</button>
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
                    return (
                      <button key={p.name} onClick={() => goToPersonReport(p.name)} className="w-full text-left bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold ${ac.bg} ${ac.text}`}>{p.name.trim()[0].toUpperCase()}</div>
                            <span className="text-sm font-medium text-neutral-200">{p.name}</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${p.status === "working" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                              {p.status === "working" ? "Working" : "On break"}
                            </span>
                            {p.otActive && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap bg-amber-500/10 text-amber-400">OT</span>}
                          </div>
                          <span className="text-xs font-mono text-neutral-400 shrink-0">{fmtDuration(p.liveElapsedMs)}</span>
                        </div>
                        <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${p.status === "on_break" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* USERS (owner only) */}
          {dashTab === "users" && role === "owner" && (
            <div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4 max-w-md">
                <p className="text-xs text-neutral-500 mb-2">Add a new user</p>
                <div className="flex flex-col sm:flex-row gap-2 mb-2">
                  <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Name" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                  <input value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Password" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                </div>
                <button
                  onClick={async () => {
                    setDashError("");
                    const trimmed = newUserName.trim();
                    if (!trimmed || !newUserPassword.trim()) { setDashError("Enter a name and password."); return; }
                    if (users[trimmed]) { setDashError("That name already exists."); return; }
                    const updated = { ...users, [trimmed]: { password: newUserPassword.trim(), locked: false, note: "", team: "" } };
                    const ok = await saveUsers(updated, `Added user "${trimmed}"`);
                    if (ok) { setNewUserName(""); setNewUserPassword(""); }
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
                {Object.entries(users).filter(([uname]) => matchesSearch(uname)).sort(([a], [b]) => a.localeCompare(b)).map(([uname, rec]) => {
                  const info = userInfoByUser[uname] || { status: "not_started", todayWorkedMs: 0, lastEventTs: null };
                  const badge = STATUS_BADGE[info.status];
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
                          </button>
                          {rec.team && <span className="text-[10px] font-medium text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full whitespace-nowrap">{rec.team}</span>}
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
                          <button title="Team" onClick={() => { setEditingTeamFor(editingTeamFor === uname ? "" : uname); setTeamEditValue(rec.team || ""); }} className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
                            <Tag size={14} />
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
                          <button onClick={() => forceUserAction(uname, "end")} className="text-[11px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Force Finish now
                          </button>
                        )}
                      </div>

                      {rec.note && editingNoteFor !== uname && <p className="mt-2 text-[11px] text-neutral-500 italic">"{rec.note}"</p>}

                      {editingPwFor === uname && (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <input value={pwEditValue} onChange={(e) => setPwEditValue(e.target.value)} placeholder="New password" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
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
                        <option value="otSessions">Overtime sessions (one row per session)</option>
                        <option value="full">Full log (every button press)</option>
                      </select>
                    </div>
                  </div>
                  {exportMode === "summary" && (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ["start", "Start"],
                        ["finish", "Finish"],
                        ["worked", "Worked"],
                        ["overtime", "Overtime"],
                        ["breaks", "Breaks"],
                        ["breakTime", "Break time"],
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
                  {exportMode === "otSessions" && (
                    <p className="text-xs text-neutral-500">One row per overtime session — start, end, duration, reason, and approval status. Nothing to configure.</p>
                  )}
                  {exportMode === "full" && (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        [exportFullWork, setExportFullWork, "Start / Finish events"],
                        [exportFullBreaks, setExportFullBreaks, "Break / Back events"],
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
                              <button onClick={() => forceUserAction(person, "end", new Date(reportDate + "T23:59:00").getTime())} className="text-[11px] font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                                No finish recorded · Close out now
                              </button>
                            )}
                            {isPast && s.stillOpen && !isLiveShift && role !== "owner" && (
                              <span className="text-[11px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">No finish recorded</span>
                            )}
                            {s.stillOpen && isLiveShift && (
                              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                                {crossesMidnight ? "Still working (crosses into today)" : "Still working"}
                              </span>
                            )}
                            {s.overtimeMs > 0 && (
                              <span className="text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">+{fmtDuration(s.overtimeMs)} overtime</span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-neutral-500 mb-0.5">Start</p>
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
                        </div>
                        {s.otBlocks && s.otBlocks.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2">
                            <p className="text-[11px] text-neutral-500 flex items-center gap-1.5"><Zap size={11} className="text-amber-400" /> Overtime sessions</p>
                            {s.otBlocks.map((b) => (
                              <div key={b.id} className="bg-neutral-950/60 rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-xs text-neutral-300 font-mono">
                                    {fmtTime(b.start)} – {b.end ? fmtTime(b.end) : "…"}
                                    {b.end && <span className="text-neutral-500"> ({fmtDuration(b.end - b.start)})</span>}
                                    {b.forced && <span className="text-neutral-600"> (auto-closed)</span>}
                                  </span>
                                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                                    b.status === "approved" ? "bg-emerald-500/10 text-emerald-400" : b.status === "denied" ? "bg-rose-500/10 text-rose-400" : "bg-neutral-800 text-neutral-400"
                                  }`}>
                                    {b.status === "approved" ? "Approved" : b.status === "denied" ? "Denied" : "Pending review"}
                                  </span>
                                </div>
                                {b.reason && <p className="mt-1 text-[11px] text-neutral-500 italic">"{b.reason}"</p>}
                                {role === "owner" && (
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={() => recordOtDecision(person, b.id, "ot_approve")}
                                      disabled={b.status === "approved"}
                                      className={`flex-1 text-[11px] font-medium px-2 py-1 rounded-md ${b.status === "approved" ? "bg-emerald-500/10 text-emerald-400 opacity-40 cursor-default" : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"}`}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => recordOtDecision(person, b.id, "ot_deny")}
                                      disabled={b.status === "denied"}
                                      className={`flex-1 text-[11px] font-medium px-2 py-1 rounded-md ${b.status === "denied" ? "bg-rose-500/10 text-rose-400 opacity-40 cursor-default" : "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"}`}
                                    >
                                      Deny
                                    </button>
                                  </div>
                                )}
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
                              return sorted.map((ev) => {
                                let durationLabel = "";
                                let isOver = false;
                                if (ev.type === "break_start") openBreak = ev.timestamp;
                                if (ev.type === "break_end" && openBreak) {
                                  const dur = ev.timestamp - openBreak;
                                  durationLabel = fmtDuration(dur);
                                  isOver = dur > breakLimitMs;
                                  openBreak = null;
                                }
                                return (
                                  <div key={ev.id} className="flex items-center justify-between text-xs">
                                    <span className="text-neutral-400">
                                      {EVENT_LABEL[ev.type]}
                                      {ev.forced && <span className="text-neutral-600"> (auto)</span>}
                                      {ev.earlyLeave && <span className="text-violet-400"> (left early{ev.note ? `: ${ev.note}` : ""})</span>}
                                      {durationLabel && <span className={isOver ? "text-rose-400" : "text-neutral-600"}> · {durationLabel}</span>}
                                    </span>
                                    <span className={`font-mono ${isOver ? "text-rose-400 font-semibold" : "text-neutral-500"}`}>{fmtTime(ev.timestamp)}</span>
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

          {/* SETTINGS (owner only) */}
          {dashTab === "settings" && role === "owner" && (
            <div className="max-w-sm space-y-4">
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
                <p className="text-[11px] text-neutral-600 mb-3">Finish stays locked until this many hours pass since Start (break included). Once reached, a sound alert repeats every 5 minutes until there's a response. Extra work beyond this goes through the separate Overtime tab.</p>
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
                <p className="text-xs text-neutral-500">Dashboard passwords</p>

                <div>
                  <p className="text-[11px] text-neutral-600 mb-2">Owner password — you're already signed in, so just set a new one</p>
                  {changeOwnerMsg && <p className={`text-[11px] mb-1.5 ${changeOwnerMsg === "Password updated." ? "text-emerald-400" : "text-rose-400"}`}>{changeOwnerMsg}</p>}
                  <div className="flex gap-2">
                    <input type="password" value={changeOwnerNew} onChange={(e) => setChangeOwnerNew(e.target.value)} placeholder="New password" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <button onClick={handleChangeOwnerPassword} className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0">Save</button>
                  </div>
                </div>

                <div className="pt-2 border-t border-neutral-800">
                  <p className="text-[11px] text-neutral-600 mb-1">Recovery code</p>
                  {auth.recoveryCode ? (
                    <p className="text-[10px] text-neutral-600 mb-2">A recovery code is set. Keep it somewhere safe.</p>
                  ) : (
                    <p className="text-[10px] text-amber-400 mb-2 flex items-start gap-1"><ShieldQuestion size={12} className="mt-0.5 shrink-0" /> No recovery code set — you won't be able to reset your password if you forget it. Set one now.</p>
                  )}
                  {recoveryMsg && <p className="text-[11px] text-emerald-400 mb-1.5">{recoveryMsg}</p>}
                  <div className="flex gap-2">
                    <input value={recoveryCodeInput} onChange={(e) => setRecoveryCodeInput(e.target.value)} placeholder="New recovery code" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <button onClick={handleSetRecoveryCode} className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0">Save</button>
                  </div>
                </div>

                <div className="pt-2 border-t border-neutral-800">
                  <p className="text-[11px] text-neutral-600 mb-2">Viewer password</p>
                  {viewerPwMsg && <p className="text-[11px] text-emerald-400 mb-1.5">{viewerPwMsg}</p>}
                  <div className="flex gap-2">
                    <input type="password" value={viewerPasswordInput} onChange={(e) => setViewerPasswordInput(e.target.value)} placeholder="New viewer password" className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-neutral-500" />
                    <button onClick={handleSetViewerPassword} className="bg-neutral-100 text-neutral-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0">Save</button>
                  </div>
                </div>

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
          {dashTab === "activity" && role === "owner" && (
            <div className="max-w-md">
              {audit.length === 0 ? (
                <div className="py-12 text-center text-neutral-600 text-sm">No activity yet</div>
              ) : (
                <div className="space-y-1.5">
                  {audit.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                      <span className="text-neutral-300">{a.text}</span>
                      <span className="text-neutral-600 font-mono shrink-0 ml-2">{fmtTime(a.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
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
// before their name + password can be used to sign in. The chosen Dashboard
// is remembered only for this browser tab session — closing and reopening
// the app always asks again, on purpose.
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

function AdminApprovalScreen() {
  const [registry, setRegistry] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const [resetKey, setResetKey] = useState("");
  const [resetValue, setResetValue] = useState("");
  const [resetMsg, setResetMsg] = useState("");

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
                </div>
              </div>
              {resetKey === key && (
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-neutral-800">
                  <input
                    type="text"
                    value={resetValue}
                    onChange={(e) => setResetValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitReset(key); }}
                    placeholder="New password"
                    className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50"
                  />
                  <button disabled={busyKey === key} onClick={() => submitReset(key)} className="text-xs font-medium bg-neutral-100 text-neutral-900 rounded-md px-3 py-1.5">
                    Save
                  </button>
                </div>
              )}
              {resetKey === key && resetMsg && <p className="text-[10px] text-emerald-400 mt-1.5">{resetMsg}</p>}
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && mode === "enter") submit(); }}
            placeholder={mode === "enter" ? "Password" : "Choose a password"}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50 text-center"
          />
          {mode === "create" && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Confirm password"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-violet-500/50 text-center"
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

function WorkspacePendingScreen({ displayName, onCheckAgain, onUseDifferent, checking }) {
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
      </div>
    </div>
  );
}

export default function App() {
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

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 1900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === ADMIN_SECRET) {
      setPhase("admin");
      return;
    }
    // Deliberately session-only: closing and reopening the browser always
    // asks for the Dashboard name + password again.
    const saved = window.sessionStorage.getItem("workspace-name");
    if (saved) {
      (async () => {
        const reg = await loadRegistry();
        const entry = reg[saved];
        if (entry?.status === "approved" && !entry.locked) {
          setWorkspaceKey(saved);
          setDisplayName(entry.displayName || saved);
          setPhase("ready");
        } else if (entry?.status === "approved" && entry.locked) {
          window.sessionStorage.removeItem("workspace-name");
          setError("This Dashboard is locked. Contact your administrator.");
          setPhase("gate");
        } else if (entry?.status === "pending") {
          setWorkspaceKey(saved);
          setDisplayName(entry.displayName || saved);
          setPhase("pending");
        } else {
          window.sessionStorage.removeItem("workspace-name");
          setPhase("gate");
        }
      })();
    } else {
      setPhase("gate");
    }
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
    window.sessionStorage.setItem("workspace-name", norm);
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
    window.sessionStorage.setItem("workspace-name", norm);
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
      window.sessionStorage.removeItem("workspace-name");
      setPhase("gate");
      setError("That request was declined. Try a different name.");
    }
    setSubmitting(false);
  };

  const handleUseDifferent = () => {
    window.sessionStorage.removeItem("workspace-name");
    resetGateFields();
    setMode("enter");
    setPhase("gate");
  };

  const handleSwitchWorkspace = () => {
    window.sessionStorage.removeItem("workspace-name");
    setWorkspaceKey("");
    resetGateFields();
    setMode("enter");
    setPhase("gate");
  };

  if (showSplash || phase === "loading") {
    return <SplashScreen />;
  }
  if (phase === "admin") {
    return <AdminApprovalScreen />;
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
      />
    );
  }

  return <Shiftly key={workspaceKey} workspaceName={workspaceKey} workspaceDisplayName={displayName} onSwitchWorkspace={handleSwitchWorkspace} />;
}
