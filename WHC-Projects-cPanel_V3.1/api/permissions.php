<?php
// ============================================================
//  Winner Holistic Consultants – Central RBAC permissions (server)
//  api/permissions.php
//
//  THIS is the real security boundary — every write is checked against
//  $WRITE_RULES below, on the server, using the session's role
//  ($_SESSION['role']), which the browser cannot forge. The client-side
//  copy of this model (shared/permissions.js) only controls what the UI
//  shows; it is never trusted for access decisions. A request forged in
//  DevTools with no valid session, or a role the rule doesn't list, is
//  rejected here regardless of what the browser sent.
//
//  Keep this in sync with shared/permissions.js: if you add a role, a
//  collection, or change who can do what, update both files. They're
//  necessarily two separate files (PHP vs JS runtime) but should always
//  describe the same policy.
//
//  MODULE_ACCESS is included for completeness / documentation — actual
//  page routing is enforced client-side via requireModule() since there
//  is no server-rendered page routing in this app. The data that actually
//  matters here is $WRITE_RULES, which IS enforced server-side.
// ============================================================

const RBAC_ROLES = ['super_admin', 'proposals', 'coordinator', 'team_lead', 'account'];

// Mirrors MODULE_ACCESS in shared/permissions.js.
const RBAC_MODULE_ACCESS = [
    'proposals'   => ['proposals', 'super_admin'],
    'coordinator' => ['coordinator', 'team_lead', 'super_admin', 'proposals'],
    'templates'   => ['proposals', 'coordinator', 'team_lead', 'super_admin'],
    'account'     => ['super_admin', 'account'],
    'payments'    => ['super_admin', 'account', 'proposals', 'coordinator'],
    'summary'     => ['super_admin', 'proposals', 'account'],
];

// WRITE permission per collection (set/delete) — THE actual enforcement
// point for every data mutation in the app. Reads are allowed for any
// collection a session can reach at all (see the note in data.php about
// why reads aren't further restricted yet).
const RBAC_WRITE_RULES = [
    'users'        => ['super_admin'],
    'projects'     => ['super_admin', 'coordinator', 'team_lead', 'account'], // account edits LPO/credit fields; proposals stays view-only
    'quotations'   => ['super_admin', 'proposals'],
    'qtn_counter'  => ['super_admin', 'proposals', 'coordinator', 'team_lead'], // coordinator/team_lead mint revision numbers
    'options'      => ['super_admin', 'proposals', 'coordinator', 'team_lead', 'account'], // anyone can add dropdown options
    'rbac'         => ['super_admin'], // the editable Module Access / Capabilities matrix — super_admin only
    'summary'      => ['super_admin'],
    'activity_log' => ['super_admin', 'proposals', 'coordinator', 'team_lead', 'account'], // anyone logged in may append
    'auth_log'     => ['super_admin', 'proposals', 'coordinator', 'team_lead', 'account'],
    'dependent_tasks' => ['super_admin', 'proposals', 'coordinator', 'team_lead', 'account'], // raised by Proposals/Coordinator; status updated by whoever it's assigned to
];

// rbac_can_write('projects', $role) -> bool
function rbac_can_write(string $collection, string $role): bool {
    if ($role === 'super_admin') return true;
    $allowed = RBAC_WRITE_RULES[$collection] ?? ['super_admin'];
    return in_array($role, $allowed, true);
}

// rbac_can_access_module('coordinator', $role) -> bool
function rbac_can_access_module(string $moduleKey, string $role): bool {
    if ($role === 'super_admin') return true;
    $allowed = RBAC_MODULE_ACCESS[$moduleKey] ?? [];
    return in_array($role, $allowed, true);
}
