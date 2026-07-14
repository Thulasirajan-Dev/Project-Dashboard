// ============================================================
//  Winner Holistic Consultants – Shared Utilities
//  shared/shared.js — Common to all modules
// ============================================================

// ── Data helpers (cPanel MySQL via /api/data.php) ─────────────
//  These keep the SAME names (fbGet/fbSet/fbDelete) and the SAME
//  path-based contract the app already uses, so page code is
//  unchanged — only the backend moved from Firebase to MySQL.
//  Each call POSTs { op, path, data } to the PHP data API, which
//  translates the path into SQL and returns Firebase-shaped JSON.
var DATA_API = "/api/data.php";

// In-memory read cache (unchanged behaviour): cuts redundant reads
// of large collections when navigating between tabs within a session.
var _fbCache = new Map();          // path -> { t: timestamp, v: value }
var _FB_TTL = 15000;               // 15s; tune as needed

function _fbInvalidate(path) {
  // Invalidate the path and any parent collection (e.g. writing
  // projects/x clears the cached "projects" too).
  const top = String(path).split("/")[0];
  for (const k of _fbCache.keys()) {
    if (k === path || k === top || k.startsWith(top + "/") || k.startsWith(top + ".")) _fbCache.delete(k);
  }
}

async function _dataCall(op, path, data) {
  const res = await fetch(DATA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ op, path, data }),
  });
  if (res.status === 401) {
    // Either not authenticated, or (see api/db/conn.php session_still_current)
    // this account signed in elsewhere and this session was invalidated.
    // Silently failing here would leave the user stuck clicking a dead UI —
    // send them back to login with a clear reason instead.
    let msg = "";
    try { msg = (await res.json()).error || ""; } catch (e) {}
    clearSession();
    if (typeof window !== "undefined" && !/\/auth\/?$/.test(window.location.pathname)) {
      window.location.href = "/auth/?session_replaced=" + (msg.toLowerCase().includes("another device") ? "1" : "0");
    }
    throw new Error(msg || "Not authenticated");
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (e) {}
    throw new Error(detail || ("API error " + res.status));
  }
  return res.json();
}

async function fbGet(path, opts) {
  const noCache = opts && opts.fresh;
  if (!noCache) {
    const hit = _fbCache.get(path);
    if (hit && (Date.now() - hit.t) < _FB_TTL) return hit.v;
  }
  try {
    const v = await _dataCall("get", path, null);
    _fbCache.set(path, { t: Date.now(), v });
    return v;
  } catch (e) { return null; }
}
async function fbSet(path, data) {
  try {
    await _dataCall("set", path, data);
    _fbInvalidate(path);
    return true;
  } catch (e) { return false; }
}
async function fbDelete(path) {
  try {
    await _dataCall("delete", path, null);
    _fbInvalidate(path);
    return true;
  } catch (e) { return false; }
}
// Atomically increment a counter and return the value it had BEFORE
// incrementing (the number to use). Never races: see the 'increment' op
// in api/data.php (row-locked transaction), used for quotation numbering
// so two simultaneous "New Quotation" clicks can never get the same seq.
async function fbIncrement(path, startSeq) {
  try {
    const res = await _dataCall("increment", path, { startSeq: startSeq || 1 });
    _fbInvalidate(path);
    return (res && typeof res.seq === "number") ? res.seq : null;
  } catch (e) { return null; }
}

// ── Persistent (localStorage) cache for big collections ─────────
// Survives page reloads, unlike the in-memory _fbCache. Use for
// heavy reads like "projects" on staff dashboards. Pattern:
//   const projects = await fbGetCachedSWR("projects", onFresh);
// It returns the cached value immediately (or null) and calls
// onFresh(data) later if the server copy differs. Keeps Firebase
// downloads low when the same user reloads/navigates.
function _lsGet(key) { try { const r = localStorage.getItem(key); return r?JSON.parse(r):null; } catch(e){ return null; } }
function _lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch(e){} }

async function fbGetCachedSWR(path, onFresh, freshMs) {
  const key = "whc_swr_" + path;
  const cached = _lsGet(key);
  const ttl = freshMs == null ? 60000 : freshMs;
  const cachedData = cached ? cached.data : null;
  const isFresh = cached && (Date.now() - (cached.at||0) < ttl);

  // Revalidate in background unless very fresh.
  if (!isFresh) {
    fbGet(path, { fresh: true }).then(data => {
      if (data == null) return;
      const prevJson = cached ? JSON.stringify(cached.data) : "";
      _lsSet(key, { at: Date.now(), data });
      if (JSON.stringify(data) !== prevJson && typeof onFresh === "function") onFresh(data);
    }).catch(()=>{});
  }
  return cachedData;
}


// ── Audit trail (shared across all modules) ──────────────────
// stampAudit(record, isEdit): adds createdBy/createdAt or lastEditedBy/
//   lastEditedAt and appends to record.editHistory. Returns the record.
// logActivity(entry): appends a row to the global "activity_log" in Firebase
//   so there is one combined feed across every module.
function currentActor() {
  const u = getSession() || {};
  return { name: u.name || "Unknown", email: u.email || "", role: u.role || "", id: u.id || "" };
}

// ── Global dropdown option lists ──────────────────────────────
// Editable dropdowns (datalists) whose custom entries persist globally.
var WHC_OPTIONS = {};
var _OPTION_DEFAULTS = {
  subcontractor_type: ["ADM", "ADDC", "Local / ADDC", "Freelancer"],
  govt_fee_type: ["Government Dept", "Aldar Tasareeh", "ADM Fees", "ADDC Fees", "Other Govt Fee"]
};
async function loadOptionList(type) {
  try {
    const saved = await fbGet(coPath("options/" + type));
    const defaults = _OPTION_DEFAULTS[type] || [];
    const merged = Array.from(new Set([...(defaults), ...((saved && saved.list) || [])]));
    WHC_OPTIONS[type] = merged;
    return merged;
  } catch (e) {
    WHC_OPTIONS[type] = _OPTION_DEFAULTS[type] || [];
    return WHC_OPTIONS[type];
  }
}
async function loadAllOptionLists() {
  await Promise.all(Object.keys(_OPTION_DEFAULTS).map(t => loadOptionList(t)));
  return WHC_OPTIONS;
}
function getOptionList(type) {
  return WHC_OPTIONS[type] || _OPTION_DEFAULTS[type] || [];
}
async function addOptionValue(type, value) {
  value = (value || "").trim();
  if (!value) return;
  const cur = getOptionList(type);
  if (cur.some(v => v.toLowerCase() === value.toLowerCase())) return;
  const defaults = _OPTION_DEFAULTS[type] || [];
  const customs = Array.from(new Set([...cur.filter(v => !defaults.includes(v)), value]));
  WHC_OPTIONS[type] = Array.from(new Set([...cur, value]));
  try { await fbSet(coPath("options/" + type), { list: customs }); } catch (e) {}
}
// Render a datalist-backed editable input (type new or pick existing).
function editableSelect(type, currentVal, onInputExpr, styleStr) {
  const listId = "dl_" + type;
  const opts = getOptionList(type).map(v => `<option value="${esc(v)}"></option>`).join("");
  return `<input class="fi" list="${listId}" value="${esc(currentVal||"")}" style="${styleStr||""}" placeholder="Pick or type new"
    oninput="${onInputExpr}" onchange="addOptionValue('${type}', this.value)"/>
    <datalist id="${listId}">${opts}</datalist>`;
}

// ── Global user directory for email <-> name display ──────────
// Ownership/attribution is stored by EMAIL everywhere. Names are for display
// only. Any page loads the directory once (loadUserDirectory) and uses
// resolveUserName() to turn a stored email back into a friendly name.
var WHC_USERS = [];
async function loadUserDirectory() {
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ action: "list_users" })
    });
    const data = await res.json();
    WHC_USERS = (data && data.users) || [];
  } catch (e) { WHC_USERS = []; }
  return WHC_USERS;
}
// Turn a stored owner/actor value (email, or legacy name) into a display name.
function resolveUserName(val) {
  if (!val) return "";
  const list = (typeof WHC_USERS !== "undefined" && WHC_USERS.length) ? WHC_USERS : [];
  const u = list.find(x => (x.email || "").toLowerCase() === String(val).toLowerCase() || x.name === val);
  return u ? u.name : val;   // fall back to the raw value if unknown
}
// The email to store for the logged-in actor (falls back to name if no email).

// ── Pictorial, clickable stat tile row ──────────────────────────
// Single shared renderer so Coordinator/Account/Proposals all look and
// behave consistently. tiles: [{ n, l, icon, c, f, title, onclick }]
// n=count, l=label, icon=emoji, c=accent color, onclick=JS string,
// active=bool (highlights the currently-selected tile).
function renderStatTiles(tiles, opts) {
  const minPx = (opts && opts.minPx) || 100;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${minPx}px,1fr));gap:10px">
    ${tiles.map(t => `<div class="stat-tile${t.active?' stat-tile-on':''}" style="--tile-color:${t.c}" title="${esc(t.title||'')}" onclick="${t.onclick}">
      <div class="stat-tile-icon">${t.icon||'📌'}</div>
      <div class="stat-tile-n">${t.n}</div>
      <div class="stat-tile-l">${esc(t.l)}</div>
    </div>`).join("")}
  </div>`;
}

function stampAudit(record, isEdit) {
  const who = currentActor();
  const now = new Date().toISOString();
  if (!record || typeof record !== "object") return record;
  if (isEdit) {
    if (!record.createdAt) record.createdAt = now;
    if (!record.createdBy) record.createdBy = who.name;
    record.lastEditedAt = now;
    record.lastEditedBy = who.name;
    record.lastEditedByRole = who.role;
  } else {
    record.createdAt = now;
    record.createdBy = who.name;
    record.createdByRole = who.role;
  }
  const hist = Array.isArray(record.editHistory) ? record.editHistory.slice() : [];
  hist.push({ action: isEdit ? "edited" : "created", by: who.name, role: who.role, at: now });
  record.editHistory = hist;
  return record;
}

// Save a project by writing ONLY the top-level keys that actually changed
// since it was loaded (comparing against the snapshot taken at open time),
// via targeted sub-path writes — NEVER a full-object overwrite. This means
// a field nobody touched in THIS session can never be clobbered by this
// save, even if another user (Coordinator/Account/Proposals/Team Lead)
// changed it in the meantime — e.g. Account crediting a milestone while
// Coordinator has the same project open editing approval stages. The
// server already merges sub-path writes against the current DB row (see
// handleProjects in data.php), so each changed key lands correctly.
// Residual risk: if the SAME key is edited by two people in the same
// window, last-write-wins for that one key — unavoidable without locking,
// and a much smaller conflict surface than a full-object overwrite.
async function saveProjectDiff(projectId, snapshot, current) {
  if (!projectId || !current) return false;
  const keys = new Set([...Object.keys(snapshot || {}), ...Object.keys(current)]);
  const changedKeys = [];
  keys.forEach(k => {
    const a = JSON.stringify((snapshot && snapshot[k]) != null ? snapshot[k] : null);
    const b = JSON.stringify(current[k] != null ? current[k] : null);
    if (a !== b) changedKeys.push(k);
  });
  if (!changedKeys.length) return true; // nothing changed — nothing to save
  let allOk = true;
  for (const k of changedKeys) {
    const ok = await fbSet(coPath("projects/" + projectId + "/" + k), current[k]);
    if (!ok) allOk = false;
  }
  return allOk;
}

// Append one entry to the global activity log. Best-effort; never blocks the save.
// After a re-render triggered by typing in a search box, restore focus and
// cursor position so the user can keep typing without re-clicking.
function _refocusSearch(id) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) {
      el.focus();
      const v = el.value; el.value = ""; el.value = v;   // move cursor to end
    }
  }, 0);
}


function fmtLogTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso || "");
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = String(d.getFullYear()).slice(-2);
    let h = d.getHours(); const min = String(d.getMinutes()).padStart(2,"0");
    const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${dd}/${mm}/${yy} ${String(h).padStart(2,"0")}:${min} ${ap}`;
  } catch (e) { return String(iso || ""); }
}

async function logActivity(module, action, target, detail, changes, projectId) {
  try {
    const who = currentActor();
    const entry = {
      at: new Date().toISOString(),
      module: module || "",
      action: action || "",
      target: target || "",
      detail: detail || "",
      by: who.email || who.name,     // stable identity = email
      byName: who.name,              // display convenience
      role: who.role,
      projectId: projectId || ""
    };
    if (Array.isArray(changes) && changes.length) entry.changes = changes.slice(0, 60);
    // No client-generated key — the server auto-increments a real row id
    // (see handleLog in data.php), this is a plain insert into a proper
    // indexed table, not a JSON blob keyed by a random string.
    await fbSet(coPath("activity_log"), entry);
  } catch (e) { /* logging must never break the main action */ }
}

// Compute a field-by-field diff and log ONE grouped entry to the central
// activity_log table, tagged with the project id (single source of truth).
async function logProjectChanges(module, prev, next, targetName) {
  try {
    const pid = next.id || "";
    const name = targetName || (next.project&&next.project.title) || next.id;
    if (!prev) { await logActivity(module, "Created project", name, "", null, pid); return; }
    const changes = deepDiff(prev, next);
    if (!changes.length) return;
    await logActivity(module, "Modified project", name, "", changes, pid);
  } catch (e) {}
}

// Fetch activity entries — real server-side filtering now (module, project,
// actor, date range, free-text search all happen in SQL via handleLog's
// 'get' branch), not a pull-everything-then-filter-in-JS approach. Never
// cached — a log view should always be current.
// ============================================================
//  Dependent Tasks — ServiceNow-style request/ticket model.
//  Raised by Proposals or Coordinator against a specific project.
//  Every task has an auto-generated ticket number (DT-00001, …), an
//  Assignment Group (always one of the departments — the team it's
//  routed to) and an optional Assigned To (a specific person within
//  that group actively working it, can be set later). Work notes are a
//  running comment thread, same idea as a ServiceNow ticket's activity
//  feed. Stored in the dependent_tasks table (see api/db/schema.sql) —
//  hybrid pattern: stable columns for filtering (project/status/
//  priority/assignee) + a JSON blob for the full record, including
//  assignmentGroup/assignedTo/workNotes which don't need their own
//  indexed columns.
// ============================================================
var DEP_TASK_DEPARTMENTS = ["Architecture", "MEP", "FLS", "Structural", "Document Controller", "Project Manager", "Resident Engineer"];
// ServiceNow-style state workflow.
var DEP_TASK_STATUSES = ["New", "Assigned", "In Progress", "On Hold", "Resolved", "Closed"];
var DEP_TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
var DEP_TASK_STATUS_STYLE = {
  "New":         { bg: "#eef0f3", color: "#777",   icon: "" },
  "Assigned":    { bg: "#eef0ff", color: "#5b3df5", icon: "👤" },
  "In Progress": { bg: "#e8f0fe", color: "#1a5276", icon: "●" },
  "On Hold":     { bg: "#ffe8cc", color: "#a04800", icon: "⏸" },
  "Resolved":    { bg: "#d4f0e3", color: "#166a3f", icon: "✓" },
  "Closed":      { bg: "#e5e5e5", color: "#666",    icon: "🔒" },
};
var DEP_TASK_PRIORITY_STYLE = {
  "Low":    { bg: "#eef0f3", color: "#777" },
  "Medium": { bg: "#e8f0fe", color: "#1a5276" },
  "High":   { bg: "#ffe8cc", color: "#a04800" },
  "Urgent": { bg: "#fde8e8", color: "#a32d2d" },
};

