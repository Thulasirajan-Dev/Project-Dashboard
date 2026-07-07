// ============================================================
//  Winner Holistic Consultants – Auth / User Management
//  auth/auth.js  ·  Depends on: shared/shared.js
// ============================================================

const ROLES = [
  { value: "super_admin", label: "Super Admin",  desc: "Full access to all modules" },
  { value: "proposals",   label: "Proposals",    desc: "Create & manage quotations" },
  { value: "coordinator", label: "Coordinator",  desc: "Assigned projects only" },
  { value: "account",     label: "Account",      desc: "Projects & milestone tracking" },
];

const ROLE_BADGE = {
  super_admin: "background:#FAECE7;color:#712B13",
  proposals:   "background:#EEEDFE;color:#3C3489",
  coordinator: "background:#FAEEDA;color:#633806",
  account:     "background:#E0F0EA;color:#1c6b4a",
};

const ROLE_MODULE_URL = {
  super_admin: "/account/",
  proposals:   "/proposals/",
  coordinator: "/coordinator/",
  account:     "/account/",
};

// What each role can access — shown on user cards so permissions are clear.
const ROLE_ACCESS = {
  super_admin: ["Proposals","Coordinator","Summary","Account","Users"],
  proposals:   ["Proposals","Client links"],
  coordinator: ["Coordinator","Client links"],
  account:     ["Account","Milestone Dashboard"],
};

// ── State ─────────────────────────────────────────────────────
let AS = {
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
  AS.loading = true; renderAuth();
  AS.users = (await fbGet("users")) || {};
  AS.activityLog = (await fbGet("auth_log")) || [];
  AS.loading = false; renderAuth();
}

// ── Save activity log entry ───────────────────────────────────
async function logAuthActivity(action, targetName, detail) {
  const session = getSession();
  const entry = {
    at: new Date().toISOString(),
    by: session?.name || "Admin",
    action,
    target: targetName || "",
    detail: detail || ""
  };
  if (!Array.isArray(AS.activityLog)) AS.activityLog = [];
  AS.activityLog.unshift(entry);
  await fbSet("auth_log", AS.activityLog.slice(0, 200)); // keep last 200
  // Also mirror into the global cross-module activity log (if available).
  if (typeof logActivity === "function") {
    logActivity("Users", action, targetName, detail);
  }
}

