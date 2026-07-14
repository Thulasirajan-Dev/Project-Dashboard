// ============================================================
//  Winner Holistic Consultants – Auth / User Management
//  auth/auth.js  ·  Depends on: shared/shared.js
// ============================================================

var ROLES = [
  { value: "super_admin", label: "Super Admin",  desc: "Full access to all modules" },
  { value: "management",  label: "Management",   desc: "Views every module — read-only, no editing anywhere" },
  { value: "proposals",   label: "Proposals",    desc: "Create & manage quotations" },
  { value: "team_lead",   label: "Team Lead",    desc: "Sees all Coordinator projects (incl. unassigned) and assigns them" },
  { value: "coordinator", label: "Coordinator",  desc: "Sees only their own assigned projects" },
  { value: "account",     label: "Account",      desc: "Projects & milestone tracking" },
];

var ROLE_BADGE = {
  super_admin: "background:#faece7;color:#712b13",
  management:  "background:#f3ecfb;color:#5b2c86",
  proposals:   "background:#eeedfe;color:#3c3489",
  team_lead:   "background:#e7f1fd;color:#1a4e8a",
  coordinator: "background:#faeeda;color:#633806",
  account:     "background:#e0f0ea;color:#1c6b4a",
};

var ROLE_MODULE_URL = {
  super_admin: "/account/",
  management:  "/summary/",
  proposals:   "/proposals/",
  team_lead:   "/coordinator/",
  coordinator: "/coordinator/",
  account:     "/account/",
};

// What each role can access — shown on user cards so permissions are clear.
var ROLE_ACCESS = {
  super_admin: ["Proposals","Coordinator","Templates","Overall Summary","Team Performance","Account","Users"],
  management:  ["Proposals (view only)","Coordinator (view only)","Templates (view only)","Account (view only)","Milestone (view only)","Overall Summary (view only)","Team Performance (view only)"],
  proposals:   ["Proposals","Templates","Team Performance (view only)","Client links"],
  team_lead:   ["Coordinator (all projects + assign)","Templates","Team Performance (view only)","Client links"],
  coordinator: ["Coordinator (own projects only)","Templates","Client links"],
  account:     ["Account","Milestone","Team Performance (view only)"],
};

// ── State ─────────────────────────────────────────────────────
var AS = {
  tab: "users",          // users | add | edit | activity
  users: {},             // loaded from Firebase
  loading: true,
  saving: false,
  saved: false,
  err: "",
  editId: null,          // user being edited
  search: "",
  filterRole: "all",
  filterActive: "all",
  confirmId: null,       // for deactivate confirmation
  activityLog: [],
};

// ── Load all users ────────────────────────────────────────────
async function loadUsers() {
  document.body.classList.add("wide-content");
  AS.loading = true; renderAuth();
  AS.users = (await fbGet("users")) || {};
  AS.loading = false; renderAuth();
}

// ── Save activity log entry ───────────────────────────────────
// Mirrors into the central, structured activity_log table (module=Users) —
// see openActivityLog()/logActivity() in shared.js. There used to be a
// SEPARATE legacy mechanism here that stored the whole log as one JSON
// array blob under a single "auth_log" key; that's gone now — it was
// redundant with this mirror, and incompatible with the new indexed
// activity_log table structure besides.
async function logAuthActivity(action, targetName, detail) {
  if (typeof logActivity === "function") {
    await logActivity("Users", action, targetName, detail);
  }
}