// Raise a new dependent task (ticket) against a project. fields: { title,
// description, priority, assignmentGroup (required — a department),
// assignedTo (optional — a specific person's email/name), dueDate,
// raisedModule:'Proposals'|'Coordinator' }. Returns the new task's id, or
// null on failure.
async function createDependentTask(projectId, fields) {
  if (!projectId || !fields || !(fields.title || "").trim() || !fields.assignmentGroup) return null;
  const who = currentActor();
  const nowIso = new Date().toISOString();
  // DT-00001, DT-00002, … — same atomic-counter mechanism already used for
  // quotation numbers, just a different counter key.
  const seq = await fbIncrement("dep_task_counter", 1);
  const taskNumber = "DT-" + String(seq || Date.now()).padStart(5, "0");
  const id = "task_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const initialStatus = fields.assignedTo ? "Assigned" : "New";
  const rec = {
    taskNumber,
    projectId,
    title: (fields.title || "").trim(),
    description: (fields.description || "").trim(),
    status: initialStatus,
    priority: fields.priority || "Medium",
    // Kept for backward-compat filtering via the flat DB columns
    // (assignee_type/assignee) — assignmentGroup IS the "assignee" from
    // the table's point of view; assignedTo lives only in the JSON blob.
    assigneeType: "department",
    assignee: fields.assignmentGroup,
    assignmentGroup: fields.assignmentGroup,
    assignedTo: fields.assignedTo || "",
    dueDate: fields.dueDate || "",
    progressPct: 0,
    raisedBy: who.email || who.name || "",
    raisedByName: who.name || "",
    raisedByRole: who.role || "",
    raisedModule: fields.raisedModule || "",
    createdAt: nowIso,
    workNotes: [],
    statusHistory: [{ status: initialStatus, at: nowIso, by: who.name || who.email || "" }],
  };
  const ok = await fbSet("dependent_tasks/" + id, rec);
  if (ok && typeof logActivity === "function") {
    const detail = `Group: ${rec.assignmentGroup}` + (rec.assignedTo ? ` · Assigned: ${rec.assignedTo}` : "");
    logActivity(rec.raisedModule || "Proposals", "Raised dependent task", `${taskNumber} — ${rec.title}`, detail, null, projectId);
  }
  return ok ? id : null;
}

// Fetch every dependent task for a project (always a fresh server read —
// this data changes across roles/modules too often to trust the client
// cache). Returns [] on failure or if there are none.
async function getDependentTasksForProject(projectId) {
  if (!projectId) return [];
  try {
    const rows = await _dataCall("get", "dependent_tasks", { projectId });
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

// Update a task's status (and optionally progress %), appending to its
// history so there's a visible trail of who changed what and when.
async function updateDependentTaskStatus(taskId, newStatus, progressPct) {
  if (!taskId) return false;
  try {
    const existing = await _dataCall("get", "dependent_tasks/" + taskId, null);
    if (!existing) return false;
    const who = currentActor();
    const nowIso = new Date().toISOString();
    existing.status = newStatus;
    if (progressPct != null) existing.progressPct = Math.max(0, Math.min(100, Number(progressPct) || 0));
    if (newStatus === "Resolved" || newStatus === "Closed") { existing.progressPct = 100; existing.completedAt = nowIso; }
    if (!Array.isArray(existing.statusHistory)) existing.statusHistory = [];
    existing.statusHistory.push({ status: newStatus, at: nowIso, by: who.name || who.email || "" });
    const ok = await fbSet("dependent_tasks/" + taskId, existing);
    if (ok && typeof logActivity === "function") {
      logActivity("Dependent Tasks", "Updated task status", `${existing.taskNumber || taskId} — ${existing.title || ""}`,
        `${newStatus}${progressPct != null ? " · " + existing.progressPct + "%" : ""}`, null, existing.projectId);
    }
    return ok;
  } catch (e) { return false; }
}

// Set/change who within the assignment group is actively working the
// ticket. Auto-transitions New → Assigned, same as ServiceNow's default
// assignment behavior — doesn't touch status if it's already further along.
async function assignDependentTaskTo(taskId, assignedTo) {
  if (!taskId) return false;
  try {
    const existing = await _dataCall("get", "dependent_tasks/" + taskId, null);
    if (!existing) return false;
    const who = currentActor();
    const nowIso = new Date().toISOString();
    existing.assignedTo = assignedTo || "";
    if (assignedTo && existing.status === "New") {
      existing.status = "Assigned";
      if (!Array.isArray(existing.statusHistory)) existing.statusHistory = [];
      existing.statusHistory.push({ status: "Assigned", at: nowIso, by: who.name || who.email || "" });
    }
    const ok = await fbSet("dependent_tasks/" + taskId, existing);
    if (ok && typeof logActivity === "function") {
      logActivity("Dependent Tasks", "Reassigned task", `${existing.taskNumber || taskId} — ${existing.title || ""}`,
        assignedTo ? `Assigned to ${assignedTo}` : "Unassigned", null, existing.projectId);
    }
    return ok;
  } catch (e) { return false; }
}

// Append a work note (free-text comment) to a task's activity thread —
// same idea as a ServiceNow ticket's work-notes feed. Doesn't change
// status or any other field, purely a running log entry.
async function addDependentTaskNote(taskId, note) {
  if (!taskId || !(note || "").trim()) return false;
  try {
    const existing = await _dataCall("get", "dependent_tasks/" + taskId, null);
    if (!existing) return false;
    const who = currentActor();
    if (!Array.isArray(existing.workNotes)) existing.workNotes = [];
    existing.workNotes.push({ note: note.trim(), at: new Date().toISOString(), by: who.name || who.email || "", byRole: who.role || "" });
    const ok = await fbSet("dependent_tasks/" + taskId, existing);
    if (ok && typeof logActivity === "function") {
      logActivity("Dependent Tasks", "Added work note", `${existing.taskNumber || taskId} — ${existing.title || ""}`,
        note.trim().slice(0, 140), null, existing.projectId);
    }
    return ok;
  } catch (e) { return false; }
}

async function deleteDependentTask(taskId, projectId) {
  if (!taskId) return false;
  try {
    const ok = await _dataCall("delete", "dependent_tasks/" + taskId, null);
    if (ok && typeof logActivity === "function") logActivity("Dependent Tasks", "Deleted task", taskId, "", null, projectId || "");
    return !!ok;
  } catch (e) { return false; }
}

async function getActivityLog(moduleFilter, limit, projectId, extraFilters) {
  const filters = Object.assign({
    module: (moduleFilter && moduleFilter !== "all") ? moduleFilter : undefined,
    projectId: projectId || undefined,
    limit: limit || 300,
  }, extraFilters || {});
  // Distinguish "genuinely zero events" from "the fetch failed" — these
  // used to look identical (both returned []), which made a real problem
  // (network error, permission error, missing table) invisible, always
  // showing as the same "No events match this filter" message.
  // NOTE: deliberately NOT wrapped in coPath() — logActivity() never uses
  // it either when writing, so every event is written under the default
  // company regardless of which company was active at the time. Reading
  // through coPath() here would silently show zero events for anyone
  // viewing the log while on a non-default company (Moonway / WH Safety &
  // Fire), since it would look for rows that were never actually written
  // under that company. Activity Log is a Super-Admin-only audit view, so
  // showing everything globally is also the more correct behavior anyway.
  const rows = await _dataCall("get", "activity_log", filters);
  return Array.isArray(rows) ? rows : [];
}


// ── Auth helpers ──────────────────────────────────────────────
// ── Idle session timeout ──────────────────────────────────────
//  120-minute IDLE timeout: the clock resets on user activity.
//  A warning appears ~2 minutes before auto-logout. All client-side
//  (no server calls, no bandwidth cost).
var SESSION_IDLE_MS   = 120 * 60 * 1000;   // 120 minutes
var SESSION_WARN_MS   = 2   * 60 * 1000;   // warn 2 min before logout
var SESSION_TS_KEY    = "whc_last_activity";

function _now() { return Date.now(); }
function _touchActivity() {
  try { sessionStorage.setItem(SESSION_TS_KEY, String(_now())); } catch (e) {}
}
function _lastActivity() {
  try { return Number(sessionStorage.getItem(SESSION_TS_KEY) || 0); } catch (e) { return 0; }
}
function _sessionExpired() {
  const last = _lastActivity();
  if (!last) return false;            // no stamp yet → treat as fresh
  return (_now() - last) > SESSION_IDLE_MS;
}

function getSession() {
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem("whc_user") || "null"); } catch { user = null; }
  if (!user) return null;
  // Enforce idle timeout on every read.
  if (_sessionExpired()) {
    clearSession();
    if (typeof window !== "undefined" && !/\/auth\/?$/.test(window.location.pathname)) {
      window.location.href = "/auth/?timeout=1";
    }
    return null;
  }
  return user;
}
function setSession(user) {
  sessionStorage.setItem("whc_user", JSON.stringify(user));
  _touchActivity();                   // stamp login as activity
}
function clearSession() {
  sessionStorage.removeItem("whc_user");
  sessionStorage.removeItem("whc_company");
  sessionStorage.removeItem(SESSION_TS_KEY);
}

// ── Idle watchdog: wire up once per page on DOMContentLoaded ───
//  - Listens for real user activity to reset the idle clock.
//  - Polls every 15s; shows a warning bar at T-2min; logs out at T-0.
var _sessionWarnShown = false;
function _showTimeoutWarning(secondsLeft) {
  let bar = document.getElementById("whc-timeout-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "whc-timeout-bar";
    bar.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:99999",
      "background:#a32d2d","color:#fff","font-size:13px","font-weight:600",
      "padding:10px 16px","text-align:center","box-shadow:0 2px 10px rgba(0,0,0,.25)",
      "display:flex","align-items:center","justify-content:center","gap:14px"
    ].join(";");
    document.body.appendChild(bar);
  }
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const t = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  bar.innerHTML =
    `⏳ You'll be signed out in <span style="font-variant-numeric:tabular-nums">${t}</span> due to inactivity.` +
    `<button id="whc-stay-btn" style="background:#fff;color:#a32d2d;border:none;border-radius:6px;` +
    `padding:5px 14px;font-weight:700;cursor:pointer">Stay signed in</button>`;
  const btn = document.getElementById("whc-stay-btn");
  if (btn) btn.onclick = () => { _touchActivity(); _hideTimeoutWarning(); };
}
function _hideTimeoutWarning() {
  _sessionWarnShown = false;
  const bar = document.getElementById("whc-timeout-bar");
  if (bar) bar.remove();
}
function initSessionWatchdog() {
  if (typeof window === "undefined") return;
  if (!getSession()) return;          // not logged in → nothing to guard
  if (!_lastActivity()) _touchActivity();

  // Reset the clock on genuine interaction (throttled to once / 5s).
  let _lastTouch = 0;
  const onActivity = () => {
    const n = _now();
    if (n - _lastTouch > 5000) { _lastTouch = n; _touchActivity(); }
    if (_sessionWarnShown) _hideTimeoutWarning();
  };
  ["mousedown","keydown","touchstart","scroll","click"].forEach(ev =>
    window.addEventListener(ev, onActivity, { passive: true })
  );

  // Poll every 15s.
  setInterval(() => {
    if (!sessionStorage.getItem("whc_user")) return;
    const idle = _now() - _lastActivity();
    const left = SESSION_IDLE_MS - idle;
    if (left <= 0) {
      clearSession();
      window.location.href = "/auth/?timeout=1";
    } else if (left <= SESSION_WARN_MS) {
      _sessionWarnShown = true;
      _showTimeoutWarning(Math.ceil(left / 1000));
    }
  }, 15000);
}
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initSessionWatchdog);
}

// ============================================================
//  Companies — chosen at login, scopes data + numbering.
//  WHC keeps the original (un-prefixed) data paths so existing
//  data is untouched. The two new companies use their own prefix.
// ============================================================
var COMPANIES = [
  { id:"whc",  name:"Winner Holistic Consultant",   short:"WHC",  prefix:"",       accent:"#6d28d9" },
  { id:"mw",   name:"Moonway General Contracting",  short:"Moonway", prefix:"mw/",  accent:"#2563eb" },
  { id:"whsf", name:"WH Safety and Fire",           short:"WH S&F", prefix:"whsf/", accent:"#dc2626" },
];
function getCompany() {
  let id = null;
  try { id = sessionStorage.getItem("whc_company"); } catch(e){}
  return COMPANIES.find(c => c.id === id) || COMPANIES[0]; // default WHC
}
function setCompany(id) {
  try { sessionStorage.setItem("whc_company", id); } catch(e){}
}
// Prefix a data path with the active company's namespace.
// coPath("quotations/fitout") -> "quotations/fitout" (WHC) or "mw/quotations/fitout".
function coPath(path) {
  const p = getCompany().prefix || "";
  return p + path;
}
// Generate a long, unguessable token for the public client view link, so
// customers can only reach their own project, never by guessing an ID.
function genClientToken() {
  const a = new Uint8Array(24);
  (window.crypto || crypto).getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(pin)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function loginWithPin(email, pin) {
  // Server verifies the PIN against MySQL and starts a session cookie.
  // The browser never downloads other users' hashes.
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "login", email, pin })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) { setSession(data.user); return data.user; }
    return null;
  } catch (e) { return null; }
}

// Create a user via the server (handles first-admin bootstrap + super-admin
// gating server-side). Returns {ok} or {error}.
async function serverSignup(payload) {
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(Object.assign({ action: "signup" }, payload))
    });
    return await res.json();
  } catch (e) { return { error: "Network error" }; }
}

// Clear the server session too, not just the local copy.
// Change the logged-in user's PIN (verifies the current PIN server-side).
async function changePin(currentPin, newPin) {
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "change_pin", current_pin: currentPin, new_pin: newPin })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: (data && data.error) || "Could not change PIN" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Network error" };
  }
}

async function serverLogout() {
  try {
    await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ action: "logout" })
    });
  } catch (e) {}
  clearSession();
}

// Ask the server whether first-time setup is needed (no users yet).
// Used by the auth page to choose bootstrap vs login. No session required.
async function needsSetup() {
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ action: "needs_setup" })
    });
    const data = await res.json();
    return !!(data && data.needsSetup);
  } catch (e) { return false; }
}

// Fetch active users of a given role (names/roles only — no PINs). Used to
// populate owner/assignee dropdowns (e.g. account users for milestone owner).
async function fetchUsersByRole(role) {
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "list_users", role: role || "" })
    });
    const data = await res.json();
    return (data && data.users) || [];
  } catch (e) { return []; }
}
function requireRole(...roles) {
  const user = getSession();
  if (!user || !roles.includes(user.role)) {
    clearSession();
    window.location.href = "/auth/";
    return null;
  }
  return user;
}
// Preferred over requireRole(...) for whole-module guards — reads the
// allowed-roles list from the central MODULE_ACCESS config (shared/
// permissions.js) instead of repeating the role list in every page.
function requireModule(moduleKey) {
  const user = getSession();
  if (!user || !canAccessModule(moduleKey, user.role)) {
    clearSession();
    window.location.href = "/auth/";
    return null;
  }
  return user;
}

