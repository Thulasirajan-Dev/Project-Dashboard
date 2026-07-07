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
const DATA_API = "/api/data.php";

// In-memory read cache (unchanged behaviour): cuts redundant reads
// of large collections when navigating between tabs within a session.
const _fbCache = new Map();          // path -> { t: timestamp, v: value }
const _FB_TTL = 15000;               // 15s; tune as needed

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
let WHC_OPTIONS = {};
const _OPTION_DEFAULTS = {
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
let WHC_USERS = [];
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
function actorId() {
  const u = getSession() || {};
  return u.email || u.name || "";
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
    const key = "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    await fbSet(`activity_log/${key}`, entry);
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

// Fetch recent activity entries (newest first), optionally filtered by module.
async function getActivityLog(moduleFilter, limit, projectId) {
  // The data API returns activity_log time-ordered (oldest→newest).
  // We fetch and take the most recent `limit` rows client-side. For very
  // large logs you can add a server-side limit param later; the periodic
  // prune (see admin tools) keeps this collection small in practice.
  const n = limit || 300;
  const all = await fbGet("activity_log", { fresh: true });
  let rows = Object.values(all || {});
  if (projectId) rows = rows.filter(r => r.projectId === projectId);
  if (moduleFilter && moduleFilter !== "all") rows = rows.filter(r => r.module === moduleFilter);
  rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return rows.slice(0, n);
}


// ── Auth helpers ──────────────────────────────────────────────
// ── Idle session timeout ──────────────────────────────────────
//  120-minute IDLE timeout: the clock resets on user activity.
//  A warning appears ~2 minutes before auto-logout. All client-side
//  (no server calls, no bandwidth cost).
const SESSION_IDLE_MS   = 120 * 60 * 1000;   // 120 minutes
const SESSION_WARN_MS   = 2   * 60 * 1000;   // warn 2 min before logout
const SESSION_TS_KEY    = "whc_last_activity";

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
let _sessionWarnShown = false;
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
const COMPANIES = [
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
async function loginWithPin(nameOrEmail, pin) {
  // Server verifies the PIN against MySQL and starts a session cookie.
  // The browser never downloads other users' hashes.
  try {
    const res = await fetch("/api/auth.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "login", name: nameOrEmail, pin })
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
function makeUserId() { return "u" + Date.now() + "_" + Math.random().toString(36).substr(2, 5); }

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
function makeId() { return "p" + Date.now() + "_" + Math.random().toString(36).substr(2, 6); }
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
const PROJECT_TYPES_NEW = ["Retail", "Office", "Industrial", "Residential", "Educational", "Entertainment", "Agricultural", "Other"];
const FOLDER_CATEGORIES = ["Fitout Folder", "Live Folder", "ID Folder", "Private Folder"];

const STATUS_DISPLAY = {
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

const STAGE_OPTIONS = {
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
function projStatus(p) {
  if (p.workflowStatus === "proposal") return "proposal";
  if (p.workflowStatus === "allocated") return "allocated";
  const pc = projPct(p); if (pc === 100) return "done";
  const act = ["under-review", "under-review-meps", "under-review-portal", "submitted", "submitted-meps", "under-preparation", "sent-client-review", "work-in-progress", "inspection-scheduled", "authority-progress"];
  if (pc > 0 || (p.stages || []).some(s => act.includes(s.status))) return "active";
  return "new";
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
function newProj(title) {
  return {
    id: makeId(),
    createdAt: new Date().toISOString().split("T")[0],
    workflowStatus: "proposal",
    activityLog: [], proposalLog: [],
    proposal: { scopeHtml: "", scopeItems: [], estimatedValue: "", expectedStartDate: "", submittedBy: "", submittedAt: "", quotationNumber: "", projectTypes: [], reapprovals: [] },
    project: { title: title || "New Project", client: "", location: "", unit: "", unitType: [], coordinator: "", consultant: "Winner Holistic Consultants" },
    stages: blankStages(), docs: blankDocs()
  };
}
function migrateProject(p) {
  if (!p) return p;
  if (!p.workflowStatus) p.workflowStatus = "allocated";
  if (!p.activityLog) p.activityLog = [];
  if (!p.proposalLog) p.proposalLog = [];
  if (!Array.isArray(p.lpos)) p.lpos = [];   // LPO / milestone payment records
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
  return p;
}

// ── Scope / quotation helpers ─────────────────────────────────
const SCOPE_TEMPLATES = {
  "fnb_kitchen": {
    label: "F&B with Kitchen Ventilation",
    items: [
      { ref: "B.1", title: "ADM Submission Package & Fire/Life Safety Strategy", details: "Preparation of ADM Submission Package including Key Plan, Partition Layout & Section based on Final Architectural Drawings (CAD Files). Preparation of Fire and Life Safety Strategy Layout. Submission to ADM/ADCD and obtain approval.", value: 11000 },
      { ref: "B.2", title: "Fire Protection System Shop Drawings approval from ADCD", details: "Receipt of Fire Protection (Fire Fighting, Fire Alarm, Emergency, Exit & Fire Suppression System) shop drawings from the Fire Contractor. Completeness check, submission to ADCD, follow-up and obtain approval.", value: 5000 },
      { ref: "B.3", title: "Kitchen Ventilation System Design Drawings for ADCD Approval", details: "Collection of complete set of Kitchen Ventilation System Drawings & Design Calculation Notes from the Specialist Contractor. Compilation and submission to ADCD for approval.", value: 5000 },
      { ref: "B.4", title: "Completion Certificate from ADCD", details: "Coordination with Main Contractor & Fire Contractor, collect and compile documents, apply for site inspection and obtain the completion certificate.", value: 500 },
      { ref: "B.5", title: "Completion Certificate from ADM", details: "Coordination with Main Contractor & Fire Contractor, collect and compile documents, apply for site inspection and obtain the completion certificate.", value: 500 },
      { ref: "B.6", title: "Scope of the Local Civil Contractor", details: "Pull out the Modification Building Permit from ADM after completion of approval (item B.1). Provide letters, certificates & shop drawing approvals/completion certificates from ADM/ADCD.", value: 3000 }
    ]
  },
  "retail": {
    label: "Retail (basic)",
    items: [
      { ref: "A.1", title: "Project Registration in MePS", details: "Registration of project in MePS portal, submission of required letters and documents.", value: 3000 },
      { ref: "A.2", title: "Architectural Drawing Approval (ADM & CD-FLS)", details: "Preparation and submission of partition layout, furniture layout, sections and material details.", value: 8000 },
      { ref: "A.3", title: "TAQA Drawing Approval", details: "Preparation and submission of electrical drawings, SLD and load schedule for TAQA approval.", value: 6000 }
    ]
  }
};
function blankScopeItem() { return { ref: "", title: "New scope item", details: "", value: 0 }; }
function scopeSubtotal(items) { return (items || []).reduce((s, i) => s + (Number(i.value) || 0), 0); }
function scopeVat(items) { return scopeSubtotal(items) * 0.05; }
function scopeTotal(items) { return scopeSubtotal(items) + scopeVat(items); }

// ── Rich text editor helpers ──────────────────────────────────
function rteToolbar(targetId) {
  return `<div class="rte-toolbar">
    <select class="rte-select" onchange="document.execCommand('formatBlock',false,this.value);this.value='p';document.getElementById('${targetId}').focus()">
      <option value="p">Paragraph</option><option value="h2">Heading 1</option>
      <option value="h3">Heading 2</option><option value="h4">Heading 3</option>
    </select>
    <select class="rte-select" onchange="document.execCommand('fontSize',false,this.value);document.getElementById('${targetId}').focus()">
      <option value="">Font Size</option><option value="1">Small</option><option value="3">Normal</option>
      <option value="4">Large</option><option value="5">X-Large</option>
    </select>
    <div class="rte-sep"></div>
    <button class="rte-btn" title="Bold" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
    <button class="rte-btn" title="Italic" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
    <button class="rte-btn" title="Underline" onmousedown="event.preventDefault();document.execCommand('underline')"><u>U</u></button>
    <div class="rte-sep"></div>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')">• List</button>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')">1. List</button>
    <div class="rte-sep"></div>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('indent')">→</button>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('outdent')">←</button>
    <div class="rte-sep"></div>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('justifyLeft')">≡L</button>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('justifyCenter')">≡C</button>
    <button class="rte-btn" onmousedown="event.preventDefault();document.execCommand('justifyRight')">≡R</button>
    <div class="rte-sep"></div>
    <button class="rte-btn" title="Insert Table" onmousedown="event.preventDefault();insertRteTable('${targetId}')">⊞ Table</button>
  </div>
  <div class="rte-editor" id="${targetId}" contenteditable="true" placeholder="Enter scope of work..."></div>`;
}
function insertRteTable(targetId) {
  const rows = parseInt(prompt("Number of rows:", 3) || 3);
  const cols = parseInt(prompt("Number of columns:", 3) || 3);
  if (!rows || !cols) return;
  let table = "<table>";
  table += "<tr>" + Array(cols).fill("<th>Header</th>").join("") + "</tr>";
  for (let r = 1; r < rows; r++) table += "<tr>" + Array(cols).fill("<td>Cell</td>").join("") + "</tr>";
  table += "</table><p></p>";
  document.getElementById(targetId)?.focus();
  document.execCommand("insertHTML", false, table);
}
function rteInit(id, html) {
  setTimeout(() => { const el = document.getElementById(id); if (el && html !== undefined) el.innerHTML = html || ""; }, 60);
}

// ── Scope item UI ─────────────────────────────────────────────
function scopeTotalsBlock(items) {
  return `<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px;font-size:12px">
    <div style="display:flex;justify-content:space-between;padding:2px 0;color:#666"><span>Sub-Total</span><span>AED ${fmtMoney(scopeSubtotal(items))}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;color:#666"><span>VAT (5%)</span><span>AED ${fmtMoney(scopeVat(items))}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700;color:#222"><span>Total incl. VAT</span><span>AED ${fmtMoney(scopeTotal(items))}</span></div>
  </div>`;
}

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
          <div class="actlog-sub">Who created and edited records · Super Admin view</div>
        </div>
        <button class="actlog-close" onclick="closeActivityLog()">✕</button>
      </div>
      <div class="actlog-filters">
        <select id="actlog-module" class="actlog-sel" onchange="renderActivityRows()">
          <option value="all">All Modules</option>
          <option value="Proposals">Proposals</option>
          <option value="Coordinator">Coordinator</option>
          <option value="Account">Account</option>
          <option value="Users">Users</option>
        </select>
        <input id="actlog-search" class="actlog-search" placeholder="Search name, action, target..."
          oninput="renderActivityRows()"/>
        <button class="actlog-refresh" onclick="reloadActivityLog()">↻</button>
        ${(getSession()&&getSession().role==="super_admin")?`
        <select class="actlog-clear" onchange="clearActivityLog(this.value); this.selectedIndex=0;" title="Clear activity log">
          <option value="">🗑 Clear…</option>
          <option value="30">Older than 30 days</option>
          <option value="90">Older than 90 days</option>
          <option value="180">Older than 6 months</option>
          <option value="365">Older than 1 year</option>
          <option value="all">Everything</option>
        </select>`:""}
      </div>
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

let _actlogRows = [];
async function reloadActivityLog() {
  const body = document.getElementById("actlog-body");
  if (body) body.innerHTML = `<div class="actlog-loading">Loading activity…</div>`;
  _actlogRows = await getActivityLog(null, 500);
  renderActivityRows();
}

// Clear activity log — SUPER ADMIN ONLY. mode = "all" or a number of days
// ("30" deletes entries older than 30 days). Always double-confirms.
async function clearActivityLog(mode) {
  if (!mode) return;
  const u = getSession();
  if (!u || u.role !== "super_admin") { alert("Only Super Admins can clear the activity log."); return; }

  const isAll = (mode === "all");
  const days = parseInt(mode, 10);
  const label = isAll ? "the ENTIRE activity log" : `all entries older than ${days} days`;

  if (!confirm(`Clear ${label}?\n\nThis permanently deletes those records and cannot be undone.`)) return;
  if (!confirm("Are you absolutely sure? This is your last chance to cancel.")) return;

  const body = document.getElementById("actlog-body");
  if (body) body.innerHTML = `<div class="actlog-loading">Clearing…</div>`;

  try {
    if (isAll) {
      const ok = await fbDelete("activity_log");
      if (!ok) throw new Error("delete failed");
      try { await logActivity("Users", "Cleared activity log (all)", "", u.name || ""); } catch (e) {}
    } else {
      // Fetch everything, find entries older than the cutoff, delete each.
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const all = await fbGet("activity_log", { fresh: true }) || {};
      const oldKeys = Object.keys(all).filter(k => {
        const at = all[k] && all[k].at ? Date.parse(all[k].at) : NaN;
        return !isNaN(at) && at < cutoff;
      });
      if (!oldKeys.length) {
        if (body) body.innerHTML = `<div class="actlog-empty">No entries older than ${days} days.</div>`;
        setTimeout(reloadActivityLog, 1200);
        return;
      }
      // Delete in batches to avoid hammering the connection.
      for (let i = 0; i < oldKeys.length; i += 25) {
        await Promise.all(oldKeys.slice(i, i + 25).map(k => fbDelete("activity_log/" + k)));
      }
      try { await logActivity("Users", `Cleared activity log (older than ${days}d)`, `${oldKeys.length} entries`, u.name || ""); } catch (e) {}
    }
    await reloadActivityLog();
  } catch (e) {
    if (body) body.innerHTML = `<div class="actlog-empty">Could not clear the log. Please try again.</div>`;
  }
}

function renderActivityRows() {
  const body = document.getElementById("actlog-body");
  if (!body) return;
  const mod = (document.getElementById("actlog-module")||{}).value || "all";
  const q = ((document.getElementById("actlog-search")||{}).value || "").toLowerCase().trim();
  const moduleColors = { Proposals:"#9b59b6", Coordinator:"#27ae60", Account:"#5b8dee", Users:"#e8a060" };

  let rows = _actlogRows.slice();
  if (mod !== "all") rows = rows.filter(r => r.module === mod);
  if (q) rows = rows.filter(r =>
    (r.by||"").toLowerCase().includes(q) ||
    (r.action||"").toLowerCase().includes(q) ||
    (r.target||"").toLowerCase().includes(q) ||
    (r.module||"").toLowerCase().includes(q)
  );

  if (!rows.length) {
    body.innerHTML = `<div class="actlog-empty">No activity matches.</div>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const col = moduleColors[r.module] || "#888";
    const isEdit = /edit/i.test(r.action);
    return `<div class="actlog-row">
      <div class="actlog-dot" style="background:${col}"></div>
      <div class="actlog-main">
        <div class="actlog-line">
          <b>${escAL(r.action||"")}</b>${r.target?` — ${escAL(r.target)}`:""}
          ${isEdit?`<span class="actlog-tag actlog-tag-edit">edited</span>`:""}
        </div>
        <div class="actlog-meta">
          <span class="actlog-modpill" style="background:${col}22;color:${col}">${escAL(r.module||"")}</span>
          by <b>${escAL(r.by||"—")}</b>${r.role?` (${escAL(r.role)})`:""}
          ${r.detail?` · ${escAL(r.detail)}`:""}
        </div>
      </div>
      <div class="actlog-time">${fmtDateTime(r.at)}</div>
    </div>`;
  }).join("");
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
  .actlog-panel{position:relative;width:min(680px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#2e3560;border:1px solid #474f86;border-radius:16px;box-shadow:0 24px 60px rgba(10,8,30,0.6);overflow:hidden}
  .actlog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px;background:linear-gradient(135deg,#272c54,#3a4275);border-bottom:1px solid #474f86}
  .actlog-title{font-size:17px;font-weight:700;color:#fff}
  .actlog-sub{font-size:11px;color:#b9c0e6;margin-top:2px}
  .actlog-close{background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:8px;width:30px;height:30px;font-size:14px;cursor:pointer}
  .actlog-close:hover{background:rgba(255,255,255,0.22)}
  .actlog-filters{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #474f86;background:#272c54}
  .actlog-sel,.actlog-search{background:#3a4275;color:#eef0fb;border:1px solid #474f86;border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit}
  .actlog-search{flex:1}
  .actlog-sel:focus,.actlog-search:focus{outline:none;border-color:#e3c468}
  .actlog-refresh{background:#e3c468;color:#272c54;border:none;border-radius:8px;width:36px;font-size:14px;font-weight:700;cursor:pointer}
  .actlog-body{overflow-y:auto;padding:6px 10px 14px}
  .actlog-loading,.actlog-empty{padding:40px;text-align:center;color:#8b93c4;font-size:13px}
  .actlog-row{display:flex;gap:11px;align-items:flex-start;padding:11px 10px;border-bottom:1px solid #3a4275}
  .actlog-row:last-child{border-bottom:none}
  .actlog-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;flex-shrink:0}
  .actlog-main{flex:1;min-width:0}
  .actlog-line{font-size:13px;color:#eef0fb}
  .actlog-meta{font-size:11px;color:#b9c0e6;margin-top:3px}
  .actlog-modpill{padding:1px 7px;border-radius:7px;font-weight:600;margin-right:3px}
  .actlog-tag{font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:6px;vertical-align:middle}
  .actlog-tag-edit{background:#3a4275;color:#e3c468}
  .actlog-time{font-size:10.5px;color:#8b93c4;white-space:nowrap;flex-shrink:0;margin-top:2px}
  `;
  document.head.appendChild(css);
}


// ── Lightweight project diff for the global activity log ──────
// Projects are nested; this reports which top-level sections changed
// plus the stage count delta, e.g. "Changed: project details, stages (+2)".
function diffProjectSummary(prev, next) {
  if (!prev) return "";
  const parts = [];
  try {
    if (JSON.stringify(prev.project||{}) !== JSON.stringify(next.project||{})) parts.push("project details");
    const ps = (prev.stages||[]).length, ns = (next.stages||[]).length;
    if (JSON.stringify(prev.stages||[]) !== JSON.stringify(next.stages||[])) {
      const delta = ns - ps;
      parts.push("stages" + (delta!==0 ? ` (${delta>0?"+":""}${delta})` : ""));
    }
    if (JSON.stringify(prev.milestones||{}) !== JSON.stringify(next.milestones||{})) parts.push("milestones");
    if ((prev.coordinator||"") !== (next.coordinator||"")) parts.push("coordinator assignment");
  } catch(e) {}
  return parts.length ? "Changed: " + parts.join(", ") : "Minor update";
}

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
//  A project carries p.lpos = [ {lpo}, ... ]. Each LPO:
//    { id, name, amount, dateRaised, raisedBy, raisedByRole,
//      invoiceNo, status:"pending"|"credited", creditedDate,
//      paymentRef, createdAt }
//  Project value = sum of all LPO amounts ("raised over time").
// ============================================================
function blankLPO(seedName) {
  const who = (typeof currentActor === "function") ? currentActor() : { name:"", role:"" };
  return {
    id: "lpo_" + Date.now() + "_" + Math.random().toString(36).slice(2,6),
    name: seedName || "",
    amount: 0,
    dateRaised: new Date().toISOString().slice(0,10),
    raisedBy: who.name || "",
    raisedByRole: who.role || "",
    invoiceNo: "",
    status: "pending",
    owner: "",                 // account user responsible for crediting
    creditedDate: "",
    creditedBy: "",
    paymentRef: "",
    createdAt: new Date().toISOString()
  };
}

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

function fmtAED(n) {
  const v = Number(n) || 0;
  return "AED " + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============================================================
//  Shared sidebar (Creative-Tim style, orange gradient)
//  Injected by each module via mountSidebar(active). Nav items are
//  role-filtered. Content (#app) is shifted right via CSS (.has-sidebar).
// ============================================================
const SIDEBAR_ITEMS = [
  { key:"proposals",   url:"/proposals/",   icon:"📝", label:"Proposals",   roles:["proposals","super_admin"] },
  { key:"coordinator", url:"/coordinator/", icon:"📋", label:"Coordinator", roles:["coordinator","super_admin","proposals"] },
  { key:"account",     url:"/account/",     icon:"⚙️", label:"Account",     roles:["super_admin","account"] },
  { key:"payments",    url:"/payments/",    icon:"📊", label:"Milestone Dashboard",  roles:["super_admin","account","proposals","coordinator"] },
  { key:"summary",     url:"/summary/",     icon:"📊", label:"Summary",     roles:["super_admin","proposals","account"] },
];

// Roles that may only VIEW (not edit) a given module. Used by the
// pages to render in read-only mode. Super admin is never restricted.
const VIEW_ONLY_ROLES = {
  summary:     ["proposals", "account"],                   // Overall Summary: view only
  payments:    ["proposals", "coordinator", "account"],    // LPO Summary: view only
  coordinator: ["proposals"],                              // Proposal sees Coordinator read-only
};
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

function mountSidebar(activeKey) {
  if (document.getElementById("whc-sidebar")) return; // once
  const u = getSession() || {};
  const role = u.role || "";
  const items = SIDEBAR_ITEMS.filter(it => it.roles.includes(role));

  const nav = items.map(it => `
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
function setViewMode(mode) {
  try { localStorage.setItem("whc_view_mode", mode); } catch(e){}
  applyViewMode(mode);
  // Re-render if the module exposes render()/renderSummaryPage() etc.
  if (typeof render === "function") { try { render(); } catch(e){} }
}
function toggleViewMode() {
  const now = document.body.classList.contains("mobile-view") ? "mobile" : "desktop";
  setViewMode(now === "mobile" ? "desktop" : "mobile");
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
const ATTACH_ENDPOINT = "/api/onedrive-upload.php";
const ATTACH_MAX = 4 * 1024 * 1024;
const ATTACH_TYPES = ["pdf","png","jpg","jpeg","gif","webp","heic","bmp","tif","tiff"];
// Turn this ON after the Azure + Netlify OneDrive setup is done.
// While false, the upload box shows a "coming soon" note instead of erroring.
const ATTACH_ENABLED = false;

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
const _CATEGORY_PATH = {
  "Fitout Folder": "quotations/fitout",
  "Live Folder":   "quotations/live",
  "ID Folder":     "quotations/id",
  "Private Folder":"quotations/private"
};
// Numbering config (mirrors QTN_CONFIG in proposals-quotation.js) so the
// coordinator page can mint the next number without loading that file.
const _QTN_NUM_CONFIG = {
  "Fitout Folder": { pattern: (s,y)=>`${s}-${y}`,        counterKey:"qtn_counter/fitout",  startSeq:1709 },
  "Live Folder":   { pattern: (s,y)=>`W-L-${s}-${y}-R0`, counterKey:"qtn_counter/live",    startSeq:747 },
  "ID Folder":     { pattern: (s,y)=>`W-ID-${s}-${y}`,   counterKey:"qtn_counter/id",      startSeq:108 },
  "Private Folder":{ pattern: (s,y)=>`W-P-${s}-${y}`,    counterKey:"qtn_counter/private", startSeq:316 }
};
async function _nextQtnNumber(category) {
  const cfg = _QTN_NUM_CONFIG[category] || _QTN_NUM_CONFIG["Fitout Folder"];
  const yr = String(new Date().getFullYear()).slice(-2);
  const counter = await fbGet(coPath(cfg.counterKey));
  const seq = counter ? (counter.seq || cfg.startSeq) : cfg.startSeq;
  await fbSet(coPath(cfg.counterKey), { seq: seq + 1, updatedAt: new Date().toISOString() });
  return cfg.pattern(seq, yr);
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
      createdAt: new Date().toISOString()
    };
    await fbSet(coPath(path + "/" + id), rec);
    return qtnNo;
  } catch (e) { return ""; }
}

// ============================================================
// Build one quotation group: its scope[], milestones[], fees, and own total.
// Scope and milestones are a coupled set belonging to this quotation.
function _buildQuotationGroup(quotation, pj, value, who, nowIso) {
  const scope = (pj.scope || []).map(s => ({
    name: s.name || "", value: Number(s.value) || 0,
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
  const subtotal = scope.reduce((a, s) => a + (s.value || 0), 0);
  const vat = Math.round(subtotal * 0.05);
  const govtTotal = govtFees.reduce((a, g) => a + (g.amount || 0), 0);
  const subTotalFees = subFees.reduce((a, s) => a + (s.amount || 0), 0);
  const contractTotal = subtotal + vat + subTotalFees + govtTotal;
  const milestones = (pj.lpo || []).map((m, idx) => ({
    id: "ms_" + (quotation.id || "q") + "_" + idx,
    name: m.name || ("Milestone " + (idx + 1)),
    pct: Number(m.pct) || 0,
    amount: Number(m.value) || Math.round(contractTotal * (Number(m.pct) || 0) / 100),
    stageStatus: "Not started",     // Not started / In progress / Done
    status: "pending",              // pending / credited (Account)
    owner: "", invoiceNo: "", creditedDate: "", paymentRef: "",
    createdAt: nowIso
  }));
  return {
    id: "grp_" + (quotation.id || Date.now()),
    quotationNo: quotation.qtn_number || "",
    quotationId: quotation.id || "",
    isRevision: !!quotation.is_revision,
    parentQuotation: quotation.parent_quotation || "",
    scope, govtFees, subFees, milestones,
    scopeFrozen: pj.scopeFrozen || 0,
    subtotal, vat, govtTotal, subTotal: subTotalFees, contractTotal,
    scopeFile: pj.scopeFile || null,
    lpoFile: pj.lpoFile || null,
    createdAt: nowIso,
    createdBy: (who && who.name) || ""
  };
}

async function ensureProjectFromQuotation(quotation, category) {
  if (!quotation) return;
  // Awarded = Won AND LPO received. Both required before a project is created.
  const won = (quotation.open_status || "").toLowerCase() === "won";
  const lpoReceived = (quotation.lpo_received || "").toUpperCase() === "Y";
  if (!(won && lpoReceived)) return;

  const projId = "proj_" + (quotation.id || ("q_" + Date.now()));
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
      lpoFile: pj.lpoFile || null,
      project: {
        title: _combineFolderName(pj.folderPath, quotation.proj_name) || quotation.qtn_number || "Untitled Project",
        client: quotation.client_name || "",
        location: quotation.location || "",
        unit: "",
        coordinator: "",          // assigned later by super admin / coordinator
        unitType: []
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

    // ── Merge scope stages ──
    // Keep non-awarded_scope stages untouched; rebuild the awarded_scope set
    // from the Awarded block, preserving each existing stage's status by name.
    const existingStages = Array.isArray(existing.stages) ? existing.stages : [];
    const statusByName = {};
    existingStages.filter(s => s.type === "awarded_scope").forEach(s => { statusByName[(s.name||"").trim().toLowerCase()] = s; });

    // ── Upsert this quotation's GROUP ──
    // Find the group for this quotation (by quotationId); update it in place
    // (preserving milestone status/credit/owner), or add a new group (revision).
    const groups = Array.isArray(existing.quotationGroups) ? existing.quotationGroups.slice() : [];
    const gi = groups.findIndex(g => g.quotationId === (quotation.id || "") || (g.quotationNo && g.quotationNo === quotation.qtn_number));
    const fresh = _buildQuotationGroup(quotation, pj, value, who, nowIso);
    if (gi >= 0) {
      // Preserve coordinator/account fields on milestones matched by name.
      const prevMs = {};
      (groups[gi].milestones || []).forEach(m => { prevMs[(m.name||"").trim().toLowerCase()] = m; });
      fresh.id = groups[gi].id;
      fresh.milestones = fresh.milestones.map(m => {
        const prev = prevMs[(m.name||"").trim().toLowerCase()];
        return prev ? Object.assign({}, m, {
          stageStatus: prev.stageStatus || m.stageStatus,
          status: prev.status || m.status,
          owner: prev.owner || "", invoiceNo: prev.invoiceNo || "",
          creditedDate: prev.creditedDate || "", paymentRef: prev.paymentRef || ""
        }) : m;
      });
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
