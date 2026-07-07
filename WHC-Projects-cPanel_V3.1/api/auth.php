<?php
// ============================================================
//  Winner Holistic Consultants – Server-side Auth
//  api/auth.php
//
//  Real authentication. The SERVER verifies the PIN against MySQL
//  and starts a PHP session; the browser only ever holds an opaque
//  session cookie it cannot forge. This is what makes access
//  control real instead of honor-system.
//
//  Actions (POST JSON { action: ... }):
//    login   { name, pin }   -> verifies, starts session, returns user (no pin)
//    logout  {}              -> destroys session
//    me      {}              -> returns current session user or null
//
//  PINs are SHA-256 hashed exactly as the app already produces them,
//  so existing user records keep working.
// ============================================================

require __DIR__ . '/db/conn.php';

$cfg = require __DIR__ . '/config.secret.php';
// Allow the site origin over either http or https (helps while SSL is being
// set up). Falls back to the configured SITE_URL.
$__origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$__siteHost = parse_url($cfg['SITE_URL'] ?? '', PHP_URL_HOST);
if ($__origin && $__siteHost && parse_url($__origin, PHP_URL_HOST) === $__siteHost) {
    header('Access-Control-Allow-Origin: ' . $__origin);
} else {
    header('Access-Control-Allow-Origin: ' . ($cfg['SITE_URL'] ?? '*'));
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// Harden the session cookie.
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => ($cfg['COOKIE_SECURE'] ?? true),   // HTTPS only unless temporarily disabled
    'httponly' => true,      // not readable by JavaScript
    'samesite' => 'Strict',
]);
session_name('WHCSESS');
session_start();

$req    = body();
$action = $req['action'] ?? '';

// ── Public: is first-time setup needed? (no session required) ──
//  Returns whether ANY users exist yet, so the login page can decide
//  between the bootstrap screen and the normal login. Reveals only a
//  boolean — no user data.
if ($action === 'needs_setup') {
    $pdo = db();
    $count = (int)$pdo->query("SELECT COUNT(*) AS c FROM users")->fetch()['c'];
    json_out(['needsSetup' => $count === 0]);
}

if ($action === 'login') {
    $name = trim($req['name'] ?? '');
    $pin  = (string)($req['pin'] ?? '');
    if ($name === '' || $pin === '') json_err('Name and PIN required', 400);

    // SHA-256 of the PIN, matching the client's hashPin().
    $hash = hash('sha256', $pin);

    $pdo = db();
    $st = $pdo->prepare(
        "SELECT id,name,email,role,active FROM users
         WHERE active=1 AND (LOWER(name)=LOWER(?) OR LOWER(email)=LOWER(?)) AND pin=?
         LIMIT 1"
    );
    $st->execute([$name, $name, $hash]);
    $u = $st->fetch();

    if (!$u) {
        // Generic message — don't reveal whether name or PIN was wrong.
        json_err('Invalid name or PIN', 401);
    }

    // Establish the server session. The browser never sees role logic.
    session_regenerate_id(true);
    $_SESSION['uid']   = $u['id'];
    $_SESSION['role']  = $u['role'];
    $_SESSION['name']  = $u['name'];
    $_SESSION['email'] = $u['email'];
    $_SESSION['t']     = time();

    json_out(['ok' => true, 'user' => [
        'id' => $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'],
    ]]);
}

if ($action === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    json_out(['ok' => true]);
}

if ($action === 'me') {
    if (empty($_SESSION['uid'])) json_out(['user' => null]);
    json_out(['user' => [
        'id'    => $_SESSION['uid'],
        'name'  => $_SESSION['name'],
        'email' => $_SESSION['email'],
        'role'  => $_SESSION['role'],
    ]]);
}

// ── List users (names/roles only, NO pins) ────────────────────
//  Any authenticated user may fetch this lightweight directory to
//  populate owner/assignee dropdowns. PIN hashes are never included.
//  Optional filter: { action:"list_users", role:"account" }
if ($action === 'list_users') {
    if (empty($_SESSION['uid'])) json_err('Not authenticated', 401);
    $pdo = db();
    $roleFilter = $req['role'] ?? '';
    if ($roleFilter) {
        $st = $pdo->prepare("SELECT id,name,email,role,active FROM users WHERE active=1 AND role=? ORDER BY name");
        $st->execute([$roleFilter]);
    } else {
        $st = $pdo->query("SELECT id,name,email,role,active FROM users WHERE active=1 ORDER BY name");
    }
    json_out(['users' => $st->fetchAll()]);
}

// ── Create a user (server-enforced) ───────────────────────────
//  Two legitimate cases:
//   (1) Bootstrap: NO users exist yet -> allow creating the first
//       super_admin, but only with the correct bootstrap password.
//   (2) Normal: an authenticated super_admin creates users.
if ($action === 'signup') {
    // Only an authenticated Super Admin may create users. The first Super
    // Admin is created once directly in the database (see install guide) —
    // there is no in-app bootstrap.
    if (empty($_SESSION['uid']) || $_SESSION['role'] !== 'super_admin') {
        json_err('Only a Super Admin can create users', 403);
    }
    $pdo = db();

    $name = trim($req['name'] ?? '');
    $email= trim($req['email'] ?? '');
    $role = $req['role'] ?? '';
    $pin  = (string)($req['pin'] ?? '');
    if ($name === '' || $role === '' || strlen($pin) < 4) json_err('Name, role and a 4+ char PIN are required', 400);

    // Reject duplicate names.
    $dup = $pdo->prepare("SELECT id FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1");
    $dup->execute([$name]);
    if ($dup->fetch()) json_err('A user with that name already exists', 409);

    $id = 'u' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 5);
    $st = $pdo->prepare(
        "INSERT INTO users (id,name,email,role,pin,active,assigned_projects,created_at)
         VALUES (?,?,?,?,?,1,?,NOW())"
    );
    $st->execute([$id, $name, $email, $role, hash('sha256', $pin), json_encode([])]);

    json_out(['ok' => true, 'id' => $id]);
}

// ── Change own PIN (self-service, requires current PIN) ───────
//  { action:"change_pin", current_pin, new_pin }
//  The logged-in user verifies their current PIN and sets a new one.
if ($action === 'change_pin') {
    if (empty($_SESSION['uid'])) json_err('Not authenticated', 401);
    $current = (string)($req['current_pin'] ?? '');
    $new     = (string)($req['new_pin'] ?? '');
    if ($current === '' || $new === '') json_err('Current and new PIN are required', 400);
    if (strlen($new) < 4) json_err('New PIN must be at least 4 characters', 400);
    if ($new === $current) json_err('New PIN must be different from the current PIN', 400);

    $pdo = db();
    // Verify the current PIN for THIS user.
    $st = $pdo->prepare("SELECT pin FROM users WHERE id=? LIMIT 1");
    $st->execute([$_SESSION['uid']]);
    $row = $st->fetch();
    if (!$row || $row['pin'] !== hash('sha256', $current)) {
        json_err('Current PIN is incorrect', 403);
    }
    // Set the new PIN.
    $up = $pdo->prepare("UPDATE users SET pin=? WHERE id=?");
    $up->execute([hash('sha256', $new), $_SESSION['uid']]);
    json_out(['ok' => true]);
}

json_err('Unknown action', 400);
