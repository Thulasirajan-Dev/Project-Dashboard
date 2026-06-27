// ============================================================
//  Winner Holistic Consultants – Shared Utilities
//  shared/shared.js — Common to all modules
// ============================================================

// ── Firebase helpers ─────────────────────────────────────────
const DB = FIREBASE_URL.replace(/\/$/, "");

// ── Firebase REST helpers with a tiny in-memory read cache ──────
// The cache cuts redundant downloads of large collections when the
// user navigates between tabs/pages within a session. Short TTL keeps
// data fresh; any write to a path invalidates its cached copy.
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

async function fbGet(path, opts) {
  const noCache = opts && opts.fresh;
  if (!noCache) {
    const hit = _fbCache.get(path);
    if (hit && (Date.now() - hit.t) < _FB_TTL) return hit.v;
  }
  try {
    const r = await fetch(`${DB}/${path}.json`);
    const v = r.ok ? await r.json() : null;
    _fbCache.set(path, { t: Date.now(), v });
    return v;
  } catch (e) { return null; }
}
async function fbSet(path, data) {
  try {
    const r = await fetch(`${DB}/${path}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    _fbInvalidate(path);
    return r.ok;
  } catch (e) { return false; }
}
async function fbDelete(path) {
  try {
    const r = await fetch(`${DB}/${path}.json`, { method: "DELETE" });
    _fbInvalidate(path);
    return r.ok;
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
  return { name: u.name || "Unknown", role: u.role || "", id: u.id || "" };
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
async function logActivity(module, action, target, detail) {
  try {
    const who = currentActor();
    const entry = {
      at: new Date().toISOString(),
      module: module || "",
      action: action || "",
      target: target || "",
      detail: detail || "",
      by: who.name, role: who.role
    };
    const key = "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    await fbSet(`activity_log/${key}`, entry);
  } catch (e) { /* logging must never break the main action */ }
}

// Fetch recent activity entries (newest first), optionally filtered by module.
async function getActivityLog(moduleFilter, limit) {
  // Server-side limit: download only the most recent `limit` entries instead
  // of the entire activity_log. Keys are time-ordered ("log_<timestamp>_..."),
  // so orderBy="$key" + limitToLast gives the newest rows. This is the main
  // bandwidth saver as the log grows.
  const n = limit || 300;
  let all = null;
  try {
    const url = `${DB}/activity_log.json?orderBy=%22%24key%22&limitToLast=${n}`;
    const r = await fetch(url);
    if (r.ok) all = await r.json();
  } catch (e) { all = null; }
  // Fallback (e.g. if indexing not enabled): plain fetch.
  if (all === null) all = await fbGet("activity_log");
  let rows = Object.values(all || {});
  if (moduleFilter) rows = rows.filter(r => r.module === moduleFilter);
  rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return limit ? rows.slice(0, limit) : rows;
}


// ── Auth helpers ──────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(sessionStorage.getItem("whc_user") || "null"); } catch { return null; }
}
function setSession(user) {
  sessionStorage.setItem("whc_user", JSON.stringify(user));
}
function clearSession() {
  sessionStorage.removeItem("whc_user");
  sessionStorage.removeItem("whc_company");
}

// ============================================================
//  Companies — chosen at login, scopes data + numbering.
//  WHC keeps the original (un-prefixed) data paths so existing
//  data is untouched. The two new companies use their own prefix.
// ============================================================
const COMPANIES = [
  { id:"whc",  name:"Winner Holistic Consultant",   short:"WHC",  prefix:"",       accent:"#f0653e" },
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
async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(pin)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function loginWithPin(nameOrEmail, pin) {
  const users = await fbGet("users") || {};
  const hashed = await hashPin(pin);
  const match = Object.values(users).find(u =>
    u.active !== false &&
    (u.name?.toLowerCase() === nameOrEmail.toLowerCase() ||
     u.email?.toLowerCase() === nameOrEmail.toLowerCase()) &&
    u.pin === hashed
  );
  if (match) { setSession(match); return match; }
  return null;
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
function projectLink(id) { return window.location.origin + window.location.pathname + "?id=" + id; }

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
    creditedDate: "",
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
  { key:"coordinator", url:"/coordinator/", icon:"📋", label:"Coordinator", roles:["coordinator","super_admin"] },
  { key:"account",     url:"/account/",     icon:"⚙️", label:"Account",     roles:["super_admin","account"] },
  { key:"payments",    url:"/payments/",    icon:"💳", label:"LPO Status",  roles:["super_admin","account"] },
  { key:"summary",     url:"/summary/",     icon:"📊", label:"Summary",     roles:["super_admin"] },
];

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
      <button class="sb-logout" onclick="clearSession();window.location.href='/auth/'">Logout</button>
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
  if (document.getElementById("whc-view-toggle")) { applyViewMode(); return; }
  const btn = document.createElement("button");
  btn.id = "whc-view-toggle";
  btn.className = "whc-view-toggle";
  btn.onclick = toggleViewMode;
  document.body.appendChild(btn);
  applyViewMode();
  // Keep auto-detection responsive to rotation/resize (only when no explicit choice).
  window.addEventListener("resize", () => {
    let stored=null; try{ stored=localStorage.getItem("whc_view_mode"); }catch(e){}
    if (stored !== "mobile" && stored !== "desktop") applyViewMode();
  });
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
const ATTACH_ENDPOINT = "/.netlify/functions/onedrive-upload";
const ATTACH_MAX = 4 * 1024 * 1024;
const ATTACH_TYPES = ["pdf","png","jpg","jpeg","gif","webp","heic","bmp","tif","tiff"];

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
  if (isImg && att.thumb) {
    return `<a href="${esc(att.url)}" target="_blank" rel="noopener" class="att-thumb-wrap" title="Open full image">
      <img src="${att.thumb}" class="att-thumb${big?" att-thumb-lg":""}" alt="${esc(att.name||"attachment")}"/>
      <span class="att-thumb-cap">🖼 ${esc(att.name||"Image")} ${sizeTxt?`· ${sizeTxt}`:""}</span>
    </a>`;
  }
  if (isPdf) {
    return `<a href="${esc(att.url)}" target="_blank" rel="noopener" class="att-pdf-card" title="Open PDF">
      <span class="att-pdf-ico">📄</span>
      <span class="att-pdf-info"><span class="att-pdf-name">${esc(att.name||"Document.pdf")}</span>
        <span class="att-pdf-sub">PDF${sizeTxt?` · ${sizeTxt}`:""} · tap to open</span></span>
    </a>`;
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
