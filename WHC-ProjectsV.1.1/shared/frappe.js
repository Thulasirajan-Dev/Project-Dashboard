// ============================================================
//  Winner Holistic Consultants – Frappe Integration Helper
//  shared/frappe.js  ·  Depends on: shared.js loaded first
//  All calls go through /.netlify/functions/frappe (secure proxy)
// ============================================================

const FRAPPE_FN = "/.netlify/functions/frappe";

// ── Cache layer (session-scoped, avoids repeat calls) ─────────
const _frappeCache = {};
function _cacheKey(action, extra) { return action + JSON.stringify(extra || ""); }

// ── Core caller ───────────────────────────────────────────────
async function frappeCall(action, extra = {}) {
  const key = _cacheKey(action, extra);
  if (_frappeCache[key]) return _frappeCache[key];

  try {
    const res = await fetch(FRAPPE_FN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Frappe error");
    _frappeCache[key] = data;
    return data;
  } catch (err) {
    console.error("Frappe call failed:", action, err.message);
    return null;
  }
}

// ── Public helpers ────────────────────────────────────────────

// Returns array of { id, name, designation, department, email }
async function frappeEmployees() {
  const data = await frappeCall("employees");
  return (data?.data || []).map(e => ({
    id:          e.name,
    name:        e.employee_name,
    designation: e.designation || "",
    department:  e.department  || "",
    email:       e.user_id     || ""
  }));
}

// Returns array of { id, title, customer, status, startDate, endDate, pct }
async function frappeProjects() {
  const data = await frappeCall("projects");
  return (data?.data || []).map(p => ({
    id:        p.name,
    title:     p.project_name,
    customer:  p.customer       || "",
    status:    p.status         || "",
    startDate: p.expected_start_date || "",
    endDate:   p.expected_end_date   || "",
    pct:       p.percent_complete    || 0
  }));
}

// Returns single project detail by ERP project ID
async function frappeProjectDetail(erpId) {
  const data = await frappeCall("project_detail", { name: erpId });
  return data?.data || null;
}

// Returns array of upcoming leaves (next 60 days, approved)
// { employee, employeeName, leaveType, from, to, days }
async function frappeLeaves() {
  const data = await frappeCall("leaves");
  return (data?.data || []).map(l => ({
    employee:     l.employee,
    employeeName: l.employee_name,
    leaveType:    l.leave_type,
    from:         l.from_date,
    to:           l.to_date,
    days:         l.total_leave_days
  }));
}

// Returns attendance for a specific employee (last 30 days)
async function frappeAttendance(employeeId) {
  const today = new Date().toISOString().split("T")[0];
  const from  = new Date(Date.now() - 30*24*60*60*1000).toISOString().split("T")[0];
  const data  = await frappeCall("attendance", {
    filters: [
      ["employee", "=", employeeId],
      ["attendance_date", ">=", from],
      ["attendance_date", "<=", today]
    ]
  });
  return (data?.data || []).map(a => ({
    date:   a.attendance_date,
    status: a.status,
    hours:  a.working_hours || 0
  }));
}

// Returns array of customers { id, name, mobile, email }
async function frappeCustomers() {
  const data = await frappeCall("customers");
  return (data?.data || []).map(c => ({
    id:     c.name,
    name:   c.customer_name,
    mobile: c.mobile_no || "",
    email:  c.email_id  || ""
  }));
}

// ── UI helpers ────────────────────────────────────────────────

// Renders a <select> or <datalist> populated from Frappe employees
// Usage: document.getElementById("coord-wrap").innerHTML = frappeEmployeeSelect("qf-coordinator", selectedValue)
function frappeEmployeeSelect(fieldId, selected, employees) {
  const opts = employees.map(e =>
    `<option value="${esc(e.name)}" ${selected === e.name ? "selected" : ""}>
      ${esc(e.name)}${e.designation ? " — " + esc(e.designation) : ""}
    </option>`
  ).join("");
  return `<select class="fi" id="${fieldId}">
    <option value="">— Select Coordinator —</option>
    ${opts}
  </select>`;
}

// Renders leave badge for a coordinator name
// Returns HTML string like "🏖 On leave 15–18 Jun"
function frappeLeaveTag(coordName, leaves) {
  const today = new Date().toISOString().split("T")[0];
  const active = leaves.find(l =>
    l.employeeName === coordName && l.from <= today && l.to >= today
  );
  if (active) {
    return `<span class="status-chip" style="background:#fde8e8;color:#a32d2d">
      🏖 On leave · ${fmtDate(active.from)} – ${fmtDate(active.to)}
    </span>`;
  }
  const upcoming = leaves.find(l =>
    l.employeeName === coordName && l.from > today
  );
  if (upcoming) {
    return `<span class="status-chip" style="background:#fff8e6;color:#a06b00">
      📅 Leave from ${fmtDate(upcoming.from)}
    </span>`;
  }
  return "";
}

// ── ERP Project link panel (shown in coordinator editor) ──────
function renderErpLinkPanel(proj, erpProjects) {
  const linked = proj?.erpProjectId || "";
  const match  = erpProjects.find(p => p.id === linked);

  return `<div class="sbox" style="margin-top:12px">
    <div class="sbox-title" style="display:flex;align-items:center;gap:8px">
      <span>🔗 ERP Project Link</span>
      <span style="font-size:10px;background:#e8f0fe;color:#1a5276;padding:1px 8px;border-radius:8px">Frappe Cloud</span>
    </div>

    <div class="fgrid">
      <div style="grid-column:1/-1">
        <div class="fl">Link to ERP Project</div>
        <select class="fi" id="erp-project-sel"
          onchange="PROJ.erpProjectId=this.value;updateErpProjectPreview(this.value)">
          <option value="">— Not linked —</option>
          ${erpProjects.map(p => `
            <option value="${esc(p.id)}" ${linked === p.id ? "selected" : ""}>
              ${esc(p.title)}${p.customer ? " · " + esc(p.customer) : ""} [${esc(p.status)}]
            </option>`).join("")}
        </select>
      </div>
    </div>

    ${match ? `
    <div id="erp-project-preview" style="margin-top:10px;padding:10px 12px;background:#f7f8fc;border-radius:10px;font-size:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><div class="fl">ERP Project ID</div><div style="color:#1a5276;font-weight:600">${esc(match.id)}</div></div>
        <div><div class="fl">Customer</div><div>${esc(match.customer || "—")}</div></div>
        <div><div class="fl">Status</div><div><span class="status-chip chip-active">${esc(match.status)}</span></div></div>
        <div><div class="fl">Completion</div><div style="font-weight:600;color:#166a3f">${match.pct}%</div></div>
        <div><div class="fl">Start Date</div><div>${fmtDate(match.startDate) || "—"}</div></div>
        <div><div class="fl">End Date</div><div>${fmtDate(match.endDate) || "—"}</div></div>
      </div>
      <a href="https://erp.winnerhc.com/desk#Form/Project/${encodeURIComponent(match.id)}"
        target="_blank" style="display:inline-block;margin-top:8px;font-size:11px;color:#1a5276">
        Open in Frappe ERP →
      </a>
    </div>` : `<div id="erp-project-preview" style="font-size:12px;color:#aaa;margin-top:8px">No ERP project linked yet.</div>`}
  </div>`;
}

function updateErpProjectPreview(erpId) {
  if (!erpId || !window._erpProjects) {
    document.getElementById("erp-project-preview").innerHTML =
      `<div style="font-size:12px;color:#aaa;margin-top:8px">No ERP project linked yet.</div>`;
    return;
  }
  const match = window._erpProjects.find(p => p.id === erpId);
  if (!match) return;
  document.getElementById("erp-project-preview").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
      <div><div class="fl">ERP Project ID</div><div style="color:#1a5276;font-weight:600">${esc(match.id)}</div></div>
      <div><div class="fl">Customer</div><div>${esc(match.customer || "—")}</div></div>
      <div><div class="fl">Status</div><div><span class="status-chip chip-active">${esc(match.status)}</span></div></div>
      <div><div class="fl">Completion</div><div style="font-weight:600;color:#166a3f">${match.pct}%</div></div>
      <div><div class="fl">Start</div><div>${fmtDate(match.startDate) || "—"}</div></div>
      <div><div class="fl">End</div><div>${fmtDate(match.endDate) || "—"}</div></div>
    </div>
    <a href="https://erp.winnerhc.com/desk#Form/Project/${encodeURIComponent(match.id)}"
      target="_blank" style="display:inline-block;margin-top:8px;font-size:11px;color:#1a5276">
      Open in Frappe ERP →
    </a>`;
}

// ── Load all Frappe data upfront (call once on module boot) ───
async function loadFrappeData() {
  const [employees, projects, leaves] = await Promise.all([
    frappeEmployees(),
    frappeProjects(),
    frappeLeaves()
  ]);
  window._erpEmployees = employees;
  window._erpProjects  = projects;
  window._erpLeaves    = leaves;
  return { employees, projects, leaves };
}
