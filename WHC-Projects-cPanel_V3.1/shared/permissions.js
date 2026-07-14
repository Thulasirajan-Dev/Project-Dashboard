// ============================================================
//  Winner Holistic Consultants – Central RBAC permissions
//  shared/permissions.js
//
//  SINGLE SOURCE OF TRUTH for "who can do what" on the client side.
//  Every module-access check and every fine-grained capability check in
//  the app should read from here rather than hardcoding a role array
//  inline — that's how the same list of roles ended up duplicated across
//  requireRole() calls, SIDEBAR_ITEMS, and the auth hub's MODULES arrays
//  in the first place.
//
//  Mirrored server-side in api/permissions.php, which is the actual
//  security boundary (this file only controls the UI — see the note in
//  that file about why writes/reads are enforced there, not here).
//  If you add a role, a module, or a capability, update BOTH files.
//
//  Loaded before shared.js on every page (see each module's index.html).
// ============================================================

var RBAC_ROLES = ["super_admin", "management", "proposals", "coordinator", "team_lead", "account"];

var ROLE_DESCRIPTIONS = {
  super_admin: "Full access to every module",
  management:  "Views every module — read-only, no editing anywhere",
  proposals:   "Create & manage quotations",
  coordinator: "Sees only their own assigned projects",
  team_lead:   "Sees all Coordinator projects (incl. unassigned) and assigns them",
  account:     "Projects & milestone tracking, credits milestones",
};

// ── Module access (routing-level: can this role open the module at all) ──
// management can open every module (added to each list below) but is
// marked view-only in every one too (see VIEW_ONLY_ROLES) — it's a pure
// oversight role, never an editor.
var MODULE_ACCESS = {
  proposals:         ["proposals", "super_admin", "management"],
  coordinator:       ["coordinator", "team_lead", "super_admin", "proposals", "management"],
  templates:         ["proposals", "coordinator", "team_lead", "super_admin", "management"],
  account:           ["super_admin", "account", "management"],
  payments:          ["super_admin", "account", "proposals", "coordinator", "management"],
  summary:           ["super_admin", "proposals", "account", "management"],
  team_performance:  ["super_admin", "proposals", "account", "team_lead", "management"],
};

// ── Fine-grained capabilities (inside a module a role already has access
// to, what specifically can they do). super_admin implicitly has every
// capability — no need to list it in each array.
var CAPABILITIES = {
  // Coordinator module
  "coordinator.viewAllProjects":       ["team_lead", "management"], // see every project incl. unassigned, vs only their own
  "coordinator.assignCoordinator":     ["team_lead"],           // change a project's assigned coordinator
  "coordinator.raiseRevisionRequest":  ["coordinator", "team_lead"],
  "coordinator.reviewRevisionRequest": ["proposals"],           // read-only review of a revision's linked quotation
  "coordinator.clearActivityLog":      [],                      // super_admin only

  // Templates module
  "templates.editScope":    ["proposals", "coordinator", "team_lead"],
  "templates.editApproval": ["proposals", "coordinator", "team_lead"],

  // Proposals module
  "proposals.editCoordinatorAssignment": [],                    // nobody but super_admin — read-only link for everyone else
};

// Roles that may only VIEW (not edit) a given module — moved here from
// shared.js so it lives next to the rest of the permission model.
// isViewOnly(moduleKey, role) (defined in shared.js) reads this.
// management is view-only in EVERY module — it's a pure oversight role.
var VIEW_ONLY_ROLES = {
  proposals:   ["management"],
  coordinator: ["proposals", "management"],
  templates:   ["management"],
  account:     ["management"],
  summary:     ["proposals", "account", "management"],                   // Overall Summary: view only
  payments:    ["proposals", "coordinator", "account", "management"],    // Milestone: view only
  team_performance: ["proposals", "account", "team_lead", "management"], // reporting page — nothing to edit anyway
};

// Fetch any saved overrides (set via the Permissions matrix in Manage
// Users) and apply them on top of the hardcoded defaults above. Mutates
// MODULE_ACCESS/CAPABILITIES arrays IN PLACE (rather than reassigning)
// so anything that captured a reference at load time (e.g. SIDEBAR_ITEMS,
// built synchronously before this async call resolves) sees the update
// too. Call this once, early in boot() — BEFORE requireModule() — on
// every page, or a stale default gets used for that page load.
async function loadRbacOverrides() {
  try {
    const overrides = (typeof fbGet === "function") ? await fbGet(coPath("rbac/matrix"), { fresh: true }) : null;
    if (!overrides) return;
    if (overrides.moduleAccess) {
      Object.keys(overrides.moduleAccess).forEach(k => {
        if (!MODULE_ACCESS[k]) return;
        MODULE_ACCESS[k].length = 0;
        (overrides.moduleAccess[k] || []).forEach(r => MODULE_ACCESS[k].push(r));
      });
    }
    if (overrides.capabilities) {
      Object.keys(overrides.capabilities).forEach(k => {
        if (!(k in CAPABILITIES)) return;
        CAPABILITIES[k].length = 0;
        (overrides.capabilities[k] || []).forEach(r => CAPABILITIES[k].push(r));
      });
    }
  } catch (e) {}
}

// ── Helpers ──────────────────────────────────────────────────
// canAccessModule("coordinator", user.role) -> true/false
function canAccessModule(moduleKey, role) {
  if (role === "super_admin") return true;
  const allowed = MODULE_ACCESS[moduleKey];
  return !!allowed && allowed.includes(role);
}
// can("coordinator.assignCoordinator", user.role) -> true/false
function can(capabilityKey, role) {
  if (role === "super_admin") return true;
  const allowed = CAPABILITIES[capabilityKey];
  return !!allowed && allowed.includes(role);
}