// ── Add user ──────────────────────────────────────────────────
async function submitAddUser() {
  if (AS.saving) return;            // ignore rapid double-clicks
  const name  = document.getElementById("au-name")?.value.trim();
  const email = document.getElementById("au-email")?.value.trim();
  const role  = document.getElementById("au-role")?.value;
  const team  = document.getElementById("au-team")?.value || "";
  const pin   = document.getElementById("au-pin")?.value.trim();
  const pin2  = document.getElementById("au-pin2")?.value.trim();

  if (!name || !role || !pin) { AS.err = "Name, role and PIN are required."; renderAuth(); return; }
  // Email is mandatory — it's how this user gets mapped as an assignee
  // (Coordinator's project.coordinator, Account's milestone owner, etc.)
  // throughout the app.
  if (!email) { AS.err = "Email is required — it's used to map this user as an assignee."; renderAuth(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { AS.err = "Enter a valid email address."; renderAuth(); return; }
  if (pin !== pin2) { AS.err = "PINs do not match."; renderAuth(); return; }
  if (pin.length < 4) { AS.err = "PIN must be at least 4 characters."; renderAuth(); return; }

  AS.saving = true; AS.err = ""; renderAuth();

  // Only an authenticated Super Admin can create users (enforced server-side).
  const payload = { name, email, role, team, pin };

  const result = await serverSignup(payload);
  if (result && result.ok) {
    await logAuthActivity("User created", name, `Role: ${role}`);
    // Refresh the users list from the server for the admin view.
    try { AS.users = (await fbGet("users", { fresh: true })) || {}; } catch (e) {}
    AS.saving = false; AS.saved = true; AS.tab = "users"; AS.err = ""; renderAuth();
    setTimeout(() => { AS.saved = false; renderAuth(); }, 2500);
  } else {
    AS.saving = false;
    AS.err = (result && result.error) || "Failed to create user.";
    renderAuth();
  }
}

// ── Toggle active status ──────────────────────────────────────
async function toggleUserActive(id) {
  const user = AS.users[id]; if (!user) return;
  const session = getSession();
  if (user.role === "super_admin" && user.id === session?.id) {
    alert("You cannot deactivate your own account."); return;
  }
  const newActive = !user.active;
  const ok = await fbSet(`users/${id}/active`, newActive);
  if (ok) {
    AS.users[id].active = newActive;
    await logAuthActivity(newActive ? "User activated" : "User deactivated", user.name, "");
    AS.confirmId = null; renderAuth();
  }
}

// ── Reset PIN ─────────────────────────────────────────────────
async function resetPin(id) {
  const user = AS.users[id]; if (!user) return;
  const newPin = prompt(`Set new PIN for ${user.name} (min 4 characters):`);
  if (!newPin || newPin.trim().length < 4) { alert("PIN too short or cancelled."); return; }
  const hashed = await hashPin(newPin.trim());
  const ok = await fbSet(`users/${id}/pin`, hashed);
  if (ok) {
    AS.users[id].pin = hashed;
    await logAuthActivity("PIN reset", user.name, "");
    alert(`PIN updated for ${user.name}.`);
    renderAuth();
  } else {
    alert("Failed to update PIN.");
  }
}

// ── Change role ───────────────────────────────────────────────
async function changeRole(id, newRole) {
  const user = AS.users[id]; if (!user) return;
  const session = getSession();
  if (user.id === session?.id) { alert("You cannot change your own role."); return; }
  if (!confirm(`Change ${user.name}'s role to ${newRole}?`)) return;
  const ok = await fbSet(`users/${id}/role`, newRole);
  if (ok) {
    const oldRole = user.role;
    AS.users[id].role = newRole;
    await logAuthActivity("Role changed", user.name, `${oldRole} → ${newRole}`);
    renderAuth();
  }
}

// ── Change a user's team/group tag ──────────────────────────────
async function changeTeam(id, newTeam) {
  const user = AS.users[id]; if (!user) return;
  const ok = await fbSet(`users/${id}/team`, newTeam);
  if (ok) {
    const oldTeam = user.team || "";
    AS.users[id].team = newTeam;
    await logAuthActivity("Team changed", user.name, `${oldTeam || "—"} → ${newTeam || "—"}`);
    renderAuth();
  } else {
    alert("Could not save — if this is a fresh install, make sure the users table has the team column (see schema.sql).");
  }
}

// ── Delete user ───────────────────────────────────────────────
async function deleteUser(id) {
  const user = AS.users[id]; if (!user) return;
  const session = getSession();
  if (user.id === session?.id) { alert("You cannot delete your own account."); return; }
  if (!confirm(`Permanently delete user "${user.name}"? This cannot be undone.`)) return;
  const ok = await fbDelete(`users/${id}`);
  if (ok) {
    await logAuthActivity("User deleted", user.name, `Role was: ${user.role}`);
    delete AS.users[id];
    renderAuth();
  }
}

// ── Copy module link for user ─────────────────────────────────
function copyModuleLink(role) {
  const base = window.location.origin;
  const url = base + (ROLE_MODULE_URL[role] || "/");
  navigator.clipboard.writeText(url).then(() => alert("Link copied!\n\n" + url))
    .catch(() => prompt("Copy this link:", url));
}

// ── Master render ─────────────────────────────────────────────
function renderAuth() {
  const root = document.getElementById("app");
  if (!root) return;
  const session = getSession();
  let h = renderAuthHeader(session);

  // Show a notice if the user was just signed out for inactivity.
  try {
    if (new URLSearchParams(window.location.search).get("timeout") === "1") {
      h += `<div class="auth-error" style="background:#fff4e5;border-color:#ffd9a0;color:#a06b00">
        ⏳ You were signed out after 120 minutes of inactivity. Please sign in again.
      </div>`;
    }
  } catch (e) {}

  if (AS.loading) {
    h += `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">Loading users...</div></div>`;
    root.innerHTML = h; return;
  }

  h += `<div class="auth-tabs">
    <div class="auth-tab ${AS.tab==="users"?"on":""}"  onclick="AS.tab='users';AS.err='';renderAuth()">All Users</div>
    <div class="auth-tab ${AS.tab==="add"?"on":""}"    onclick="AS.tab='add';AS.err='';renderAuth()">+ Add User</div>
    <div class="auth-tab ${AS.tab==="permissions"?"on":""}" onclick="AS.tab='permissions';AS.err='';openPermissionsTab()">Permissions</div>
    ${session?.role==="super_admin" ? `<div class="auth-tab ${AS.tab==="backups"?"on":""}" onclick="AS.tab='backups';AS.err='';openBackupsTab()">💾 Backups</div>` : ""}
    ${session?.role==="super_admin" ? `<div class="auth-tab" onclick="openActivityLog('Users')" style="margin-left:auto">🕘 Log</div>` : ""}
  </div>`;

  if (AS.saved) h += `<div class="auth-success">✓ User saved successfully.</div>`;
  if (AS.err)   h += `<div class="auth-error">${esc(AS.err)}</div>`;

  if (AS.tab === "users")       h += renderUserList(session);
  if (AS.tab === "add")         h += renderAddForm();
  if (AS.tab === "permissions") h += renderPermissionsMatrix();
  if (AS.tab === "backups")     h += renderBackupsTab();

  h += `<div class="footer">Winner Holistic Consultants · User Management · <a href="/account/" style="color:var(--text-muted)">Back to Admin</a></div>`;
  root.innerHTML = h;
}

// ── Header ────────────────────────────────────────────────────
function renderAuthHeader(session) {
  return `<div class="auth-hdr">
    <div>
      <div class="hdr-logo">Winner Holistic Consultants</div>
      <div class="auth-hdr-title">User & Access Management</div>
      <div class="auth-hdr-sub">Manage team members, roles and permissions</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px">Logged in as</div>
      <div style="font-size:13px;font-weight:600;color:#c9a752">${esc(session?.name || "Admin")}</div>
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.1);color:#ddd;margin-top:6px;font-size:11px"
        onclick="serverLogout().then(()=>window.location.href='/auth/')">Logout</button>
    </div>
  </div>`;
}

// ── User list ─────────────────────────────────────────────────
function renderUserList(session) {
  const all = Object.values(AS.users);

  let filtered = all.filter(u => {
    const q = AS.search.toLowerCase();
    if (q && !u.name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false;
    if (AS.filterRole !== "all" && u.role !== AS.filterRole) return false;
    if (AS.filterActive === "active" && u.active === false) return false;
    if (AS.filterActive === "inactive" && u.active !== false) return false;
    return true;
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const total    = all.length;
  const active   = all.filter(u => u.active !== false).length;
  const inactive = all.filter(u => u.active === false).length;

  const tile = (n, label, color, isActive, onclick) => `<div class="auth-kpi" style="cursor:pointer;${isActive?'outline:2px solid #5b3df5;background:#f3f1ff;border-radius:8px':''}" onclick="${onclick}">
    <div class="auth-kpi-n" style="${color?`color:${color}`:''}">${n}</div><div class="auth-kpi-l">${esc(label)}</div>
  </div>`;

  let h = `<div class="auth-body">
    <div class="auth-kpi-row">
      ${tile(total, "Total users", null, AS.filterRole==="all"&&AS.filterActive==="all", "AS.filterRole='all';AS.filterActive='all';renderAuth()")}
      ${tile(active, "Active", "#166a3f", AS.filterActive==="active", `AS.filterActive=${AS.filterActive==="active"?"'all'":"'active'"};renderAuth()`)}
      ${tile(inactive, "Inactive", "#a32d2d", AS.filterActive==="inactive", `AS.filterActive=${AS.filterActive==="inactive"?"'all'":"'inactive'"};renderAuth()`)}
      ${ROLES.map(r => {
        const cnt = all.filter(u => u.role === r.value).length;
        return tile(cnt, r.label, null, AS.filterRole===r.value, `AS.filterRole=${AS.filterRole===r.value?"'all'":`'${r.value}'`};renderAuth()`);
      }).join("")}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:-6px 0 10px 2px">Click a tile to filter by it — click again to clear. ${(AS.filterRole!=="all"||AS.filterActive!=="all")?`<a href="#" onclick="event.preventDefault();AS.filterRole='all';AS.filterActive='all';renderAuth()" style="color:#5b3df5">Clear filters</a>`:""}</div>

    <div class="auth-filter-bar">
      <input class="fi" placeholder="Search name or email..." style="flex:1;min-width:200px;margin:0"
        value="${esc(AS.search)}" oninput="AS.search=this.value;renderAuth()"/>
    </div>

    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${filtered.length} of ${total} users</div>`;

  if (!filtered.length) {
    h += `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">No users match the filters.</div>`;
  }

  h += `<div style="overflow-x:auto"><table class="auth-user-table" style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--surface-3);text-align:left">
      <th style="padding:8px 10px">User</th>
      <th style="padding:8px 10px">Email</th>
      <th style="padding:8px 10px">Role</th>
      <th style="padding:8px 10px">Team</th>
      <th style="padding:8px 10px">Access</th>
      <th style="padding:8px 10px">Joined</th>
      <th style="padding:8px 10px">Status</th>
      <th style="padding:8px 10px"></th>
    </tr></thead>
    <tbody>`;
  filtered.forEach(u => {
    const isMe = u.id === session?.id;
    const isActive = u.active !== false;
    const roleMeta = ROLES.find(r => r.value === u.role);
    const badgeStyle = ROLE_BADGE[u.role] || "background:var(--surface-2);color:var(--text-muted)";

    h += `<tr style="border-bottom:1px solid var(--border-soft);${isActive?"":"opacity:0.55"}">
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="auth-user-avatar" style="width:26px;height:26px;font-size:12px;flex:none">${(u.name||"?")[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600;color:#1a2740">${esc(u.name)}${isMe?` <span class="auth-you-badge">you</span>`:""}</div>
          </div>
        </div>
      </td>
      <td style="padding:8px 10px;color:#666;white-space:nowrap">${esc(u.email || "—")}
        <span style="font-size:10px;color:var(--text-muted);cursor:pointer;text-decoration:underline;margin-left:4px" onclick="copyModuleLink('${u.role}')" title="Copy this role's module link">📋</span>
      </td>
      <td style="padding:8px 10px">
        ${!isMe ? `<select class="fi" style="margin:0;font-size:11px;padding:3px 6px;width:auto" onchange="changeRole('${u.id}',this.value)">
          ${ROLES.map(r => `<option value="${r.value}" ${u.role===r.value?"selected":""}>${r.label}</option>`).join("")}
        </select>` : `<span style="${badgeStyle};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">${esc(roleMeta?.label || u.role)}</span>`}
      </td>
      <td style="padding:8px 10px">
        <select class="fi" style="margin:0;font-size:11px;padding:3px 6px;width:auto" onchange="changeTeam('${u.id}',this.value)">
          <option value="" ${!u.team?"selected":""}>— No team —</option>
          ${(typeof DEP_TASK_DEPARTMENTS!=="undefined"?DEP_TASK_DEPARTMENTS:[]).map(t => `<option value="${esc(t)}" ${u.team===t?"selected":""}>${esc(t)}</option>`).join("")}
        </select>
      </td>
      <td style="padding:8px 10px;max-width:220px">
        ${(ROLE_ACCESS[u.role]||["—"]).map(m=>`<span style="display:inline-block;background:#eef0fb;color:#3c3489;padding:1px 7px;border-radius:7px;margin:2px 3px 2px 0;font-size:10px;font-weight:600;white-space:nowrap">${esc(m)}</span>`).join("")}
      </td>
      <td style="padding:8px 10px;color:var(--text-muted);white-space:nowrap;font-size:11px">${u.createdAt ? fmtDate(u.createdAt.split("T")[0]) : "—"}</td>
      <td style="padding:8px 10px;white-space:nowrap">${!isActive?`<span class="auth-inactive-badge">inactive</span>`:`<span style="color:var(--money-color);font-size:11px;font-weight:600">● active</span>`}</td>
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;gap:5px;justify-content:flex-end">
          <button class="btn btn-sm" style="background:#e8f4ff;color:#1a5276;font-size:11px" onclick="resetPin('${u.id}')">Reset PIN</button>
          ${!isMe ? `
          <button class="btn btn-sm" style="background:${isActive?"#fde8e8":"#d4f0e3"};color:${isActive?"#a32d2d":"#166a3f"};font-size:11px" onclick="toggleUserActive('${u.id}')">${isActive ? "Deactivate" : "Activate"}</button>
          <button class="btn btn-sm" style="background:var(--surface-2);color:var(--text-muted);font-size:11px" onclick="deleteUser('${u.id}')">Delete</button>` : ""}
        </div>
      </td>
    </tr>`;
  });
  h += `</tbody></table></div>`;

  h += `</div>`;
  return h;
}

// ── Add user form ─────────────────────────────────────────────
function renderAddForm() {
  return `<div class="auth-body">
    <div class="sbox">
      <div class="sbox-title">Add New Team Member</div>

      <div class="fgrid" style="margin-bottom:14px">
        <div style="grid-column:1/-1">
          <div class="fl">Full Name <span class="req-star">*</span></div>
          <input class="fi" id="au-name" placeholder="e.g. Hasna Mohammed" autocomplete="off"/>
        </div>
        <div>
          <div class="fl">Email address <span class="req-star">*</span> <span style="font-weight:400;color:var(--text-muted)">— used to map this user as an assignee</span></div>
          <input class="fi" id="au-email" type="email" required placeholder="hasna@whc.ae" autocomplete="off"/>
        </div>
        <div>
          <div class="fl">Role <span class="req-star">*</span></div>
          <select class="fi" id="au-role">
            <option value="">— Select Role —</option>
            ${ROLES.map(r => `<option value="${r.value}">${r.label} — ${r.desc}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="fl">Team / Group <span style="font-weight:400;color:var(--text-muted)">— optional</span></div>
          <select class="fi" id="au-team">
            <option value="">— No team —</option>
            ${(typeof DEP_TASK_DEPARTMENTS!=="undefined"?DEP_TASK_DEPARTMENTS:[]).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="fl">PIN / Password <span class="req-star">*</span></div>
          <input class="fi" id="au-pin" type="password" placeholder="Min 4 characters" autocomplete="new-password"/>
        </div>
        <div>
          <div class="fl">Confirm PIN <span class="req-star">*</span></div>
          <input class="fi" id="au-pin2" type="password" placeholder="Repeat PIN" autocomplete="new-password"
            onkeydown="if(event.key==='Enter')submitAddUser()"/>
        </div>
      </div>

      <div class="nb" style="margin-bottom:14px">
        PIN is hashed with SHA-256 before saving — never stored in plain text.
        The user will log in with their <strong>name</strong> or <strong>email</strong> + PIN.
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-gold" style="flex:1;padding:11px" onclick="submitAddUser()" ${AS.saving?"disabled":""}>
          ${AS.saving ? "Saving..." : `Create User ${svgIcon('arrow-right',14,'#fff')}`}
        </button>
        <button class="btn" style="background:var(--surface-2);color:#666;padding:11px 18px"
          onclick="AS.tab='users';AS.err='';renderAuth()">Cancel</button>
      </div>
    </div>

    <div class="sbox" style="margin-top:12px">
      <div class="sbox-title">Role permissions summary</div>
      ${ROLES.map(r => {
        const badgeStyle = ROLE_BADGE[r.value] || "";
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-soft)">
          <span style="${badgeStyle};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;flex-shrink:0;margin-top:1px">
            ${r.label}
          </span>
          <span style="font-size:12px;color:var(--text-muted)">${r.desc}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted);white-space:nowrap">${ROLE_MODULE_URL[r.value]}</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Permissions matrix (Module Access + Capabilities) ──────────
// Editable table: click a cell to toggle whether a role has that
// module/capability. Persisted server-side (rbac/matrix, super_admin-only
// write) and merged over the hardcoded defaults in shared/permissions.js
// on every page load (see loadRbacOverrides()). super_admin always has
// everything and isn't shown as a column — there's nothing to toggle.

var MODULE_LABELS = {
  proposals: "Proposals", coordinator: "Coordinator", templates: "Templates",
  account: "Account", payments: "Milestone", summary: "Overall Summary",
};
var CAPABILITY_LABELS = {
  "coordinator.viewAllProjects":       "Coordinator — see ALL projects (incl. unassigned)",
  "coordinator.assignCoordinator":     "Coordinator — reassign a project's coordinator",
  "coordinator.raiseRevisionRequest":  "Coordinator — raise a new quotation / revision request",
  "coordinator.reviewRevisionRequest": "Coordinator — review a revision request (read-only)",
  "templates.editScope":               "Templates — create/edit Scope templates",
  "templates.editApproval":            "Templates — create/edit Approval Stage templates",
};

async function openPermissionsTab() {
  AS.tab = "permissions";
  AS.permLoading = true;
  renderAuth();
  if (typeof loadRbacOverrides === "function") { try { await loadRbacOverrides(); } catch (e) {} }
  AS.permLoading = false;
  renderAuth();
}

async function _rbacToggle(kind, key, role) {
  const store = kind === "module" ? MODULE_ACCESS : CAPABILITIES;
  const arr = store[key];
  if (!arr) return;
  const i = arr.indexOf(role);
  if (i >= 0) arr.splice(i, 1); else arr.push(role);
  renderAuth();
  try {
    await fbSet(coPath("rbac/matrix"), { moduleAccess: MODULE_ACCESS, capabilities: CAPABILITIES });
  } catch (e) {}
}

function _rbacResetToDefaults() {
  if (!confirm("Reset ALL permissions back to the built-in defaults? This clears every custom change.")) return;
  fbDelete(coPath("rbac/matrix")).finally(() => window.location.reload());
}

function renderPermissionsMatrix() {
  const roles = ROLES.filter(r => r.value !== "super_admin");
  if (AS.permLoading) {
    return `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Loading current permissions…</div>`;
  }
  const row = (kind, key, label) => `<tr style="border-bottom:1px solid var(--border-soft)">
    <td style="padding:8px 10px;font-size:12px;color:var(--text)">${esc(label)}</td>
    ${roles.map(r => {
      const on = (kind === "module" ? MODULE_ACCESS[key] : CAPABILITIES[key]).includes(r.value);
      return `<td style="padding:8px 10px;text-align:center">
        <span onclick="_rbacToggle('${kind}','${key}','${r.value}')"
          style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:6px;cursor:pointer;font-weight:700;
          background:${on?'#166a3f':'#f3f3f7'};color:${on?'#fff':'#bbb'}">${on?'✓':'—'}</span>
      </td>`;
    }).join("")}
  </tr>`;

  return `
  <div class="nb" style="margin-bottom:14px">Click a cell to grant or remove that permission for the role — changes apply immediately, everywhere, for everyone with that role. <b>super_admin</b> always has full access and isn't shown here.</div>
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-sm" style="background:#fdecec;color:#a33" onclick="_rbacResetToDefaults()">Reset to defaults</button>
  </div>
  <div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--surface-3)">
      <th style="text-align:left;padding:8px 10px;min-width:220px">Module Access</th>
      ${roles.map(r => `<th style="padding:8px 10px;text-align:center;min-width:90px">${esc(r.label)}</th>`).join("")}
    </tr></thead>
    <tbody>
      ${Object.keys(MODULE_ACCESS).map(k => row("module", k, MODULE_LABELS[k] || k)).join("")}
    </tbody>
  </table>
  </div>

  <div style="font-weight:700;font-size:13px;margin:20px 0 8px">Capabilities</div>
  <div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--surface-3)">
      <th style="text-align:left;padding:8px 10px;min-width:320px">Capability</th>
      ${roles.map(r => `<th style="padding:8px 10px;text-align:center;min-width:90px">${esc(r.label)}</th>`).join("")}
    </tr></thead>
    <tbody>
      ${Object.keys(CAPABILITIES).map(k => row("capability", k, CAPABILITY_LABELS[k] || k)).join("")}
    </tbody>
  </table>
  </div>`;
}

// ── Database Backups (Super Admin only) ─────────────────────
// Talks to api/backup.php directly (not the generic data.php collection
// API) since a backup is a file download, not a JSON get/set.
async function openBackupsTab() {
  AS.tab = "backups";
  AS.backupsLoading = true;
  renderAuth();
  try {
    const res = await fetch("/api/backup.php?action=list", { credentials: "include" });
    const data = await res.json();
    AS.backups = (data && data.backups) || [];
  } catch (e) { AS.backups = []; }
  AS.backupsLoading = false;
  renderAuth();
}

function downloadBackupNow() {
  // A plain navigation (not fetch) so the browser handles the file download
  // itself — the response is a .sql attachment, not JSON.
  window.open("/api/backup.php", "_blank");
  // Refresh the list shortly after so the new one shows up.
  setTimeout(openBackupsTab, 2500);
}

async function deleteBackup(name) {
  if (!confirm(`Delete backup "${name}"? This can't be undone.`)) return;
  try {
    await fetch("/api/backup.php?action=delete&name=" + encodeURIComponent(name), { credentials: "include" });
  } catch (e) {}
  openBackupsTab();
}

function fmtBytes(n) {
  if (!n) return "0 KB";
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb/1024).toFixed(1)} MB`;
}

function renderBackupsTab() {
  if (AS.backupsLoading) {
    return `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Loading backups…</div>`;
  }
  const backups = AS.backups || [];
  return `<div class="auth-body">
    <div class="nb" style="margin-bottom:14px">Backs up every table (users, projects, quotations, summary, activity/auth logs) as a plain .sql file — restore it anytime via <b>cPanel → phpMyAdmin → your database → Import</b>. A rolling copy of every backup is also kept on the server for 30 days automatically.
      <br/><br/>⚠️ <b>Important:</b> a copy that only lives on this server won't survive if the server itself is lost. Periodically download a backup and save it somewhere else — your computer, Google Drive, email. For a backup that runs automatically without anyone remembering, set up a cPanel Cron Job — see <code>BACKUP-SETUP-GUIDE.md</code>.
    </div>
    <div style="margin-bottom:14px">
      <button class="btn btn-gold" onclick="downloadBackupNow()">💾 Download Backup Now</button>
      <button class="btn btn-sm" style="background:var(--surface-2);color:#666;margin-left:8px" onclick="openBackupsTab()">↻ Refresh list</button>
    </div>
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">Backups on this server (${backups.length})</div>
    ${!backups.length ? `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">No backups yet — click "Download Backup Now" to create the first one.</div>` : `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:var(--surface-3);text-align:left">
        <th style="padding:8px 10px">File</th>
        <th style="padding:8px 10px">Size</th>
        <th style="padding:8px 10px">Created</th>
        <th style="padding:8px 10px"></th>
      </tr></thead>
      <tbody>
        ${backups.map(b => `<tr style="border-bottom:1px solid var(--border-soft)">
          <td style="padding:8px 10px;font-family:monospace;font-size:11px">${esc(b.name)}</td>
          <td style="padding:8px 10px;color:var(--text-muted)">${fmtBytes(b.size)}</td>
          <td style="padding:8px 10px;color:var(--text-muted)">${fmtDateTime(b.time)}</td>
          <td style="padding:8px 10px;white-space:nowrap;text-align:right">
            <a href="/api/backup.php?action=download&name=${encodeURIComponent(b.name)}" class="btn btn-sm" style="background:#e8f4ff;color:#1a5276;text-decoration:none">Download</a>
            <button class="btn btn-sm" style="background:#fde8e8;color:#a32d2d" onclick="deleteBackup('${b.name}')">Delete</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table></div>`}
  </div>`;
}