// ── Add user ──────────────────────────────────────────────────
async function submitAddUser() {
  if (AS.saving) return;            // ignore rapid double-clicks
  const name  = document.getElementById("au-name")?.value.trim();
  const email = document.getElementById("au-email")?.value.trim();
  const role  = document.getElementById("au-role")?.value;
  const pin   = document.getElementById("au-pin")?.value.trim();
  const pin2  = document.getElementById("au-pin2")?.value.trim();

  if (!name || !role || !pin) { AS.err = "Name, role and PIN are required."; renderAuth(); return; }
  if (pin !== pin2) { AS.err = "PINs do not match."; renderAuth(); return; }
  if (pin.length < 4) { AS.err = "PIN must be at least 4 characters."; renderAuth(); return; }

  AS.saving = true; AS.err = ""; renderAuth();

  // Only an authenticated Super Admin can create users (enforced server-side).
  const payload = { name, email: email || "", role, pin };

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
    h += `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">Loading users...</div></div>`;
    root.innerHTML = h; return;
  }

  h += `<div class="auth-tabs">
    <div class="auth-tab ${AS.tab==="users"?"on":""}"  onclick="AS.tab='users';AS.err='';renderAuth()">All Users</div>
    <div class="auth-tab ${AS.tab==="add"?"on":""}"    onclick="AS.tab='add';AS.err='';renderAuth()">+ Add User</div>
    <div class="auth-tab ${AS.tab==="activity"?"on":""}" onclick="AS.tab='activity';renderAuth()">Activity Log</div>
  </div>`;

  if (AS.saved) h += `<div class="auth-success">✓ User saved successfully.</div>`;
  if (AS.err)   h += `<div class="auth-error">${esc(AS.err)}</div>`;

  if (AS.tab === "users")    h += renderUserList(session);
  if (AS.tab === "add")      h += renderAddForm();
  if (AS.tab === "activity") h += renderActivityLog();

  h += `<div class="footer">Winner Holistic Consultants · User Management · <a href="/account/" style="color:#888">Back to Admin</a></div>`;
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

  let h = `<div class="auth-body">
    <div class="auth-kpi-row">
      <div class="auth-kpi"><div class="auth-kpi-n">${total}</div><div class="auth-kpi-l">Total users</div></div>
      <div class="auth-kpi"><div class="auth-kpi-n" style="color:#166a3f">${active}</div><div class="auth-kpi-l">Active</div></div>
      <div class="auth-kpi"><div class="auth-kpi-n" style="color:#a32d2d">${inactive}</div><div class="auth-kpi-l">Inactive</div></div>
      ${ROLES.map(r => {
        const cnt = all.filter(u => u.role === r.value).length;
        return `<div class="auth-kpi"><div class="auth-kpi-n">${cnt}</div><div class="auth-kpi-l">${r.label}</div></div>`;
      }).join("")}
    </div>

    <div class="auth-filter-bar">
      <input class="fi" placeholder="Search name or email..." style="flex:2;min-width:160px;margin:0"
        value="${esc(AS.search)}" oninput="AS.search=this.value;renderAuth()"/>
      <select class="fi" style="flex:1;min-width:120px;margin:0" onchange="AS.filterRole=this.value;renderAuth()">
        <option value="all">All roles</option>
        ${ROLES.map(r => `<option value="${r.value}" ${AS.filterRole===r.value?"selected":""}>${r.label}</option>`).join("")}
      </select>
      <select class="fi" style="flex:1;min-width:110px;margin:0" onchange="AS.filterActive=this.value;renderAuth()">
        <option value="all">All status</option>
        <option value="active"   ${AS.filterActive==="active"?"selected":""}>Active</option>
        <option value="inactive" ${AS.filterActive==="inactive"?"selected":""}>Inactive</option>
      </select>
    </div>

    <div style="font-size:11px;color:#aaa;margin-bottom:8px">${filtered.length} of ${total} users</div>`;

  if (!filtered.length) {
    h += `<div style="text-align:center;padding:32px;color:#aaa;font-size:13px">No users match the filters.</div>`;
  }

  h += `<div class="auth-user-grid">`;
  filtered.forEach(u => {
    const isMe = u.id === session?.id;
    const isActive = u.active !== false;
    const roleMeta = ROLES.find(r => r.value === u.role);
    const badgeStyle = ROLE_BADGE[u.role] || "background:#f0f0f0;color:#555";

    h += `<div class="auth-user-card ${isActive ? "" : "auth-user-inactive"}">
      <div class="auth-user-top">
        <div class="auth-user-avatar">${(u.name||"?")[0].toUpperCase()}</div>
        <div style="flex:1">
          <div class="auth-user-name">
            ${esc(u.name)}
            ${isMe ? `<span class="auth-you-badge">you</span>` : ""}
            ${!isActive ? `<span class="auth-inactive-badge">inactive</span>` : ""}
          </div>
          <div class="auth-user-email">${esc(u.email || "No email set")}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
            <span style="${badgeStyle};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">
              ${esc(roleMeta?.label || u.role)}
            </span>
            <span style="font-size:10px;color:#aaa">Joined: ${u.createdAt ? fmtDate(u.createdAt.split("T")[0]) : "—"}</span>
            <span style="font-size:10px;color:#aaa;cursor:pointer;text-decoration:underline"
              onclick="copyModuleLink('${u.role}')">📋 Copy module link</span>
          </div>
          <div style="margin-top:6px;font-size:10.5px;color:#888">
            <b style="color:#777">Access:</b>
            ${(ROLE_ACCESS[u.role]||["—"]).map(m=>`<span style="display:inline-block;background:#eef0fb;color:#3C3489;padding:1px 7px;border-radius:7px;margin:2px 3px 0 0;font-weight:600">${m}</span>`).join("")}
          </div>
        </div>

        <!-- Role change -->
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
          ${!isMe ? `<select class="fi" style="width:140px;margin:0;font-size:11px;padding:4px 8px"
            onchange="changeRole('${u.id}',this.value)">
            ${ROLES.map(r => `<option value="${r.value}" ${u.role===r.value?"selected":""}>${r.label}</option>`).join("")}
          </select>` : `<div style="font-size:11px;color:#aaa;text-align:right">Your account</div>`}

          <div style="display:flex;gap:5px">
            <button class="btn btn-sm" style="background:#e8f4ff;color:#1a5276;font-size:11px"
              onclick="resetPin('${u.id}')">Reset PIN</button>
            ${!isMe ? `
            <button class="btn btn-sm" style="background:${isActive?"#fde8e8":"#d4f0e3"};color:${isActive?"#a32d2d":"#166a3f"};font-size:11px"
              onclick="toggleUserActive('${u.id}')">
              ${isActive ? "Deactivate" : "Activate"}
            </button>
            <button class="btn btn-sm" style="background:#f0f0f0;color:#888;font-size:11px"
              onclick="deleteUser('${u.id}')">Delete</button>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  });
  h += `</div>`; // close .auth-user-grid

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
          <div class="fl">Email address</div>
          <input class="fi" id="au-email" type="email" placeholder="hasna@whc.ae" autocomplete="off"/>
        </div>
        <div>
          <div class="fl">Role <span class="req-star">*</span></div>
          <select class="fi" id="au-role">
            <option value="">— Select Role —</option>
            ${ROLES.map(r => `<option value="${r.value}">${r.label} — ${r.desc}</option>`).join("")}
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
        <button class="btn" style="background:#f0f0f0;color:#666;padding:11px 18px"
          onclick="AS.tab='users';AS.err='';renderAuth()">Cancel</button>
      </div>
    </div>

    <div class="sbox" style="margin-top:12px">
      <div class="sbox-title">Role permissions summary</div>
      ${ROLES.map(r => {
        const badgeStyle = ROLE_BADGE[r.value] || "";
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0">
          <span style="${badgeStyle};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;flex-shrink:0;margin-top:1px">
            ${r.label}
          </span>
          <span style="font-size:12px;color:#555">${r.desc}</span>
          <span style="margin-left:auto;font-size:11px;color:#aaa;white-space:nowrap">${ROLE_MODULE_URL[r.value]}</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Activity log ──────────────────────────────────────────────
function renderActivityLog() {
  const logs = Array.isArray(AS.activityLog) ? AS.activityLog : [];
  return `<div class="auth-body">
    <div class="sbox">
      <div class="sbox-title">Activity Log <span style="font-size:10px;color:#bbb;font-weight:400;margin-left:6px">${logs.length} entries</span></div>
      ${!logs.length ? `<div style="text-align:center;padding:24px;color:#aaa;font-size:13px">No activity recorded yet.</div>` : ""}
      ${logs.slice(0, 100).map(log => {
        const actionColor = {
          "User created":     "#166a3f",
          "User deleted":     "#a32d2d",
          "User deactivated": "#a32d2d",
          "User activated":   "#166a3f",
          "PIN reset":        "#1a5276",
          "Role changed":     "#a06b00",
        }[log.action] || "#555";
        return `<div class="act-row">
          <div class="act-dot" style="background:${actionColor}"></div>
          <div class="act-body">
            <div class="act-stage" style="color:${actionColor}">${esc(log.action)}</div>
            <div class="act-detail">
              ${log.target ? `<strong>${esc(log.target)}</strong>` : ""}
              ${log.detail ? ` · ${esc(log.detail)}` : ""}
              ${log.by ? ` · by ${esc(log.by)}` : ""}
            </div>
          </div>
          <div class="act-time">${fmtDateTime(log.at)}</div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}
