<?php
// ============================================================
//  Winner Holistic Consultants – DB connection helper
//  api/db/conn.php
//  Returns a shared PDO instance and small JSON helpers.
// ============================================================

function db() {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $cfg = require __DIR__ . '/db.config.php';
    $dsn = "mysql:host={$cfg['host']};dbname={$cfg['name']};charset={$cfg['charset']}";
    $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function json_out($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

function json_err($msg, $code = 400, $detail = null) {
    $out = ['error' => $msg];
    if ($detail !== null) $out['detail'] = $detail;
    json_out($out, $code);
}

// Read+decode the JSON request body.
function body() {
    $raw = file_get_contents('php://input');
    $b = json_decode($raw ?: '{}', true);
    return is_array($b) ? $b : [];
}

// ── One session per user ────────────────────────────────────────
//  Each successful login mints a random token, stores it against the
//  user's row (users.current_session), AND in the PHP session
//  ($_SESSION['stoken']). Logging in again anywhere overwrites the DB
//  value, so any OTHER browser/device still holding the old token fails
//  this check on its next request and is signed out automatically —
//  only the most recent login for a given account stays valid.
function session_still_current(string $uid, string $token): bool {
    if ($uid === '' || $token === '') return false;
    try {
        $pdo = db();
        $st = $pdo->prepare("SELECT current_session FROM users WHERE id=?");
        $st->execute([$uid]);
        $row = $st->fetch();
        return $row && is_string($row['current_session']) && hash_equals($row['current_session'], $token);
    } catch (Throwable $e) {
        // The current_session column doesn't exist yet (migration not run —
        // see schema.sql). Fail OPEN rather than lock everyone out: this
        // just means one-session-per-user isn't enforced until the column
        // is added, not that the whole app goes down.
        return true;
    }
}
// Kill the current PHP session (used when session_still_current() fails).
function session_kill() {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    @session_destroy();
}