// ── String / date helpers ─────────────────────────────────────
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtDate(d) {
  if (!d) return "";
  try { const [y, m, day] = d.split("-").map(Number); return new Date(y, m - 1, day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch (e) { return d; }
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  try { const d = new Date(iso); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; }
}
function fmtMoney(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function copyText(txt) { navigator.clipboard.writeText(txt).then(() => alert("Link copied!\n\n" + txt)).catch(() => prompt("Copy this link:", txt)); }
// Build the public, read-only client link. Uses the project's random
// clientToken (not the guessable project id) and points at the client page.
function projectLink(idOrProj) {
  const origin = window.location.origin;
  const proj = (typeof idOrProj === "object" && idOrProj) ? idOrProj
             : (typeof PROJ !== "undefined" && PROJ && PROJ.id === idOrProj ? PROJ : null);
  const token = proj && proj.clientToken ? proj.clientToken : null;
  if (token) return origin + "/client/?t=" + token;
  // Fallback (older projects without a token): still avoid exposing more
  // than the id; the client page will show "invalid link" if no token.
  return origin + "/client/?id=" + encodeURIComponent(typeof idOrProj === "object" ? (idOrProj.id||"") : idOrProj);
}

// ── Nature / unit type helpers ────────────────────────────────
function natureArr(u) { return Array.isArray(u) ? u : (u ? [u] : []); }
function natureDisplay(u) { const a = natureArr(u); return a.length ? a.join(", ") : "—"; }
function natureCSV(u) { return natureArr(u).join("; "); }

// ── Constants ─────────────────────────────────────────────────
var PROJECT_TYPES_NEW = ["Retail", "Office", "Industry", "Residentials", "Education", "Entertainment", "Agriculture", "Medical", "Others"];

// ── Predefined templates (single source of truth) ──────────────
// Scope of Works: Master-Template is the ONLY source of truth for scope
// items across the whole app. It holds section headings + descriptions
// only — no AED values, since pricing is quotation-specific, not
// template-specific. Edited via the Templates module (Create/Edit); an
// edited copy is saved under the SAME name in the custom template store
// (see CUSTOM_SCOPE_TEMPLATES below), which then takes precedence over
// this hardcoded default. Proposals loads scope from it automatically when
// starting a new quotation; editing within a quotation never writes back.
var MASTER_SCOPE_TEMPLATE_NAME = "Master-Template";
var SCOPE_TEMPLATES = {
  "Master-Template": [
    { code: "B.1", name: "ADM Submission Package & Fire/Life Safety Strategy", desc: "Preparation of ADM Submission Package including Key Plan, Partition Layout & Section based on Final Architectural Drawings (CAD Files). Preparation of Fire and Life Safety Strategy Layout. Submission to ADM/ADCD and obtain approval." },
    { code: "B.2", name: "Fire Protection System Shop Drawings approval from ADCD", desc: "Receipt of Fire Protection (Fire Fighting, Fire Alarm, Emergency, Exit & Fire Suppression System) shop drawings from the Fire Contractor. Completeness check, submission to ADCD, follow-up and obtain approval." },
    { code: "B.3", name: "Kitchen Ventilation System Design Drawings for ADCD Approval", desc: "Collection of complete set of Kitchen Ventilation System Drawings & Design Calculation Notes from the Specialist Contractor. Compilation and submission to ADCD for approval." },
    { code: "B.4", name: "Completion Certificate from ADCD", desc: "Coordination with Main Contractor & Fire Contractor, collect and compile documents, apply for site inspection and obtain the completion certificate." },
    { code: "B.5", name: "Completion Certificate from ADM", desc: "Coordination with Main Contractor & Fire Contractor, collect and compile documents, apply for site inspection and obtain the completion certificate." },
    { code: "B.6", name: "Scope of the Local Civil Contractor", desc: "Pull out the Modification Building Permit from ADM after completion of approval (item B.1). Provide letters, certificates & shop drawing approvals/completion certificates from ADM/ADCD." }
  ]
};

// Resolve the CURRENT Master-Template: an edited copy saved via the
// Templates module (in the custom store, same name) takes precedence over
// the hardcoded default above. Always call this rather than reading
// SCOPE_TEMPLATES directly, so every page stays in sync with edits.
function getMasterScopeTemplate(customScopeStore) {
  const custom = customScopeStore && customScopeStore[MASTER_SCOPE_TEMPLATE_NAME];
  if (custom) return (Array.isArray(custom) ? custom : (custom.items || [])).slice();
  return (SCOPE_TEMPLATES[MASTER_SCOPE_TEMPLATE_NAME] || []).slice();
}

// Built-in Approval Stage templates live here too — for Coordinator's Approval
// Stages tab. Stage names match STAGE_NAMES / account.js's filter list.
// These MUST match blankStages() below exactly — same stage types (each
// type has its own status option set, see STAGE_OPTIONS) and the same
// "time" working-days estimates, since this is meant to be the loadable
// version of what a new project already gets by default. They'd drifted
// out of sync (this used to be just two generic types for every stage,
// which meant loading it gave every stage the WRONG status dropdown).
var APPROVAL_STAGE_TEMPLATES = {
  "Standard ADM / TAQA / ADCD Flow": [
    { name: "Project Scope Analysis and Requirement Collection", type: "scope", time: "" },
    { name: "Project Registration", type: "registration", time: "5 working days" },
    { name: "ADM and CD-FLS – Drawing Preparation", type: "drawing_prep", time: "" },
    { name: "ADM & CD-FLS Approval", type: "approval_meps", time: "10 working days" },
    { name: "TAQA Drawing Preparation", type: "drawing_prep", time: "" },
    { name: "TAQA Drawing Approval", type: "approval_portal", time: "10 working days" },
    { name: "ADCD Shop Drawing Preparation", type: "drawing_prep", time: "" },
    { name: "ADCD Shop Drawing Approval", type: "approval_portal", time: "5 working days" },
    { name: "Work Start Notice Approval", type: "approval_portal", time: "" },
    { name: "Commencement of Site Work", type: "site_work", time: "" },
    { name: "TAQA Inspection Approval", type: "inspection", time: "" },
    { name: "Hassantuk & AMC Application Submission Initiation", type: "inspection", time: "" },
    { name: "ADCD Inspection", type: "inspection", time: "5-6 working days" },
    { name: "ADM Completion Inspection", type: "inspection", time: "7 working days" },
    { name: "GIS Approval", type: "gis", time: "4-5 working days" },
    { name: "Project Fully Completed", type: "completed", time: "" }
  ],
  "Fire & Life Safety Only": [
    { name: "ADM and CD-FLS – Drawing Preparation", type: "drawing_prep", time: "" },
    { name: "ADM & CD-FLS Approval", type: "approval_meps", time: "10 working days" },
    { name: "ADCD Shop Drawing Preparation", type: "drawing_prep", time: "" },
    { name: "ADCD Shop Drawing Approval", type: "approval_portal", time: "5 working days" },
    { name: "ADCD Inspection", type: "inspection", time: "5-6 working days" },
    { name: "ADM Completion Inspection", type: "inspection", time: "7 working days" }
  ]
};

// Fetch the CUSTOM (team-saved) template store for either type. Used by
// Proposals/Coordinator when picking a template, and by the Templates module
// for the browsable overall list.
async function loadCustomTemplates(kind) {
  // kind: "scope_templates" | "approval_stage_templates"
  try { return (await fbGet(coPath("options/" + kind))) || {}; }
  catch (e) { return {}; }
}
var FOLDER_CATEGORIES = ["Fitout Folder", "Live Folder", "ID Folder", "Private Folder"];

var STATUS_DISPLAY = {
  "": { label: "Pending", cls: "b-pending" },
  "requirement-pending": { label: "Requirement list yet to send", cls: "b-pending" },
  "awaiting-docs": { label: "Awaiting Documents", cls: "b-authority" },
  "not-received": { label: "Not Received", cls: "b-not-approved" },
  "hold": { label: "Hold", cls: "b-hold" },
  "received": { label: "Received", cls: "b-approved" },
  "submitted": { label: "Submitted in MePS", cls: "b-authority" },
  "under-review": { label: "Under Review", cls: "b-authority" },
  "under-review-meps": { label: "Under Review in MePS", cls: "b-authority" },
  "under-review-portal": { label: "Under Review in Portal", cls: "b-authority" },
  "rejected": { label: "Rejected", cls: "b-not-approved" },
  "approved": { label: "Approved", cls: "b-approved" },
  "waiting-applicant": { label: "Waiting on Applicant", cls: "b-hold" },
  "not-part-scope": { label: "Not Part of Scope", cls: "b-pending" },
  "under-preparation": { label: "Under Preparation", cls: "b-authority" },
  "sent-client-review": { label: "Sent for Client Review", cls: "b-authority" },
  "comments-shared": { label: "Comments Shared to Client", cls: "b-hold" },
  "completed-signed": { label: "Completed - Signed Off", cls: "b-approved" },
  "work-in-progress": { label: "Work in Progress", cls: "b-authority" },
  "completed": { label: "Completed", cls: "b-approved" },
  "inspection-scheduled": { label: "Inspection Date Scheduled", cls: "b-authority" },
  "submitted-meps": { label: "Submitted in MePS", cls: "b-authority" },
  "approved-bcc": { label: "Approved - BCC Received", cls: "b-approved" },
  "pending": { label: "Pending", cls: "b-pending" },
  "authority-progress": { label: "In-Progress", cls: "b-authority" },
  "not-approved": { label: "Not Approved", cls: "b-not-approved" }
};

var STAGE_OPTIONS = {
  awarded_scope: [
    { v: "Not started", label: "Not started" },
    { v: "In progress", label: "In progress" },
    { v: "Done",        label: "Done" }
  ],
  scope: [
    { v: "", label: "— Select Status —" }, { v: "requirement-pending", label: "Requirement list yet to send" },
    { v: "awaiting-docs", label: "Awaiting Documents / Details / Drawings" },
    { v: "not-received", label: "Not Received" }, { v: "hold", label: "Hold" }, { v: "received", label: "Received" }
  ],
  registration: [
    { v: "", label: "— Select Status —" }, { v: "submitted", label: "Submitted in MePS" },
    { v: "under-review", label: "Under Review in MePS" }, { v: "rejected", label: "Rejected" },
    { v: "approved", label: "Approved" }, { v: "waiting-applicant", label: "Waiting on Applicant" }
  ],
  drawing_prep: [
    { v: "", label: "— Select Status —" }, { v: "under-review", label: "Under Review" },
    { v: "under-preparation", label: "Under Preparation" }, { v: "sent-client-review", label: "Sent for Client Review" },
    { v: "comments-shared", label: "Comments shared to client" }, { v: "hold", label: "Hold" },
    { v: "completed-signed", label: "Completed - Signed Off" }
  ],
  approval_meps: [
    { v: "", label: "— Select Status —" }, { v: "under-review-meps", label: "Under Review in MePS" },
    { v: "not-part-scope", label: "Not Part of scope" }, { v: "rejected", label: "Rejected" },
    { v: "approved", label: "Approved" }, { v: "waiting-applicant", label: "Waiting on Applicant" }
  ],
  approval_portal: [
    { v: "", label: "— Select Status —" }, { v: "not-part-scope", label: "Not Part of scope" },
    { v: "under-review-portal", label: "Under Review in Portal" }, { v: "rejected", label: "Rejected" },
    { v: "approved", label: "Approved" }, { v: "waiting-applicant", label: "Waiting on Applicant" }
  ],
  site_work: [
    { v: "", label: "— Select Status —" }, { v: "work-in-progress", label: "Work in Progress" },
    { v: "hold", label: "Hold" }, { v: "completed", label: "Completed" }
  ],
  inspection: [
    { v: "", label: "— Select Status —" }, { v: "not-part-scope", label: "Not Part of scope" },
    { v: "under-review-portal", label: "Under Review in Portal" },
    { v: "inspection-scheduled", label: "Inspection date Scheduled" }, { v: "rejected", label: "Rejected" },
    { v: "approved", label: "Approved" }, { v: "waiting-applicant", label: "Waiting on Applicant" }
  ],
  gis: [
    { v: "", label: "— Select Status —" }, { v: "submitted-meps", label: "Submitted in MePS" },
    { v: "under-review-meps", label: "Under Review in MePS" }, { v: "rejected", label: "Rejected" },
    { v: "approved-bcc", label: "Approved - BCC Received" }, { v: "waiting-applicant", label: "Waiting on Applicant" }
  ],
  completed: [{ v: "", label: "— Select Status —" }, { v: "completed", label: "Project Fully Completed" }]
};

// ── Stage logic helpers ───────────────────────────────────────
function isStageComplete(st) { return ["received", "approved", "completed", "completed-signed", "approved-bcc"].includes(st.status || ""); }
function projPct(p) { const vis = p.stages || []; return Math.round(vis.filter(s => isStageComplete(s)).length / Math.max(vis.length, 1) * 100); }
// Always computed LIVE from actual stage progress — never trusts a stored
// status value that could go stale. (Previously this checked
// p.workflowStatus === "allocated" first and returned immediately, which
// meant "active"/"done"/"new" below could never actually be reached, since
// workflowStatus was set once at project creation and nothing ever advanced
// it — every real project was permanently misreported as just "allocated."
// See syncWorkflowStatus() for what keeps the STORED field in sync now.)
function projStatus(p) {
  // Hold/Cancelled is a manual override — takes priority over the normal
  // stage-progress classification below, regardless of how far along the
  // stages/milestones actually are.
  if (p && (p.holdStatus === "hold" || p.holdStatus === "cancelled")) return p.holdStatus;
  if (p.workflowStatus === "proposal") return "proposal"; // rare/legacy pre-project state
  const pc = projPct(p);
  if (pc === 100 && (p.stages || []).length > 0) return "done";
  const act = ["under-review", "under-review-meps", "under-review-portal", "submitted", "submitted-meps", "under-preparation", "sent-client-review", "work-in-progress", "inspection-scheduled", "authority-progress"];
  if (pc > 0 || (p.stages || []).some(s => act.includes(s.status))) return "active";
  return "new";
}
// Keep the STORED workflowStatus field in sync with the live-computed
// status, for the handful of places that check workflowStatus directly
// (e.g. account.js's proposals-vs-projects split) rather than calling
// projStatus(). "new" maps to "allocated" (assigned, not yet started —
// that's what "Allocated" already meant there). Mutates in place; call
// this after any stage-status change, before persisting.
function syncWorkflowStatus(p) {
  if (!p || p.workflowStatus === "proposal") return; // don't touch the legacy pre-project state
  const st = projStatus(p);
  p.workflowStatus = st === "new" ? "allocated" : st; // "active" | "done" | "allocated"
}
function stageIcon(st) {
  const s = st.status || "";
  if (["received", "approved", "completed", "completed-signed", "approved-bcc"].includes(s)) return "✓";
  if (["under-review", "under-review-meps", "under-review-portal", "submitted", "submitted-meps", "under-preparation", "sent-client-review", "work-in-progress", "inspection-scheduled"].includes(s)) return "●";
  if (["rejected", "not-received", "not-approved"].includes(s)) return "✗";
  if (["hold", "comments-shared", "waiting-applicant"].includes(s)) return "⏸";
  return "○";
}
function stageCls(st) {
  const s = st.status || "";
  if (["received", "approved", "completed", "completed-signed", "approved-bcc"].includes(s)) return "si-approved";
  if (["under-review", "under-review-meps", "under-review-portal", "submitted", "submitted-meps", "under-preparation", "sent-client-review", "work-in-progress", "inspection-scheduled"].includes(s)) return "si-authority";
  if (["rejected", "not-received", "not-approved"].includes(s)) return "si-not-approved";
  if (["hold", "comments-shared", "waiting-applicant"].includes(s)) return "si-hold";
  return "si-pending";
}
// Colors for the Approval Stage status <select> itself — same semantic
// buckets as stageCls()/stageIcon() above, packaged as bg/text/border for
// styling a dropdown rather than a small stepper icon.
function stageStatusColor(status) {
  const s = status || "";
  if (["received", "approved", "completed", "completed-signed", "approved-bcc", "Done"].includes(s))
    return { bg: "#d4f0e3", color: "#166a3f", border: "#a3d4b8" };
  if (["under-review", "under-review-meps", "under-review-portal", "submitted", "submitted-meps", "under-preparation", "sent-client-review", "work-in-progress", "inspection-scheduled", "In progress"].includes(s))
    return { bg: "#e8f0fe", color: "#1a5276", border: "#5b8dee" };
  if (["rejected", "not-received", "not-approved"].includes(s))
    return { bg: "#fde8e8", color: "#a32d2d", border: "#e24b4a" };
  if (["hold", "comments-shared", "waiting-applicant"].includes(s))
    return { bg: "#ffe8cc", color: "#a04800", border: "#e8a060" };
  return { bg: "#f0f0f0", color: "#888", border: "#ddd" }; // empty/not selected/Not started
}
// Colors for the Document status <select> (Required/Received/Not Received/
// Correction Required/N/A) — separate palette, matches the same visual
// language (green=good, red=bad, amber=needs action, grey=neutral).
function documentStatusColor(status) {
  const s = status || "";
  if (s === "received" || s === "done") return { bg: "#d4f0e3", color: "#166a3f", border: "#a3d4b8" };
  if (s === "not-received") return { bg: "#fde8e8", color: "#a32d2d", border: "#e24b4a" };
  if (s === "correction") return { bg: "#ffe8cc", color: "#a04800", border: "#e8a060" };
  if (s === "na") return { bg: "#f0f0f0", color: "#888", border: "#ddd" };
  return { bg: "#e8f0fe", color: "#1a5276", border: "#5b8dee" }; // required/pending
}

// ── Data factories ────────────────────────────────────────────
function blankStage(name, type, time) { return { name, type, status: "", note: "", time: time || "", appNum: "", dateA: "", dateB: "" }; }
function blankStages() {
  return [
    blankStage("Project Scope Analysis and Requirement Collection", "scope", ""),
    blankStage("Project Registration", "registration", "5 working days"),
    blankStage("ADM and CD-FLS – Drawing Preparation", "drawing_prep", ""),
    blankStage("ADM & CD-FLS Approval", "approval_meps", "10 working days"),
    blankStage("TAQA Drawing Preparation", "drawing_prep", ""),
    blankStage("TAQA Drawing Approval", "approval_portal", "10 working days"),
    blankStage("ADCD Shop Drawing Preparation", "drawing_prep", ""),
    blankStage("ADCD Shop Drawing Approval", "approval_portal", "5 working days"),
    blankStage("Work Start Notice Approval", "approval_portal", ""),
    blankStage("Commencement of Site Work", "site_work", ""),
    blankStage("TAQA Inspection Approval", "inspection", ""),
    blankStage("Hassantuk & AMC Application Submission Initiation", "inspection", ""),
    blankStage("ADCD Inspection", "inspection", "5-6 working days"),
    blankStage("ADM Completion Inspection", "inspection", "7 working days"),
    blankStage("GIS Approval", "gis", "4-5 working days"),
    blankStage("Project Fully Completed", "completed", "")
  ];
}
function blankDocs() {
  return [
    { group: "Project Registration – Letters (Winner Provides)", fb: false, items: [{ name: "Design and Supervision Letter", status: "pending" }, { name: "Design Owner Approval Letter", status: "pending" }, { name: "Project Estimation Value", status: "pending" }, { name: "Contractor Authorization Letter", status: "pending" }] },
    { group: "Project Registration – Tenant Documents", fb: false, items: [{ name: "Tenant Authorized Signatory EID & POA", status: "pending" }, { name: "Valid Lease Agreement / Tawtheeq", status: "pending" }] },
    { group: "Project Registration – Landlord Documents", fb: false, items: [{ name: "ADM NOC (Landlord)", status: "pending" }] },
    { group: "Architecture Drawing Approval (ADM & CD-FLS)", fb: false, items: [{ name: "Architectural Drawings – Partition Layout (CAD)", status: "pending" }, { name: "Furniture Layout (CAD)", status: "pending" }, { name: "Two Internal Section Layout", status: "pending" }, { name: "Material Details", status: "pending" }, { name: "Door Details", status: "pending" }] },
    { group: "TAQA Drawing Approval (Electricity)", fb: false, items: [{ name: "Electrical Drawing – Lighting Layout", status: "pending" }, { name: "Electrical Drawing – Cable Route", status: "pending" }, { name: "Electrical Drawing – Power Layout", status: "pending" }, { name: "Load Schedule & Emergency Lighting Layout", status: "pending" }, { name: "SLD (Single Line Diagram)", status: "pending" }, { name: "NOC addressing TAQA for Electricity & Water", status: "pending" }, { name: "Meter Photo", status: "pending" }, { name: "Latest Approved SLD / Base Built SLD", status: "pending" }, { name: "Tawtheeq", status: "pending" }] },
    { group: "TAQA Inspection (Electricity)", fb: false, items: [{ name: "Commercial License of the Shop", status: "pending" }, { name: "Switchgear Supply Certificate + ADQCC Approval Letter", status: "pending" }, { name: "Tenant Account Details or Welcome Letter", status: "pending" }] },
    { group: "ADCD Shop Drawing Approval", fb: false, items: [{ name: "Shop Drawings – Fire Fighting Layout (CAD)", status: "pending" }, { name: "Shop Drawings – Fire Alarm Layout (CAD)", status: "pending" }, { name: "Emergency & Exit Light Layouts (CAD)", status: "pending" }, { name: "Kitchen Ventilation Layout – F&B only", status: "na" }, { name: "Fire Suppression / Wet Chemical Layout – F&B only", status: "na" }, { name: "Undertaking Letter from All Installers", status: "pending" }, { name: "Valid ADCD Safety & Installation Certificates – All Installers", status: "pending" }, { name: "Valid ADCD Supply Certificates – All Suppliers", status: "pending" }] },
    { group: "DOE Gas Drawing Approval", fb: true, items: [{ name: "Third Party Approved Gas Drawings in .DWF format", status: "pending" }, { name: "Third Party Drawing Approval Letter / Report", status: "pending" }, { name: "Main/Gas Contractor – Valid Fitness Certificate", status: "pending" }, { name: "Main/Gas Contractor – Valid ADCD Installation Certificate", status: "pending" }, { name: "Gas Drawing Undertaking Letter – Main Contractor", status: "pending" }, { name: "Gas Drawing Undertaking Letter – Gas Contractor", status: "pending" }, { name: "Third Party COC Certificate", status: "pending" }, { name: "Piping Size Calculation and Node Diagram", status: "pending" }] },
    { group: "Work Start Notice", fb: false, items: [{ name: "QR Code printed on A3 – Affixed on site (photo sent)", status: "pending" }, { name: "Site Photos showing work commencement", status: "pending" }] },
    { group: "ADCD Inspection", fb: false, items: [{ name: "Valid Hassantuk Certificate (in Arabic)", status: "pending" }, { name: "All Installers – Work Completion Letter (signed & stamped)", status: "pending" }, { name: "All Suppliers – Supply Letter (signed & stamped)", status: "pending" }, { name: "Fire-rated Gypsum Partitions Undertaking Letter (Arabic + specs)", status: "pending" }, { name: "CD Approved AMC (all protection systems & quantities)", status: "pending" }, { name: "Kitchen Duct, Fan & Wet Chemical Docs – F&B only", status: "na" }] },
    { group: "DOE Gas Inspection", fb: true, items: [{ name: "Material Form – Complete materials list (Gas Contractor letterhead)", status: "pending" }, { name: "Gas Contractor – Trade License, Safety & Installation Certificate", status: "pending" }, { name: "Gas Supplier – Trade License, Safety & Supply Certificate", status: "pending" }, { name: "Third Party Inspection Report for Gas System", status: "pending" }, { name: "GAS AMC Contract for the Shop", status: "pending" }, { name: "TPI COC (Third Party Inspection Certificate)", status: "pending" }] },
    { group: "ADM Completion Inspection", fb: false, items: [{ name: "100% Site Work Completed Photos", status: "pending" }, { name: "Pest Control Documents (Tenant + Company License + Tadweer Agreement) – F&B only", status: "na" }] }
  ];
}
function migrateProject(p) {
  if (!p) return p;
  if (!p.workflowStatus) p.workflowStatus = "allocated";
  if (!p.activityLog) p.activityLog = [];
  if (!p.proposalLog) p.proposalLog = [];
  // NOTE: p.lpos (legacy) removed — nothing reads it anymore; real
  // milestone data lives in quotationGroups[].milestones. Existing DB
  // records may still carry old lpos data; it's simply unused now, not
  // actively cleared from storage.
  if (!Array.isArray(p.docs)) p.docs = (typeof blankDocs === "function" ? blankDocs() : []);   // Documents tab needs this
  if (!Array.isArray(p.stages)) p.stages = [];
  if (!p.proposal) p.proposal = { scopeHtml: "", estimatedValue: "", expectedStartDate: "", submittedBy: "", submittedAt: "", quotationNumber: "", projectTypes: [], reapprovals: [] };
  if (!p.proposal.quotationNumber) p.proposal.quotationNumber = "";
  if (!p.proposal.projectTypes) p.proposal.projectTypes = [];
  if (!p.proposal.reapprovals) p.proposal.reapprovals = [];
  if (!p.proposal.scopeItems) p.proposal.scopeItems = [];
  if (p.project) {
    if (!p.project.coordinator) p.project.coordinator = "";
    if (!p.project.unitType) p.project.unitType = [];
    else if (!Array.isArray(p.project.unitType)) p.project.unitType = [p.project.unitType];
    if (p.project.customUnitType != null) delete p.project.customUnitType;
  }
  if (p.stages && Array.isArray(p.stages)) {
    p.stages = p.stages.map(st => ({ type: "scope", appNum: "", dateA: "", dateB: "", ...st }));
  }
  // Self-correct workflowStatus on every load — fixes the "stuck on
  // allocated forever" bug immediately for display purposes, even before
  // anyone saves. It'll persist properly the next time the project is saved.
  if (typeof syncWorkflowStatus === "function") syncWorkflowStatus(p);
  return p;
}

// ── Rich text editor helpers ──────────────────────────────────

// ── CSV export helper ─────────────────────────────────────────
function csvEsc(v) {
  const s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ── Document status helpers ───────────────────────────────────
function dIc(s) {
  if (s === "received" || s === "done") return "dic-received";
  if (s === "not-received") return "dic-not-received";
  if (s === "correction") return "dic-correction";
  if (s === "na") return "dic-na";
  return "dic-required";
}
function dCh(s) { if (s === "received" || s === "done") return "✓"; if (s === "not-received") return "✗"; if (s === "correction") return "!"; if (s === "na") return "–"; return "○"; }
function dTag(s) {
  if (s === "received" || s === "done") return `<span class="dtag dt-received">Received</span>`;
  if (s === "not-received") return `<span class="dtag dt-not-received">Not Received</span>`;
  if (s === "correction") return `<span class="dtag dt-correction">Correction Required</span>`;
  if (s === "na") return `<span class="dtag dt-na">N/A</span>`;
  return `<span class="dtag dt-required">Required</span>`;
}

// ── Scroll-to-top ─────────────────────────────────────────────
window.addEventListener("scroll", () => {
  const btn = document.getElementById("scrollTopBtn");
  if (btn) btn.classList.toggle("visible", window.scrollY > 300);
});


// ============================================================
//  Activity Log viewer — shared overlay, SUPER ADMIN ONLY
//  Any module can call openActivityLog() (optionally with a module
//  name to pre-filter). The function gates on the session role, so
//  non-admins cannot open it even if a trigger is exposed.
// ============================================================
function canViewActivityLog() {
  const u = getSession();
  return !!(u && u.role === "super_admin");
}

async function openActivityLog(preFilterModule) {
  if (!canViewActivityLog()) {
    alert("Activity log is available to Super Admins only.");
    return;
  }
  // Build overlay shell with a loading state
  let ov = document.getElementById("whc-actlog-overlay");
  if (ov) ov.remove();
  ov = document.createElement("div");
  ov.id = "whc-actlog-overlay";
  ov.innerHTML = `
    <div class="actlog-backdrop" onclick="closeActivityLog()"></div>
    <div class="actlog-panel" role="dialog" aria-label="Activity Log">
      <div class="actlog-head">
        <div>
          <div class="actlog-title">🕘 Activity Log</div>
          <div class="actlog-sub">Structured event log · Super Admin view</div>
        </div>
        <button class="actlog-close" onclick="closeActivityLog()">✕</button>
      </div>
      <div class="actlog-filters">
        <select id="actlog-module" class="actlog-sel" onchange="reloadActivityLog()">
          <option value="all">All Modules</option>
          <option value="Proposals">Proposals</option>
          <option value="Coordinator">Coordinator</option>
          <option value="Account">Account</option>
          <option value="Users">Users</option>
        </select>
        <input id="actlog-from" class="actlog-date" type="date" value="" onchange="reloadActivityLog()" title="From date (leave blank for no lower limit)"/>
        <input id="actlog-to" class="actlog-date" type="date" value="" onchange="reloadActivityLog()" title="To date (leave blank for no upper limit)"/>
        <input id="actlog-search" class="actlog-search" placeholder="search action, actor, target, detail…"
          oninput="_debounceActivitySearch()"/>
        <button class="actlog-refresh" onclick="reloadActivityLog()" title="Refresh">↻</button>
        ${(getSession()&&getSession().role==="super_admin")?`
        <select class="actlog-clear" onchange="clearActivityLog(this.value); this.selectedIndex=0;" title="Clear activity log">
          <option value="">🗑 Clear…</option>
          <option value="older_30d">Older than 30 days</option>
          <option value="older_90d">Older than 90 days</option>
          <option value="older_180d">Older than 6 months</option>
          <option value="older_365d">Older than 1 year</option>
          <option value="all">Everything</option>
        </select>`:""}
      </div>
      <div id="actlog-histogram" class="actlog-histogram"></div>
      <div id="actlog-count" class="actlog-count"></div>
      <div id="actlog-body" class="actlog-body">
        <div class="actlog-loading">Loading activity…</div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  injectActivityLogStyles();
  if (preFilterModule) {
    const sel = document.getElementById("actlog-module");
    if (sel) sel.value = preFilterModule;
  }
  await reloadActivityLog();
}

function closeActivityLog() {
  const ov = document.getElementById("whc-actlog-overlay");
  if (ov) ov.remove();
}

var _actlogRows = [];
var _actlogSearchTimer = null;
function _debounceActivitySearch() {
  clearTimeout(_actlogSearchTimer);
  _actlogSearchTimer = setTimeout(reloadActivityLog, 400);
}
// Real server-side query — every filter (module, date range, free-text
// search) is sent to the server and filtered in SQL (see handleLog in
// data.php), not fetched-then-filtered client-side.
async function reloadActivityLog() {
  const body = document.getElementById("actlog-body");
  if (body) body.innerHTML = `<div class="actlog-loading">Loading activity…</div>`;
  const mod = (document.getElementById("actlog-module")||{}).value || "all";
  const from = (document.getElementById("actlog-from")||{}).value || "";
  const to = (document.getElementById("actlog-to")||{}).value || "";
  const q = ((document.getElementById("actlog-search")||{}).value || "").trim();
  const extra = {};
  if (from) extra.from = from + " 00:00:00";
  if (to) extra.to = to + " 23:59:59";
  if (q) extra.q = q;
  try {
    _actlogRows = await getActivityLog(mod, 500, null, extra);
    renderActivityRows();
    renderActlogHistogram();
  } catch (e) {
    _actlogRows = [];
    if (body) body.innerHTML = `<div class="actlog-empty">⚠ Could not load the activity log.<br/><span style="font-size:11px;opacity:0.7">${escAL(e && e.message || "Unknown error")}</span></div>`;
    const countEl = document.getElementById("actlog-count");
    if (countEl) countEl.textContent = "Error";
  }
}

// Clear activity log — SUPER ADMIN ONLY. mode = "all" or "older_Nd". Does
// a single indexed DELETE server-side now (see handleLog), not a fetch-
// everything-then-delete-each-row loop.
async function clearActivityLog(mode) {
  if (!mode) return;
  const u = getSession();
  if (!u || u.role !== "super_admin") { alert("Only Super Admins can clear the activity log."); return; }

  const isAll = (mode === "all");
  const m = mode.match(/^older_(\d+)d$/);
  const days = m ? m[1] : null;
  const label = isAll ? "the ENTIRE activity log" : `all entries older than ${days} days`;

  if (!confirm(`Clear ${label}?\n\nThis permanently deletes those records and cannot be undone.`)) return;
  if (!confirm("Are you absolutely sure? This is your last chance to cancel.")) return;

  const body = document.getElementById("actlog-body");
  if (body) body.innerHTML = `<div class="actlog-loading">Clearing…</div>`;

  try {
    // Same reasoning as getActivityLog() above — no coPath(), since writes
    // never used it either.
    const ok = await _dataCall("delete", "activity_log", { mode });
    if (!ok) throw new Error("delete failed");
    try { await logActivity("Users", isAll ? "Cleared activity log (all)" : `Cleared activity log (older than ${days}d)`, "", u.name || ""); } catch (e) {}
    await reloadActivityLog();
  } catch (e) {
    if (body) body.innerHTML = `<div class="actlog-empty">Could not clear the log. Please try again.</div>`;
  }
}

// Splunk-style dense structured event rows: [time] MODULE actor » action —
// target · detail, in a monospace-leaning layout so scanning many rows at
// once is fast and each field is clearly separated instead of prose text.
// Splunk-style event timeline — a row of bars showing event density over
// time, computed from whatever's currently loaded. Auto-picks hour vs day
// buckets depending on how wide a span the current rows actually cover.
function renderActlogHistogram() {
  const el = document.getElementById("actlog-histogram");
  if (!el) return;
  if (!_actlogRows.length) { el.innerHTML = ""; return; }
  const times = _actlogRows.map(r => new Date(r.at).getTime()).filter(t => !isNaN(t));
  if (!times.length) { el.innerHTML = ""; return; }
  const min = Math.min(...times), max = Math.max(...times);
  const spanMs = Math.max(1, max - min);
  const useHourly = spanMs < 36 * 3600 * 1000; // under ~1.5 days → hourly buckets, else daily
  const bucketMs = useHourly ? 3600 * 1000 : 86400 * 1000;
  const bucketCount = Math.min(48, Math.max(6, Math.ceil(spanMs / bucketMs) + 1));
  const buckets = new Array(bucketCount).fill(0);
  times.forEach(t => {
    const idx = Math.min(bucketCount - 1, Math.floor((t - min) / bucketMs));
    buckets[idx]++;
  });
  const peak = Math.max(...buckets, 1);
  el.innerHTML = `<div class="actlog-hist-bars">
    ${buckets.map((c, i) => {
      const h = Math.max(2, Math.round((c / peak) * 26));
      const bucketStart = new Date(min + i * bucketMs);
      const label = useHourly ? bucketStart.toLocaleTimeString([], { hour: "2-digit" }) : bucketStart.toLocaleDateString([], { month: "short", day: "numeric" });
      return `<div class="actlog-hist-bar" style="height:${h}px" title="${label}: ${c} event${c===1?"":"s"}"></div>`;
    }).join("")}
  </div>`;
}

function renderActivityRows() {
  const body = document.getElementById("actlog-body");
  const countEl = document.getElementById("actlog-count");
  if (!body) return;
  const moduleColors = { Proposals:"#9b59b6", Coordinator:"#27ae60", Account:"#5b8dee", Users:"#e8a060" };

  if (countEl) countEl.textContent = `${_actlogRows.length} event${_actlogRows.length===1?"":"s"}`;
  if (!_actlogRows.length) {
    body.innerHTML = `<div class="actlog-empty">No events match this filter.</div>`;
    return;
  }
  body.innerHTML = _actlogRows.map((r,i) => {
    const col = moduleColors[r.module] || "#888";
    const isEdit = /edit|modif|updat/i.test(r.action || "");
    const isDelete = /delet|remov|clear/i.test(r.action || "");
    const isCreate = /creat|add|raise/i.test(r.action || "");
    const kind = isDelete ? "del" : isEdit ? "edit" : isCreate ? "new" : "";
    const hasChanges = Array.isArray(r.changes) && r.changes.length > 0;
    const expandable = hasChanges || r.projectId || r.by;
    return `<div class="actlog-ev${expandable?' actlog-ev-expandable':''}" ${expandable?`onclick="_toggleActlogDetail(${i})"`:''}>
      <span class="actlog-ev-time">${escAL(fmtLogTime(r.at))}</span>
      <span class="actlog-ev-mod" style="background:${col}22;color:${col}">${escAL(r.module||"—")}</span>
      <span class="actlog-ev-actor" title="${escAL(r.by||"")}${r.role?' · '+escAL(r.role):''}">${escAL(r.byName||r.by||"—")}</span>
      <span class="actlog-ev-arrow">»</span>
      <span class="actlog-ev-action ${kind?'actlog-ev-'+kind:''}">${escAL(r.action||"")}</span>
      ${r.target?`<span class="actlog-ev-target">${escAL(r.target)}</span>`:""}
      ${r.detail?`<span class="actlog-ev-detail">${escAL(r.detail)}</span>`:""}
      ${expandable?`<span class="actlog-ev-chevron" id="actlog-chev-${i}">▸</span>`:""}
    </div>
    ${expandable?`<div class="actlog-ev-expand" id="actlog-detail-${i}" style="display:none">
      <div class="actlog-kv"><span class="actlog-k">Timestamp</span><span class="actlog-v">${escAL(r.at||"")}</span></div>
      ${r.by?`<div class="actlog-kv"><span class="actlog-k">Actor</span><span class="actlog-v">${escAL(r.byName||"")}${r.by?` &lt;${escAL(r.by)}&gt;`:""}${r.role?` · ${escAL(r.role)}`:""}</span></div>`:""}
      ${r.projectId?`<div class="actlog-kv"><span class="actlog-k">Project ID</span><span class="actlog-v">${escAL(r.projectId)}</span></div>`:""}
      ${hasChanges?`<div class="actlog-kv" style="align-items:flex-start"><span class="actlog-k">Changes</span><span class="actlog-v">
        ${r.changes.map(c => `<div class="actlog-diff-row"><b>${escAL(c.field||c.label||"")}</b>: <span class="actlog-diff-old">${escAL(c.from!=null?String(c.from):"—")}</span> → <span class="actlog-diff-new">${escAL(c.to!=null?String(c.to):"—")}</span></div>`).join("")}
      </span></div>`:""}
    </div>` : ""}`;
  }).join("");
}
function _toggleActlogDetail(i) {
  const el = document.getElementById("actlog-detail-" + i);
  const chev = document.getElementById("actlog-chev-" + i);
  if (!el) return;
  const open = el.style.display !== "none";
  el.style.display = open ? "none" : "block";
  if (chev) chev.textContent = open ? "▸" : "▾";
}

// Local escape (independent of module's esc())
function escAL(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function injectActivityLogStyles() {
  if (document.getElementById("whc-actlog-styles")) return;
  const css = document.createElement("style");
  css.id = "whc-actlog-styles";
  css.textContent = `
  #whc-actlog-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',system-ui,sans-serif}
  .actlog-backdrop{position:absolute;inset:0;background:rgba(15,13,40,0.6);backdrop-filter:blur(3px)}
  .actlog-panel{position:relative;width:min(1500px,95vw);max-height:90vh;display:flex;flex-direction:column;background:#1c2036;border:1px solid #363c63;border-radius:16px;box-shadow:0 24px 60px rgba(10,8,30,0.6);overflow:hidden}
  .actlog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px;background:linear-gradient(135deg,#272c54,#3a4275);border-bottom:1px solid #474f86}
  .actlog-title{font-size:17px;font-weight:700;color:#fff}
  .actlog-sub{font-size:11px;color:#b9c0e6;margin-top:2px}
  .actlog-close{background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:8px;width:30px;height:30px;font-size:14px;cursor:pointer}
  .actlog-close:hover{background:rgba(255,255,255,0.22)}
  .actlog-filters{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #363c63;background:#20244a;flex-wrap:wrap}
  .actlog-sel,.actlog-search,.actlog-date{background:#2c3157;color:#eef0fb;border:1px solid #474f86;border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit}
  .actlog-search{flex:1;min-width:160px}
  .actlog-date{color-scheme:dark;width:132px}
  .actlog-sel:focus,.actlog-search:focus,.actlog-date:focus{outline:none;border-color:#e3c468}
  .actlog-refresh{background:#e3c468;color:#272c54;border:none;border-radius:8px;width:36px;font-size:14px;font-weight:700;cursor:pointer}
  .actlog-histogram{padding:10px 16px 6px;background:#181b30;border-bottom:1px solid #363c63}
  .actlog-hist-bars{display:flex;align-items:flex-end;gap:2px;height:28px}
  .actlog-hist-bar{flex:1;background:linear-gradient(180deg,#7c5cff,#5b3df5);border-radius:2px 2px 0 0;min-width:2px;transition:opacity 0.1s}
  .actlog-hist-bar:hover{opacity:0.7}
  .actlog-count{padding:6px 16px;font-size:10.5px;color:#7d84ad;background:#181b30;border-bottom:1px solid #363c63;font-family:'SF Mono',Consolas,Menlo,monospace}
  .actlog-body{overflow-y:auto;padding:2px 0}
  .actlog-loading,.actlog-empty{padding:40px;text-align:center;color:#8b93c4;font-size:13px}
  /* Dense, structured event row — timestamp / module / actor / action /
     target / detail all visually separated in one line (wraps on mobile),
     monospace timestamp for that log-viewer feel, alternating row shade
     for scanability across many rows at once. */
  .actlog-ev{display:flex;align-items:baseline;gap:8px;padding:6px 16px;font-size:12px;color:#c9cee8;border-bottom:1px solid #22263f;flex-wrap:wrap}
  .actlog-ev:nth-child(odd){background:#20244022}
  .actlog-ev:hover{background:#272c4c}
  .actlog-ev-time{font-family:'SF Mono',Consolas,Menlo,monospace;font-size:10.5px;color:#6b73a0;flex-shrink:0;width:118px}
  .actlog-ev-mod{font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:5px;flex-shrink:0;text-transform:uppercase;letter-spacing:0.3px}
  .actlog-ev-actor{font-weight:600;color:#eef0fb;flex-shrink:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .actlog-ev-arrow{color:#4c5389;flex-shrink:0}
  .actlog-ev-action{color:#d8dcf5}
  .actlog-ev-new{color:#7ee0a8}
  .actlog-ev-edit{color:#f0c869}
  .actlog-ev-del{color:#f08080}
  .actlog-ev-target{color:#9ba3d6;font-weight:600}
  .actlog-ev-target::before{content:"— "}
  .actlog-ev-detail{color:#7d84ad;flex-basis:100%;padding-left:126px;font-size:11px}
  @media(max-width:640px){ .actlog-ev-detail{padding-left:0} .actlog-ev-time{width:auto} }
  .actlog-ev-expandable{cursor:pointer}
  .actlog-ev-chevron{color:#5b628f;font-size:10px;margin-left:auto;flex-shrink:0;transition:transform 0.1s}
  .actlog-ev-expand{background:#161a30;border-bottom:1px solid #2a2f52;padding:10px 16px 12px 126px;font-family:'SF Mono',Consolas,Menlo,monospace;font-size:11px}
  .actlog-kv{display:flex;gap:10px;margin-bottom:4px;line-height:1.5}
  .actlog-k{color:#5b628f;flex-shrink:0;width:78px;text-transform:uppercase;font-size:9.5px;font-weight:700;letter-spacing:0.4px;padding-top:2px}
  .actlog-v{color:#c7cbef;word-break:break-word}
  .actlog-diff-row{color:#c7cbef;padding:2px 0}
  .actlog-diff-old{color:#f08080;text-decoration:line-through;opacity:0.8}
  .actlog-diff-new{color:#7ee0a8;font-weight:600}
  @media(max-width:640px){ .actlog-ev-expand{padding-left:16px} }
  `;
  document.head.appendChild(css);
}


// ── Lightweight project diff for the global activity log ──────
// Projects are nested; this reports which top-level sections changed
// plus the stage count delta, e.g. "Changed: project details, stages (+2)".

// ── Deep field-by-field diff for the detailed audit log ───────
// Produces a flat list of { field, from, to } for every changed leaf value,
// so the activity log can show "modified X from A to B". Arrays are compared
// element-wise with a friendly label. Values are truncated for readability.
function _fmtVal(v) {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "object") { try { return JSON.stringify(v); } catch(e){ return "(object)"; } }
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
function _friendlyField(path) {
  // Turn a dotted path like "project.title" or "lpos[2].status" into a label.
  return path
    .replace(/^project\./, "")
    .replace(/^proposal\./, "")
    .replace(/\./g, " › ")
    .replace(/\[(\d+)\]/g, " #$1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
function deepDiff(prev, next, base, out, seen) {
  out = out || [];
  base = base || "";
  // Skip audit/noise fields.
  const SKIP = new Set(["updatedAt","lastEditedAt","lastEditedBy","createdAt","activityLog","proposalLog","_projSnapshot"]);
  const keys = new Set([...Object.keys(prev||{}), ...Object.keys(next||{})]);
  keys.forEach(k => {
    if (SKIP.has(k)) return;
    const path = base ? `${base}.${k}` : k;
    const a = prev ? prev[k] : undefined;
    const b = next ? next[k] : undefined;
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = Array.isArray(a)?a:[], bb = Array.isArray(b)?b:[];
      const max = Math.max(aa.length, bb.length);
      for (let i=0;i<max;i++){
        if (i>=aa.length) { out.push({ field:_friendlyField(path)+` #${i+1}`, from:"(none)", to:_fmtVal(bb[i]&&bb[i].name?bb[i].name:bb[i]) , added:true}); continue; }
        if (i>=bb.length) { out.push({ field:_friendlyField(path)+` #${i+1}`, from:_fmtVal(aa[i]&&aa[i].name?aa[i].name:aa[i]), to:"(removed)", removed:true}); continue; }
        if (typeof aa[i]==="object" && aa[i]) deepDiff(aa[i], bb[i], `${path}[${i}]`, out, seen);
        else if (aa[i]!==bb[i]) out.push({ field:_friendlyField(path)+` #${i+1}`, from:_fmtVal(aa[i]), to:_fmtVal(bb[i]) });
      }
    } else if (a && b && typeof a==="object" && typeof b==="object") {
      deepDiff(a, b, path, out, seen);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ field:_friendlyField(path), from:_fmtVal(a), to:_fmtVal(b) });
    }
  });
  return out;
}



// ============================================================
//  LPO / Milestone helpers (shared across modules)
//  Real milestone data lives in quotationGroups[].milestones (see
//  _buildQuotationGroup / accountStatus / milestoneAmount). The legacy
//  p.lpos array this section used to document is gone — nothing reads
//  or writes it anymore.
// ============================================================

function lpoTotals(lpos) {
  const list = Array.isArray(lpos) ? lpos : [];
  let raised = 0, credited = 0, pending = 0, count = list.length, creditedCount = 0;
  list.forEach(l => {
    const amt = Number(l.amount) || 0;
    raised += amt;
    if (l.status === "credited") { credited += amt; creditedCount++; }
    else pending += amt;
  });
  return { raised, credited, pending, count, creditedCount };
}

// A milestone's stageStatus is set to "Raise Invoice" by Coordinator once
// work is complete, signaling Account to invoice/credit it. Older records
// saved before this rename still say "Done" — treat both as equivalent so
// existing data keeps working without a migration step.
function isMilestoneRaised(status) {
  return status === "Raise Invoice" || status === "Done";
}

// ── Two SEPARATE status tracks (not one collapsed status) ──────
//
// Coordinator sets stageStatus:  Open | In progress | Raise Invoice
//   (stored value stays "Not started" for the Open state, for backward
//   compatibility with existing data — only the DISPLAY label changed.)
//
// Account sets status: Open | Invoice Pending | Invoice Raised | Credited
//   ("Credited" is stored lowercase "credited", matching the many existing
//   checks for that value across the app.)
//
// Link between them: when Coordinator sets stageStatus to "Raise Invoice",
// Account's status auto-advances from Open to "Invoice Pending" (only if it
// hadn't already been moved further along) — see _setGroupMilestoneStatus
// in coordinator.js. That's what puts it in Account's Awaiting list.

function coordStatusLabel(stageStatus) {
  if (isMilestoneRaised(stageStatus)) return "Raise Invoice";
  if (stageStatus === "In progress") return "In progress";
  return "Open";
}
var COORD_STATUS_STYLE = {
  "Open":          { bg: "#eef0f3", color: "#777",   icon: "" },
  "In progress":   { bg: "#eef4ff", color: "#1a3a5c", icon: "●" },
  "Raise Invoice": { bg: "#fdf3df", color: "#a06b00", icon: "⏳" },
};

// Normalize Account's status, inferring a sensible value for OLDER records
// that predate this 4-state model (they only ever had "pending"/"credited").
function accountStatus(m) {
  if (!m) return "Open";
  const raw = m.status;
  if (raw === "credited" || raw === "Credited") return "Credited";
  if (raw === "Invoice Raised") return "Invoice Raised";
  if (raw === "Invoice Pending") return "Invoice Pending";
  if (raw === "Open") return "Open";
  // Legacy value ("pending") or missing: infer from whether Coordinator
  // has raised it — that's the closest equivalent under the old model.
  return isMilestoneRaised(m.stageStatus) ? "Invoice Pending" : "Open";
}
var ACCOUNT_STATUS_STYLE = {
  "Open":            { bg: "#eef0f3", color: "#777",    icon: "" },
  "Invoice Pending":  { bg: "#fdf3df", color: "#a06b00",  icon: "⏳" },
  "Invoice Raised":   { bg: "#eef4ff", color: "#1a3a5c",  icon: "📨" },
  "Credited":         { bg: "#e3f6ee", color: "#166a3f",  icon: "✓" },
};
// Awaiting Account's action = raised by Coordinator (or already being
// worked) but not yet credited.
function isAwaitingAccount(m) {
  const st = accountStatus(m);
  return st === "Invoice Pending" || st === "Invoice Raised";
}
// ── Milestone amount (single source of truth) ───────────────────
// Regular payment milestones are a % of the quotation group's contract
// total. Government Fees Invoice and Completed Scope Payment rows are
// DIFFERENT — Coordinator enters a direct actual amount for each (the
// govt fee in the quotation is only an estimate; completed-scope payment
// has no % of anything to derive from), so those always use
// m.actualAmount instead of the pct×total formula.
function isFixedAmountRow(m) {
  return !!(m && (m.isGovtFee || m.isCompletedScopePayment));
}
function milestoneAmount(m, groupTotal) {
  if (!m) return 0;
  if (isFixedAmountRow(m)) return Number(m.actualAmount) || 0;
  return groupTotal ? Math.round(groupTotal * (Number(m.pct) || 0) / 100) : (Number(m.amount) || 0);
}
// A project is on Hold or Cancelled — a manual override set by Coordinator/
// Team Lead/Super Admin, independent of the auto-computed workflowStatus
// (new/active/done). See coordinator.js setProjectHoldStatus().
function isProjectOnHold(p) {
  return !!(p && (p.holdStatus === "hold" || p.holdStatus === "cancelled"));
}
// Attention = sitting in Invoice Pending or Invoice Raised for more than
// 10 days without progressing to Credited. Relies on m.statusSince, set
// whenever the status actually changes (see coordinator.js
// _setGroupMilestoneStatus / _setGroupMilestonePayStatus). Milestones from
// before that tracking existed have no statusSince — treated as NOT
// overdue rather than guessed, since there's no reliable date to judge by.
function isMilestoneAttention(m) {
  if (!isAwaitingAccount(m) || !m.statusSince) return false;
  const since = new Date(m.statusSince);
  if (isNaN(since.getTime())) return false;
  const days = (Date.now() - since.getTime()) / 86400000;
  return days > 10;
}

function fmtAED(n) {
  const v = Number(n) || 0;
  return "AED " + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============================================================
//  Shared sidebar (Creative-Tim style, orange gradient)
//  Injected by each module via mountSidebar(active). Nav items are
//  role-filtered. Content (#app) is shifted right via CSS (.has-sidebar).
// ============================================================
// Role arrays come from MODULE_ACCESS in shared/permissions.js (single
// source of truth) — the sidebar just adds labels/icons/URLs.
var SIDEBAR_ITEMS = [
  { key:"proposals",   url:"/proposals/",   icon:"📝", label:"Proposals",   roles: MODULE_ACCESS.proposals },
  { key:"coordinator", url:"/coordinator/", icon:"📋", label:"Coordinator", roles: MODULE_ACCESS.coordinator },
  { key:"templates",   url:"/templates/",   icon:"🧩", label:"Templates",   roles: MODULE_ACCESS.templates },
  { key:"account",     url:"/account/",     icon:"⚙️", label:"Account",     roles: MODULE_ACCESS.account },
  { key:"payments",    url:"/payments/",    icon:"📊", label:"Milestone",  roles: MODULE_ACCESS.payments },
  { key:"summary",     url:"/summary/",     icon:"📊", label:"Overall Summary",     roles: MODULE_ACCESS.summary },
  { key:"team_performance", url:"/team-performance/", icon:"🏆", label:"Team Performance", roles: MODULE_ACCESS.team_performance },
];

// Roles that may only VIEW (not edit) a given module. Used by the
// pages to render in read-only mode. Super admin is never restricted.
// VIEW_ONLY_ROLES now lives in shared/permissions.js (single source of
// truth), loaded before this file on every page.
function isViewOnly(moduleKey, role) {
  if (role === "super_admin") return false;
  const list = VIEW_ONLY_ROLES[moduleKey] || [];
  return list.includes(role);
}

// Render the current page in read-only mode: disables form controls and
// edit/save/delete actions, and shows a "View only" badge. Called by pages
// when the signed-in role has view-only access to that module. It runs once
// now and re-applies on DOM changes so dynamically-rendered controls are
// also locked. Elements opting out can carry the class "vo-allow".
function applyViewOnlyMode(moduleLabel) {
  const lock = (root) => {
    root.querySelectorAll("input, textarea, select, button").forEach(el => {
      if (el.classList.contains("vo-allow")) return;       // explicit opt-out
      if (el.closest("#whc-sidebar, .view-toggle, #whc-timeout-bar")) return; // keep nav usable
      // Allow read-only-safe controls: search box, date filters, view toggles.
      const safe = el.matches("[data-vo-safe], .search, .filter, [type=search], [type=date]") ||
                   (el.closest && el.closest("[data-vo-safe]"));
      if (safe) return;
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
      el.style.cursor = "not-allowed";
    });
    // Neutralise links styled as action buttons (Save/Add/Delete/Edit).
    root.querySelectorAll("a.btn, .btn-primary, .btn-danger, [data-action]").forEach(el => {
      if (el.classList.contains("vo-allow")) return;
      el.style.pointerEvents = "none";
      el.style.opacity = "0.5";
    });
  };

  const showBadge = () => {
    if (document.getElementById("whc-vo-badge")) return;
    const b = document.createElement("div");
    b.id = "whc-vo-badge";
    b.textContent = "👁 View only — " + (moduleLabel || "this section") + " is read-only for your role";
    b.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:9998",
      "background:#1f3a5f","color:#fff","font-size:12px","font-weight:600",
      "padding:7px 16px","text-align:center","letter-spacing:0.3px"
    ].join(";");
    document.body.appendChild(b);
    document.body.style.paddingTop = "34px";
  };

  const run = () => { lock(document); showBadge(); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else { run(); }

  // Re-lock when pages render content asynchronously.
  const mo = new MutationObserver(() => lock(document));
  mo.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
//  Theme preferences: dark/light, accent color, density
//  Stored in localStorage (per-browser), applied as data-* attributes
//  on <html> so the whole CSS variable system (see style.css :root)
//  picks it up automatically. Also applied via a tiny inline snippet at
//  the very top of every page's <head> (before the stylesheet loads) to
//  avoid a flash of the wrong theme on load — this function is what
//  re-applies it after full page scripts are available (e.g. for the
//  picker UI itself), not the very first paint.
// ============================================================
var THEME_ACCENTS = [
  { id: "default",   label: "Blueprint (default)", swatch: "linear-gradient(135deg,#2d6a9e,#0f3355)", swatchDark: "linear-gradient(135deg,#4a90c9,#1a3a5c)" },
  { id: "slate",      label: "Slate",           swatch: "linear-gradient(135deg,#7b8998,#3d4a5c)", swatchDark: "linear-gradient(135deg,#9aa8b8,#5b6b7d)" },
  { id: "concrete",   label: "Concrete",        swatch: "linear-gradient(135deg,#a39990,#5c5249)", swatchDark: "linear-gradient(135deg,#c4b8ac,#83776c)" },
  { id: "steel",      label: "Steel",           swatch: "linear-gradient(135deg,#6b8299,#374856)", swatchDark: "linear-gradient(135deg,#8aa0b8,#4f6478)" },
  { id: "classic",    label: "Classic Navy & Gold", swatch: "linear-gradient(135deg,#c9a752,#4c1d95)", swatchDark: "linear-gradient(135deg,#e0bd6e,#6d28d9)" },
];
function getThemePrefs() {
  let theme = "light", accent = "default", density = "comfortable";
  try {
    theme = localStorage.getItem("whc_theme") || "light";
    accent = localStorage.getItem("whc_accent") || "default";
    density = localStorage.getItem("whc_density") || "comfortable";
  } catch (e) {}
  return { theme, accent, density };
}
function applyThemePrefs() {
  const p = getThemePrefs();
  const html = document.documentElement;
  if (p.theme === "dark") html.setAttribute("data-theme", "dark"); else html.removeAttribute("data-theme");
  if (p.accent && p.accent !== "default") html.setAttribute("data-accent", p.accent); else html.removeAttribute("data-accent");
  if (p.density === "compact") html.setAttribute("data-density", "compact"); else html.removeAttribute("data-density");
}
function setThemePref(key, value) {
  try { localStorage.setItem("whc_" + key, value); } catch (e) {}
  applyThemePrefs();
  renderThemePanel();
}

function toggleThemePanel() {
  const el = document.getElementById("whc-theme-panel");
  if (!el) return;
  const open = el.style.display !== "none";
  el.style.display = open ? "none" : "block";
}
function renderThemePanel() {
  const el = document.getElementById("whc-theme-panel");
  if (!el) return;
  const p = getThemePrefs();
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;opacity:0.85">Appearance</div>

    <div style="display:flex;gap:6px;margin-bottom:12px">
      <button type="button" onclick="setThemePref('theme','light')" style="flex:1;padding:7px 0;border-radius:8px;border:1.5px solid ${p.theme==='light'?'#fff':'rgba(255,255,255,0.25)'};background:${p.theme==='light'?'rgba(255,255,255,0.18)':'transparent'};color:#fff;font-size:11px;font-weight:600;cursor:pointer">☀️ Light</button>
      <button type="button" onclick="setThemePref('theme','dark')" style="flex:1;padding:7px 0;border-radius:8px;border:1.5px solid ${p.theme==='dark'?'#fff':'rgba(255,255,255,0.25)'};background:${p.theme==='dark'?'rgba(255,255,255,0.18)':'transparent'};color:#fff;font-size:11px;font-weight:600;cursor:pointer">🌙 Dark</button>
    </div>

    <div style="font-size:10px;color:rgba(255,255,255,0.65);margin-bottom:6px;font-weight:600">Accent color</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px">
      ${THEME_ACCENTS.map(a => `<div onclick="setThemePref('accent','${a.id}')" title="${esc(a.label)}"
        style="cursor:pointer;text-align:center">
        <div style="width:100%;height:26px;border-radius:8px;background:${p.theme==='dark'?a.swatchDark:a.swatch};border:2px solid ${p.accent===a.id?'#fff':'transparent'};box-shadow:${p.accent===a.id?'0 0 0 2px rgba(255,255,255,0.3)':'none'}"></div>
      </div>`).join("")}
    </div>

    <div style="font-size:10px;color:rgba(255,255,255,0.65);margin-bottom:6px;font-weight:600">Density</div>
    <div style="display:flex;gap:6px">
      <button type="button" onclick="setThemePref('density','comfortable')" style="flex:1;padding:7px 0;border-radius:8px;border:1.5px solid ${p.density==='comfortable'?'#fff':'rgba(255,255,255,0.25)'};background:${p.density==='comfortable'?'rgba(255,255,255,0.18)':'transparent'};color:#fff;font-size:11px;font-weight:600;cursor:pointer">Comfortable</button>
      <button type="button" onclick="setThemePref('density','compact')" style="flex:1;padding:7px 0;border-radius:8px;border:1.5px solid ${p.density==='compact'?'#fff':'rgba(255,255,255,0.25)'};background:${p.density==='compact'?'rgba(255,255,255,0.18)':'transparent'};color:#fff;font-size:11px;font-weight:600;cursor:pointer">Compact</button>
    </div>`;
}

function mountSidebar(activeKey) {
  if (document.getElementById("whc-sidebar")) return; // once
  const u = getSession() || {};
  const role = u.role || "";
  const items = SIDEBAR_ITEMS.filter(it => it.roles.includes(role));

  const homeLink = `
    <a href="/auth/" class="sb-link ${activeKey==="home"?"on":""}">
      <span class="sb-ico">🏠</span><span class="sb-label">Home</span>
    </a>`;
  const nav = homeLink + items.map(it => `
    <a href="${it.url}" class="sb-link ${it.key===activeKey?"on":""}">
      <span class="sb-ico">${it.icon}</span><span class="sb-label">${it.label}</span>
    </a>`).join("");

  const co = (typeof getCompany==="function") ? getCompany() : { name:"Winner Holistic Consultant", short:"WHC" };
  const el = document.createElement("div");
  el.id = "whc-sidebar";
  el.className = "whc-sidebar";
  el.innerHTML = `
    <div class="sb-brand">
      <div class="sb-brand-mark">${esc((co.short||"WHC").slice(0,3).toUpperCase())}</div>
      <div class="sb-brand-text">
        <div class="sb-brand-name">${esc(co.short||"WHC")}</div>
        <div class="sb-brand-sub">${esc(co.name||"")}</div>
      </div>
    </div>
    <div class="sb-nav">${nav}</div>
    <div class="sb-foot">
      <div id="whc-theme-panel" style="display:none;background:rgba(0,0,0,0.18);border-radius:12px;padding:12px;margin-bottom:10px"></div>
      <button type="button" onclick="toggleThemePanel()" style="width:100%;padding:8px;margin-bottom:8px;border:1.5px solid rgba(255,255,255,0.25);border-radius:9px;background:rgba(255,255,255,0.1);color:#fff;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">🎨 Appearance</button>
      <div class="sb-user">
        <div class="sb-user-avatar">${esc((u.name||"U").charAt(0).toUpperCase())}</div>
        <div class="sb-user-info">
          <div class="sb-user-name">${esc(u.name||"User")}</div>
          <div class="sb-user-role">${esc((role||"").replace("_"," "))}</div>
        </div>
      </div>
      <button class="sb-logout" onclick="serverLogout().then(()=>window.location.href='/auth/')">Logout</button>
    </div>`;
  document.body.appendChild(el);
  applyThemePrefs();
  renderThemePanel();

  // Mobile toggle button
  const tog = document.createElement("button");
  tog.id = "whc-sb-toggle";
  tog.className = "whc-sb-toggle";
  tog.innerHTML = "☰";
  tog.onclick = () => document.body.classList.toggle("sb-open");
  document.body.appendChild(tog);

  // Backdrop for mobile
  const bd = document.createElement("div");
  bd.className = "whc-sb-backdrop";
  bd.onclick = () => document.body.classList.remove("sb-open");
  document.body.appendChild(bd);

  document.body.classList.add("has-sidebar");
}

// ============================================================
//  View mode: Desktop vs Mobile (view-only)
//  - Auto-detects phones on first load (no stored preference).
//  - User can override via a floating toggle; choice persists.
//  - Mobile view = body.mobile-view, which CSS uses to hide all
//    edit/input controls and reflow into single-column read cards.
//  Editing remains fully available in Desktop view.
// ============================================================
function _isPhone() {
  return window.matchMedia("(max-width: 820px)").matches
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}
function getViewMode() {
  let m = null;
  try { m = localStorage.getItem("whc_view_mode"); } catch(e){}
  if (m === "mobile" || m === "desktop") return m;     // explicit user choice
  return _isPhone() ? "mobile" : "desktop";            // auto-detect
}
function applyViewMode(mode) {
  const m = mode || getViewMode();
  document.body.classList.toggle("mobile-view", m === "mobile");
  const btn = document.getElementById("whc-view-toggle");
  if (btn) btn.innerHTML = (m === "mobile")
    ? "🖥 Desktop view"
    : "📱 Mobile view";
}
function mountViewToggle() {
  // No manual toggle button. Phones auto-detect into the responsive
  // single-column layout, but everything stays fully editable.
  applyViewMode();
  window.addEventListener("resize", () => applyViewMode());
}

// ============================================================
//  Inline SVG icons — premium look, zero downloads.
//  Tiny, crisp at any size, consistent across all devices.
//  Usage: svgIcon("check"), svgIcon("arrow-right", 18, "#fff")
// ============================================================
function svgIcon(name, size, color) {
  const s = size || 16;
  const c = color || "currentColor";
  const wrap = (inner, fill) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="vertical-align:-0.15em;display:inline-block">${inner}</svg>`;
  const P = {
    "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    "arrow-left":  '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    "arrow-up":    '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    "arrow-down":  '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    "check":       '<polyline points="20 6 9 17 4 12"/>',
    "close":       '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    "refresh":     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    "download":    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    "edit":        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    "plus":        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  };
  return wrap(P[name] || P["arrow-right"]);
}

// ============================================================
//  Attachments (OneDrive) — one file per record.
//  uploadAttachment(file, recordType, recordId) -> {url,name,size,...}
//  The actual upload happens server-side (Netlify function), which
//  holds the Microsoft credentials. Here we just send the file and
//  store the returned link on the record.
// ============================================================
var ATTACH_ENDPOINT = "/api/onedrive-upload.php";
var ATTACH_MAX = 4 * 1024 * 1024;
var ATTACH_TYPES = ["pdf","png","jpg","jpeg","gif","webp","heic","bmp","tif","tiff"];
// Turn this ON after the Azure + Netlify OneDrive setup is done.
// While false, the upload box shows a "coming soon" note instead of erroring.
var ATTACH_ENABLED = false;

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

// Build a small JPEG thumbnail (data URL) for an image file, entirely in the
// browser — no server cost, no dependencies. Returns "" for non-images or on
// failure. Kept small (max ~320px, ~40KB) so it's cheap to store on the record.
function _makeThumb(file, maxPx) {
  return new Promise((resolve) => {
    if (!/^image\//i.test(file.type)) return resolve("");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const m = maxPx || 320;
        let { width: w, height: h } = img;
        if (w > h && w > m) { h = Math.round(h * m / w); w = m; }
        else if (h >= w && h > m) { w = Math.round(w * m / h); h = m; }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL("image/jpeg", 0.7);
        URL.revokeObjectURL(url);
        resolve(dataUrl.length < 200000 ? dataUrl : ""); // safety cap ~200KB
      } catch (e) { URL.revokeObjectURL(url); resolve(""); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

async function uploadAttachment(file, recordType, recordId) {
  if (!file) throw new Error("No file selected");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ATTACH_TYPES.includes(ext)) throw new Error("Only images and PDF files are allowed.");
  if (file.size > ATTACH_MAX) throw new Error("File too large (max 4MB).");
  const isImg = /^image\//i.test(file.type);
  const [fileBase64, thumb] = await Promise.all([ _fileToBase64(file), _makeThumb(file, 320) ]);
  const res = await fetch(ATTACH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fileName: file.name, fileBase64, recordType: recordType || "misc", recordId: recordId || "" }),
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || !data.ok) throw new Error(data.error || ("Upload failed (" + res.status + ")"));
  // Attach a browser-made thumbnail + kind so the app can preview inline.
  data.kind = isImg ? "image" : (ext === "pdf" ? "pdf" : "file");
  if (thumb) data.thumb = thumb;
  return data; // { url, name, size, itemId, uploadedAt, kind, thumb? }
}

// Render the inline preview for a stored attachment (image thumb / PDF card).
function attachmentPreview(att, opts) {
  if (!att || !att.url) return "";
  const big = opts && opts.large;
  const isImg = att.kind === "image" || (!att.kind && /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(att.name||""));
  const isPdf = att.kind === "pdf" || /\.pdf$/i.test(att.name||"");
  const sizeTxt = att.size ? Math.round(att.size/1024)+" KB" : "";

  // ── Images: show the actual image inline. Prefer the stored thumb
  //    (cheap, already in the record); fall back to loading the full
  //    image from its URL so there's always a visual preview. ───────
  if (isImg) {
    const src = att.thumb || att.url;
    return `<a href="${esc(att.url)}" target="_blank" rel="noopener" class="att-thumb-wrap" title="Open full image">
      <img src="${esc(src)}" class="att-thumb${big?" att-thumb-lg":""}" loading="lazy"
           alt="${esc(att.name||"attachment")}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
      <span class="att-pdf-card" style="display:none">
        <span class="att-pdf-ico">🖼</span>
        <span class="att-pdf-info"><span class="att-pdf-name">${esc(att.name||"Image")}</span>
          <span class="att-pdf-sub">${sizeTxt||"Image"} · tap to open</span></span>
      </span>
      <span class="att-thumb-cap">🖼 ${esc(att.name||"Image")} ${sizeTxt?`· ${sizeTxt}`:""}</span>
    </a>`;
  }

  // ── PDFs: embed a real inline preview of the first page via <iframe>,
  //    with the tap-to-open card kept underneath as caption + fallback. ─
  if (isPdf) {
    const frameH = big ? 420 : 220;
    return `<div class="att-pdf-preview">
      <div class="att-pdf-frame-wrap" style="position:relative;border:1px solid #e3e6ef;border-radius:10px;overflow:hidden;background:#f7f8fc">
        <iframe src="${esc(att.url)}#toolbar=0&navpanes=0&view=FitH" title="${esc(att.name||"PDF preview")}"
                style="width:100%;height:${frameH}px;border:0;display:block" loading="lazy"></iframe>
        <a href="${esc(att.url)}" target="_blank" rel="noopener"
           style="position:absolute;inset:0;background:transparent" title="Open PDF in new tab"></a>
      </div>
      <a href="${esc(att.url)}" target="_blank" rel="noopener" class="att-pdf-card" style="margin-top:6px" title="Open PDF">
        <span class="att-pdf-ico">📄</span>
        <span class="att-pdf-info"><span class="att-pdf-name">${esc(att.name||"Document.pdf")}</span>
          <span class="att-pdf-sub">PDF${sizeTxt?` · ${sizeTxt}`:""} · tap to open full</span></span>
      </a>
    </div>`;
  }

  // Generic file / image without thumb
  return `<a href="${esc(att.url)}" target="_blank" rel="noopener" class="att-pdf-card">
    <span class="att-pdf-ico">${isImg?"🖼":"📎"}</span>
    <span class="att-pdf-info"><span class="att-pdf-name">${esc(att.name||"View file")}</span>
      <span class="att-pdf-sub">${sizeTxt||"Attachment"} · tap to open</span></span>
  </a>`;
}

// Render a small attachment widget for a record.
// `current` is the stored attachment object (or null). `onChangeFn` is the
// NAME of a global function to call with the new attachment object after upload.
function attachmentWidget(current, recordType, recordId, onChangeFnName) {
  const inputId = "att_" + Math.random().toString(36).slice(2, 8);
  const hasFile = current && current.url;
  // Until OneDrive is configured, show the box but don't allow clicks that error.
  if (!ATTACH_ENABLED) {
    return `
    <div class="att-wrap">
      <div class="att-label">📎 Proof / Attachment</div>
      ${hasFile ? `<div class="att-current-preview">${attachmentPreview(current)}</div>` : `
      <div class="att-upload-btn" style="cursor:default;opacity:0.7;border-style:dashed">
        ⬆ File upload — setup in progress (OneDrive not connected yet)
      </div>`}
    </div>`;
  }
  return `
  <div class="att-wrap" data-rt="${esc(recordType||"")}" data-rid="${esc(recordId||"")}">
    <div class="att-label">📎 Proof / Attachment</div>
    ${hasFile ? `
      <div class="att-current-preview">
        ${attachmentPreview(current)}
        <button type="button" class="att-replace" onclick="document.getElementById('${inputId}').click()">Replace</button>
      </div>` : `
      <button type="button" class="att-upload-btn" onclick="document.getElementById('${inputId}').click()">
        ⬆ Upload proof (image or PDF, max 4MB)
      </button>`}
    <input type="file" id="${inputId}" accept=".pdf,image/*" style="display:none"
      onchange="_handleAttach(this,'${esc(recordType||"")}','${esc(recordId||"")}','${esc(onChangeFnName||"")}')"/>
    <div class="att-status" id="${inputId}_status"></div>
  </div>`;
}

async function _handleAttach(inputEl, recordType, recordId, onChangeFnName) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  const statusEl = document.getElementById(inputEl.id + "_status");
  if (statusEl) statusEl.innerHTML = `<span style="color:#a06b00">⏳ Uploading…</span>`;
  try {
    const att = await uploadAttachment(file, recordType, recordId);
    if (statusEl) statusEl.innerHTML = `<span style="color:#166a3f">✓ Uploaded</span>`;
    if (onChangeFnName && typeof window[onChangeFnName] === "function") {
      window[onChangeFnName](att, recordId);
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#a32d2d">✕ ${esc(e.message||"Upload failed")}</span>`;
  } finally {
    inputEl.value = "";
  }
}

// ============================================================
//  Proposal → Coordinator bridge.
//  When a quotation is marked Won/Converted, ensure a matching
//  project exists in the Coordinator/Account dashboard, carrying
//  over the key fields. Idempotent: the project id is derived from
//  the quotation id, so re-saving updates the same project rather
//  than creating duplicates. Never overwrites coordinator-entered
//  work (stages, lpos, coordinator name, scope) once present.
// ============================================================
// ── Revision → new quotation ──────────────────────────────────
// When a coordinator raises a revision request, mint a REAL new quotation:
// it draws the next number from the parent project's category counter, keeps
// the same folder number, starts in Open state, and is saved to the Proposals
// list so the Proposals team can fill in its full details. Returns the new
// quotation's number (or "" on failure).
var _CATEGORY_PATH = {
  "Fitout Folder": "quotations/fitout",
  "Live Folder":   "quotations/live",
  "ID Folder":     "quotations/id",
  "Private Folder":"quotations/private"
};
// Numbering config (mirrors QTN_CONFIG in proposals-quotation.js) so the
// coordinator page can mint the next number without loading that file.
// ── Quotation number format (single source of truth) ───────────
// Q-<Company>-<Category>-<Seq>-<Year>-R<Revision>
//   Company:  W = Winner Holistic Consultant, M = Moonway, S = WH Safety & Fire
//             (derived from the active company — see getCompany() above)
//   Category: F = Fitout, L = Live, ID = ID, P = Private
//   Seq:      a running number — auto-suggested from the counter below, but
//             fully editable by Super Admin / Proposals in the quotation
//             form, so it can be set to continue an existing numbering.
//   Year:     2-digit year
//   Revision: R0 = original quotation; a raised revision bumps this to
//             R1, R2… on the SAME base number rather than taking a new one
//             (see mintRevisionQuotation below).
var QTN_CATEGORY_CODE = { "Fitout Folder": "F", "Live Folder": "L", "ID Folder": "ID", "Private Folder": "P" };
var QTN_COMPANY_LETTER = { whc: "W", mw: "M", whsf: "S" };
function qtnCompanyLetter() {
  const id = (typeof getCompany === "function") ? getCompany().id : "whc";
  return QTN_COMPANY_LETTER[id] || "W";
}
function qtnBuildNumber(category, seq, yr) {
  const cat = QTN_CATEGORY_CODE[category] || "X";
  return `Q-${qtnCompanyLetter()}-${cat}-${seq}-${yr}-R0`;
}
// NOTE: R0/R1/R2 is Proposals' OWN revision-column tracking within a single
// quotation's Scope & Fees table (freezing a column when "+ Add Revision"
// is used, then editing the next one) — it has nothing to do with
// Coordinator's revision REQUEST flow below, which always mints a fresh,
// distinct quotation number (see mintRevisionQuotation) since a Coordinator-
// raised request is for re-approval / additional scope, not a price
// revision of the existing quotation.

var _QTN_NUM_CONFIG = {
  "Fitout Folder":  { pattern: (s,y)=>qtnBuildNumber("Fitout Folder", s, y),  counterKey:"qtn_counter/fitout",  startSeq:1709 },
  "Live Folder":    { pattern: (s,y)=>qtnBuildNumber("Live Folder", s, y),    counterKey:"qtn_counter/live",    startSeq:747 },
  "ID Folder":      { pattern: (s,y)=>qtnBuildNumber("ID Folder", s, y),      counterKey:"qtn_counter/id",      startSeq:108 },
  "Private Folder": { pattern: (s,y)=>qtnBuildNumber("Private Folder", s, y),counterKey:"qtn_counter/private", startSeq:316 }
};
async function _nextQtnNumber(category) {
  const cfg = _QTN_NUM_CONFIG[category] || _QTN_NUM_CONFIG["Fitout Folder"];
  const yr = String(new Date().getFullYear()).slice(-2);
  const seq = await fbIncrement(coPath(cfg.counterKey), cfg.startSeq);
  return cfg.pattern(seq != null ? seq : cfg.startSeq, yr);
}
// Build the standard project display name: "<folder>_<projectName>"
// (e.g. "1278_Alguir"). Safe against blanks and avoids double-prefixing if
// the name already begins with the folder.
// Append a stamped entry to a milestone's follow-up thread and persist it.
// Shared by coordinator and account so both post to the same thread.
async function postMilestoneFollowup(projectId, gi, mi, text) {
  text = (text || "").trim();
  if (!text) return false;
  const all = (typeof ALL_PROJECTS !== "undefined" && ALL_PROJECTS) ? ALL_PROJECTS : {};
  const proj = all[projectId];
  if (!proj || !proj.quotationGroups || !proj.quotationGroups[gi]) return false;
  const ms = proj.quotationGroups[gi].milestones && proj.quotationGroups[gi].milestones[mi];
  if (!ms) return false;
  if (!Array.isArray(ms.followupThread)) ms.followupThread = [];
  const who = currentActor();
  ms.followupThread.push({
    by: who.email || who.name || "",
    byName: who.name || "",
    role: who.role || "",
    at: new Date().toISOString(),
    text
  });
  try { await fbSet(coPath("projects/" + projectId + "/quotationGroups"), proj.quotationGroups); return true; }
  catch (e) { ms.followupThread.pop(); return false; }
}

// Render a milestone's follow-up thread (read-only list of stamped entries).
function renderFollowupThread(ms) {
  const th = (ms && ms.followupThread) || [];
  if (!th.length) return `<div style="font-size:11px;color:#bbb;padding:4px 0">No follow-up yet.</div>`;
  return th.map(e => {
    const roleColor = e.role === "account" ? "#1d9e75" : e.role === "coordinator" ? "#5b3df5" : "#888";
    const name = (typeof resolveUserName === "function") ? resolveUserName(e.by) || e.byName || "Someone" : (e.byName || "Someone");
    const when = (typeof fmtLogTime === "function") ? fmtLogTime(e.at) : (e.at || "");
    return `<div style="border-left:2px solid ${roleColor};padding:3px 0 3px 8px;margin:4px 0">
      <div style="font-size:10px;color:${roleColor};font-weight:700">${esc(name)}${e.role?` · ${esc(e.role)}`:""} <span style="color:#bbb;font-weight:400">· ${esc(when)}</span></div>
      <div style="font-size:12px;color:#333">${esc(e.text||"")}</div>
    </div>`;
  }).join("");
}

// Display name for a project = "<folder>_<title>" (e.g. 1278_Alguir).
// Works from a full project record OR a project.project sub-object; uses the
// stored folderPath and guards against double-prefixing.
function projTitle(projOrRecord) {
  if (!projOrRecord) return "";
  // Accept either the whole project record or its .project sub-object.
  const rec = projOrRecord.project ? projOrRecord : null;
  const folder = rec ? (rec.folderPath || (rec.proposal && rec.proposal.folderPath)) : (projOrRecord.folderPath || "");
  const p = rec ? rec.project : projOrRecord;
  // Title fallbacks: stored title → proj_name → quotation number.
  const title = (p && (p.title || p.proj_name))
    || (rec && rec.proposal && rec.proposal.quotationNumber)
    || (rec && rec.fromQuotationId)
    || "";
  return _combineFolderName(folder, title) || title || "";
}

function _combineFolderName(folder, name) {
  folder = String(folder || "").trim();
  name = String(name || "").trim();
  if (!folder) return name;
  if (!name) return folder;
  // Already combined? (starts with "folder_" or "folder-" or "folder ")
  const rx = new RegExp("^" + folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ _-]");
  if (rx.test(name)) return name;
  return folder + "_" + name;
}

async function mintRevisionQuotation(project, req) {
  try {
    const category = (project.category) || (project.proposal && project.proposal.category) || "Fitout Folder";
    const path = _CATEGORY_PATH[category] || "quotations/fitout";
    // A Coordinator-raised revision request is for RE-APPROVAL / additional
    // scope — a genuinely separate quotation, not a revision of the pricing
    // on the existing one. It always gets its own fresh, distinct quotation
    // number from the normal counter. (R0/R1/R2 is a different thing
    // entirely — that's Proposals' own revision-column tracking WITHIN one
    // quotation's Scope & Fees table, e.g. when re-editing and resubmitting
    // the same quotation. This function never touches that.)
    const qtnNo = await _nextQtnNumber(category);
    const folder = (project.folderPath) || (project.proposal && project.proposal.folderName) || project.id || "";
    const id = "qtn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const who = currentActor();
    // Carry the CLEAN project name (strip the "<folder>_" prefix if present) so
    // saving the revision never re-prefixes or renames the project.
    const storedTitle = (project.project && project.project.title) || "";
    let cleanName = storedTitle;
    if (folder && storedTitle) {
      const rx = new RegExp("^" + String(folder).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ _-]");
      cleanName = storedTitle.replace(rx, "");
    }
    const rec = {
      id, category,
      qtn_number: qtnNo,
      proj_name: cleanName || storedTitle || "",
      client_name: (project.project && project.project.client) || "",
      location: (project.project && project.project.location) || "",
      folder_ref: folder,
      folderPath: folder,
      open_status: "Open",
      is_revision: true,
      parent_project_id: project.id || "",
      parent_quotation: (project.proposal && project.proposal.quotationNumber) || "",
      rev_title: req.title || "",
      rev_reason: req.reason || "",
      scope: req.scope || "",
      raisedBy: who.email || who.name || "",
      createdAt: new Date().toISOString(),
      // Project-level details a revision always inherits (never re-typed):
      // client, location and Project Type all live on the project record,
      // not per-quotation, so copy them straight through.
      project: { unitType: Array.isArray(project.project && project.project.unitType) ? project.project.unitType.slice() : [] }
    };
    await fbSet(coPath(path + "/" + id), rec);
    return { qtnNo, id };
  } catch (e) { return { qtnNo: "", id: "" }; }
}

// ============================================================
// Build one quotation group: its scope[], milestones[], fees, and own total.
// Scope and milestones are a coupled set belonging to this quotation.
function _buildQuotationGroup(quotation, pj, value, who, nowIso) {
  const scope = (pj.scope || []).map(s => ({
    name: s.name || "", desc: s.desc || "", code: s.code || "", value: Number(s.value) || 0,
    rev: Array.isArray(s.rev) ? s.rev.slice() : [Number(s.value) || 0]
  }));
  const govtFees = (pj.govtFees || []).map(g => ({
    label: g.label || "", amount: Number(g.amount) || 0,
    rev: Array.isArray(g.rev) ? g.rev.slice() : [Number(g.amount) || 0]
  }));
  const subFees = (pj.subFees || []).map(s => ({
    label: s.label || "", name: s.name || "", amount: Number(s.amount) || 0,
    rev: Array.isArray(s.rev) ? s.rev.slice() : [Number(s.amount) || 0]
  }));
  // Compute totals from the CURRENT revision column so revisions reflect
  // correctly. value/amount already carry the current-revision figure.
  // Scope and Sub-Contractor Fees each get their own 5% VAT; Govt Fees carry
  // no VAT. Total incl. VAT = full amount invoiced to client. Net Amount
  // (WHC) = what WHC retains after Sub-Contractor + Govt Fees pass through.
  const subtotal = scope.reduce((a, s) => a + (s.value || 0), 0);
  const vat = Math.round(subtotal * 0.05);
  const scopeInclVat = subtotal + vat;
  const govtTotal = govtFees.reduce((a, g) => a + (g.amount || 0), 0);
  const subTotalFees = subFees.reduce((a, s) => a + (s.amount || 0), 0);
  const subVat = Math.round(subTotalFees * 0.05);
  const subInclVat = subTotalFees + subVat;
  const contractTotal = scopeInclVat + subInclVat + govtTotal;
  const netAmount = scopeInclVat - subInclVat - govtTotal;
  const milestones = (pj.lpo || []).map((m, idx) => ({
    id: "ms_" + (quotation.id || "q") + "_" + idx,
    name: m.name || ("Milestone " + (idx + 1)),
    pct: Number(m.pct) || 0,
    amount: Number(m.value) || Math.round(contractTotal * (Number(m.pct) || 0) / 100),
    stageStatus: "Not started",     // Not started / In progress / Raise Invoice (older records may still say "Done" — isMilestoneRaised() treats both the same)
    status: "pending",              // pending / credited (Account)
    owner: "", invoiceNo: "", creditedDate: "", paymentRef: "",
    createdAt: nowIso
  }));
  // Government Fees Invoice is mandatory, not optional — auto-added to the
  // SAME milestone list whenever the quotation carries govt fees, so it
  // follows the exact same workflow as every other milestone rather than
  // being a separate thing Coordinator has to remember to add. The
  // quotation's govt fee figure is only an estimate; the actual amount is
  // entered by Coordinator when actually raising the invoice (see
  // isFixedAmountRow / milestoneAmount in this file).
  if (govtTotal > 0) {
    milestones.push({
      id: "govtfee_" + (quotation.id || "q"),
      name: "Government Fees Invoice",
      isGovtFee: true,
      estimatedAmount: govtTotal,
      actualAmount: 0, remarks: "", pct: 0,
      stageStatus: "Not started", status: "Open",
      owner: "", invoiceNo: "", creditedDate: "", paymentRef: "",
      createdAt: nowIso
    });
  }
  return {
    id: "grp_" + (quotation.id || Date.now()),
    quotationNo: quotation.qtn_number || "",
    quotationId: quotation.id || "",
    isRevision: !!quotation.is_revision,
    parentQuotation: quotation.parent_quotation || "",
    scope, govtFees, subFees, milestones,
    scopeFrozen: pj.scopeFrozen || 0,
    subtotal, vat, govtTotal, subTotal: subTotalFees, subVat, contractTotal, netAmount,
    scopeFile: pj.scopeFile || null,
    subFile: pj.subFile || null,
    lpoFile: pj.lpoFile || null,
    createdAt: nowIso,
    createdBy: (who && who.name) || ""
  };
}

// The deterministic project id for a given quotation — same formula used
// everywhere a quotation needs to be associated with its project, so a
// quotation's activity log entries can always be tagged correctly even
// before the project record itself exists yet (the id is derivable from
// the quotation alone, doesn't require the project to already exist).
function deriveProjectIdForQuotation(q) {
  if (!q) return "";
  return (q.is_revision && q.parent_project_id)
    ? q.parent_project_id
    : "proj_" + (q.id || ("q_" + Date.now()));
}

async function ensureProjectFromQuotation(quotation, category) {
  if (!quotation) return;
  // Awarded = Won AND email confirmation received. (LPO Received is
  // tracked separately and no longer gates this — see collectProjectDetails/
  // _isAwardedNow in proposals-quotation.js, which this must match or a
  // quotation can pass the "awarded" check there but silently fail to
  // create/update its project here.)
  const won = (quotation.open_status || "").toLowerCase() === "won";
  const emailOk = (quotation.email_confirm || "").toUpperCase() === "Y";
  if (!(won && emailOk)) return;

  // A revision quotation carries parent_project_id (set by mintRevisionQuotation)
  // pointing at the ORIGINAL project. Resolve to that same project so revisions
  // add a new quotation tab under it instead of spawning a duplicate project
  // with the same name. Only a brand-new (non-revision) quotation mints a
  // fresh project id from its own quotation id.
  const projId = deriveProjectIdForQuotation(quotation);
  const path = coPath("projects/" + projId);

  // Load any existing project so we don't clobber coordinator work.
  let existing = null;
  try { existing = await fbGet(path, { fresh: true }); } catch (e) {}

  const who = (typeof CURRENT_USER !== "undefined" && CURRENT_USER) || getSession() || {};
  const nowIso = new Date().toISOString();
  // Contract value = the computed Total (incl. VAT & Govt Fees) from the
  // scope table; fall back to legacy net_amount if not present.
  const pj = quotation.project || {};
  const value = (pj.contractTotal != null && pj.contractTotal !== "")
    ? pj.contractTotal
    : (quotation.net_amount != null ? quotation.net_amount : (quotation.total_amount || ""));

  // Build the quotation GROUP: scope + milestones + fees + own total, kept as
  // one coupled unit. Scope and milestones belong together per quotation.
  const group = _buildQuotationGroup(quotation, pj, value, who, nowIso);

  if (!existing) {
    // Create a fresh project shell from the quotation's key fields.
    const project = {
      id: projId,
      fromQuotationId: quotation.id || "",
      workflowStatus: "allocated",
      createdAt: nowIso,
      createdBy: who.name || "",
      folderPath: pj.folderPath || "",
      scopeFile: pj.scopeFile || null,
      subFile: pj.subFile || null,
      lpoFile: pj.lpoFile || null,
      project: {
        title: _combineFolderName(pj.folderPath, quotation.proj_name) || quotation.qtn_number || "Untitled Project",
        client: quotation.client_name || "",
        location: quotation.location || "",
        unit: "",
        coordinator: "",          // assigned later by super admin / coordinator
        unitType: Array.isArray(pj.unitType) ? pj.unitType.slice() : []
      },
      proposal: {
        quotationNumber: quotation.qtn_number || "",
        estimatedValue: value,
        category: category || quotation.category || "",
        submittedBy: quotation.createdBy || who.name || "",
        submittedAt: nowIso,
        scopeHtml: "", projectTypes: [], reapprovals: [], scopeItems: []
      },
      quotationGroups: [group],       // coupled scope+milestones per quotation
      stages: [],                      // approval stages (drawing prep/approval)
      lpos: [],                        // legacy flat (unused; milestones live in groups)
      clientToken: genClientToken(),    // secure public read-only link
      activityLog: [],
      proposalLog: [{ at: nowIso, by: who.name || "", action: "Project registered from awarded quotation", qtn: quotation.qtn_number || "" }]
    };
    const ok = await fbSet(path, project);
    if (ok && typeof logActivity === "function") {
      logActivity("Proposals", "Registered project (awarded)", quotation.proj_name || quotation.qtn_number || projId, "Sent to Coordinator + Account");
    }
    return ok;
  } else {
    // Project already exists. The Awarded Project Details block is now a live
    // view of THIS project (single source of truth), so proposal-side edits to
    // scope stages / LPO milestones are written back here. We merge rather than
    // blind-overwrite so coordinator/account-only fields (stage status, LPO
    // credited status, owner, invoice) are preserved.
    const patch = {};
    patch["proposal/quotationNumber"] = quotation.qtn_number || (existing.proposal && existing.proposal.quotationNumber) || "";
    patch["proposal/estimatedValue"]  = value;
    // Project title is STABLE once set. Only (re)compute it when we don't
    // already have one, so revision edits (R1/R2…) never rename the project.
    const existingTitle = (existing.project && existing.project.title) || "";
    if (!existingTitle) {
      const combinedTitle = _combineFolderName(pj.folderPath || existing.folderPath, quotation.proj_name);
      if (combinedTitle) patch["project/title"] = combinedTitle;
    }
    if (!(existing.project && existing.project.client)) patch["project/client"] = quotation.client_name || "";
    patch["project/unitType"] = Array.isArray(pj.unitType) ? pj.unitType.slice() : [];

    // ── Merge scope stages ──
    // Keep non-awarded_scope stages untouched; rebuild the awarded_scope set
    // from the Awarded block, preserving each existing stage's status by name.
    const existingStages = Array.isArray(existing.stages) ? existing.stages : [];
    const statusByName = {};
    existingStages.filter(s => s.type === "awarded_scope").forEach(s => { statusByName[(s.name||"").trim().toLowerCase()] = s; });

    // ── Upsert this quotation's GROUP ──
    // Find the group for this quotation (by quotationId, or quotationNo as
    // a fallback); update it in place (preserving milestone status/credit/
    // owner), or add a new group (revision). Both checks require a truthy
    // value on BOTH sides before comparing — without that guard, a group
    // with an empty/missing quotationId could wrongly match a submission
    // whose id also wasn't set yet, silently overwriting an unrelated
    // group's milestones with a different quotation's data.
    const groups = Array.isArray(existing.quotationGroups) ? existing.quotationGroups.slice() : [];
    const qId = quotation.id || "";
    const gi = groups.findIndex(g =>
      (g.quotationId && qId && g.quotationId === qId) ||
      (g.quotationNo && quotation.qtn_number && g.quotationNo === quotation.qtn_number)
    );
    const fresh = _buildQuotationGroup(quotation, pj, value, who, nowIso);
    if (gi >= 0) {
      // Preserve coordinator/account fields on milestones matched by name —
      // this now includes the Government Fees Invoice row too, since it's
      // auto-regenerated by _buildQuotationGroup on every resubmission with
      // a fresh estimate, but Coordinator's entered actual amount/remarks/
      // status must carry forward. Completed Scope Payment is different —
      // it's purely manual/ad-hoc (Proposals never sources or rebuilds it),
      // so it's carried forward wholesale instead of name-matched.
      const prevMs = {};
      const prevSpecialRows = [];
      (groups[gi].milestones || []).forEach(m => {
        if (m.isCompletedScopePayment) prevSpecialRows.push(m);
        else prevMs[(m.name||"").trim().toLowerCase()] = m;
      });
      fresh.id = groups[gi].id;
      fresh.milestones = fresh.milestones.map(m => {
        const prev = prevMs[(m.name||"").trim().toLowerCase()];
        return prev ? Object.assign({}, m, {
          stageStatus: prev.stageStatus || m.stageStatus,
          status: prev.status || m.status,
          owner: prev.owner || "", invoiceNo: prev.invoiceNo || "",
          creditedDate: prev.creditedDate || "", paymentRef: prev.paymentRef || "",
          // actualAmount/remarks only exist on the Govt Fees row — harmless
          // no-op for regular milestones (prev.actualAmount is undefined).
          actualAmount: prev.actualAmount != null ? prev.actualAmount : m.actualAmount,
          remarks: prev.remarks || m.remarks
        }) : m;
      }).concat(prevSpecialRows);
      groups[gi] = fresh;
    } else {
      groups.push(fresh);   // new quotation (e.g. approved revision) = new group
    }

    try {
      for (const k in patch) { await fbSet(coPath("projects/" + projId + "/" + k), patch[k]); }
      await fbSet(coPath("projects/" + projId + "/quotationGroups"), groups);
      if (pj.folderPath) await fbSet(coPath("projects/" + projId + "/folderPath"), pj.folderPath);
    } catch (e) {}
    return true;
  }
}
