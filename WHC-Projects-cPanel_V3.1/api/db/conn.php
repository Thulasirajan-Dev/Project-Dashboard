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
