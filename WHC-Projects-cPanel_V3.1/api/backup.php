<?php
// ============================================================
//  Winner Holistic Consultants – Database Backup
//  api/backup.php
//
//  Dumps every table (users, projects, quotations, summary,
//  activity_log, auth_log) to a plain .sql file — pure PHP, no
//  shell_exec/mysqldump dependency, so it works on any shared
//  host regardless of what's disabled.
//
//  RESTORE: cPanel → phpMyAdmin → select your database → Import →
//  choose the downloaded .sql file → Go. That's it — it's a normal
//  SQL dump (CREATE TABLE IF NOT EXISTS + INSERT statements).
//
//  TWO WAYS TO RUN THIS:
//   1. Logged in as super_admin, visit /api/backup.php in the browser
//      — downloads immediately AND saves a copy on the server.
//   2. Automated via a cPanel Cron Job (no login needed) — see
//      BACKUP-SETUP-GUIDE.md. Requires ?token=<BACKUP_TOKEN> matching
//      config.secret.php.
//
//  Every backup is also saved under api/backups/ (kept for 30 days,
//  older ones auto-deleted) so you have a rolling safety net even if
//  nobody remembers to download one manually. That said — a copy that
//  only lives on the SAME server doesn't protect you if the server
//  itself is lost. Download backups periodically to somewhere else
//  (your computer, Google Drive, email) — see the setup guide.
// ============================================================

require __DIR__ . '/db/conn.php';
$cfg = require __DIR__ . '/config.secret.php';

// Match the server-side session lifetime to the 120-minute client-side
// idle timeout (see shared.js SESSION_IDLE_MS) — otherwise PHP's default
// session.gc_maxlifetime (often ~24 min on shared hosts) could silently
// expire the session server-side well before the client thinks it should.
ini_set('session.gc_maxlifetime', 7200);
session_set_cookie_params([
    'lifetime' => 0, 'path' => '/', 'secure' => ($cfg['COOKIE_SECURE'] ?? true),
    'httponly' => true, 'samesite' => 'Strict',
]);
session_name('WHCSESS');
session_start();

// ── Access control: EITHER a logged-in super_admin session, OR the
// correct backup token (for cron). Never both required — cron has no
// session, a human clicking a button has no token.
$tokenOk = !empty($_GET['token']) && !empty($cfg['BACKUP_TOKEN'])
    && $cfg['BACKUP_TOKEN'] !== 'CHANGE_ME_TO_A_LONG_RANDOM_STRING'
    && hash_equals($cfg['BACKUP_TOKEN'], $_GET['token']);
$sessionOk = !empty($_SESSION['uid']) && ($_SESSION['role'] ?? '') === 'super_admin'
    && session_still_current($_SESSION['uid'], $_SESSION['stoken'] ?? '');

if (!$tokenOk && !$sessionOk) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Not authorized. Log in as Super Admin, or provide a valid ?token=.']);
    exit;
}

$backupDir = __DIR__ . '/backups';
if (!is_dir($backupDir)) @mkdir($backupDir, 0755, true);

// Safe filename check — only ever touch our own "whc-backup-*.sql" files,
// never anything a crafted filename param could point elsewhere.
function safe_backup_path(string $dir, string $name): ?string {
    if (!preg_match('/^whc-backup-[0-9_\-]+\.sql$/', $name)) return null;
    $path = $dir . '/' . $name;
    return is_file($path) ? $path : null;
}

// ── action=list: return existing backups as JSON (management UI) ──
if (($_GET['action'] ?? '') === 'list') {
    $files = glob($backupDir . '/whc-backup-*.sql') ?: [];
    rsort($files);
    $out = array_map(fn($f) => [
        'name' => basename($f),
        'size' => filesize($f),
        'time' => date('c', filemtime($f)),
    ], $files);
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'backups' => $out]);
    exit;
}

// ── action=download&name=...: stream an EXISTING backup (no regenerate) ──
if (($_GET['action'] ?? '') === 'download' && !empty($_GET['name'])) {
    $path = safe_backup_path($backupDir, $_GET['name']);
    if (!$path) { http_response_code(404); echo 'Not found'; exit; }
    header('Content-Type: application/sql');
    header('Content-Disposition: attachment; filename="' . basename($path) . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

// ── action=delete&name=...: remove an old backup (Super Admin session only,
// not the cron token — deleting isn't something automation should do) ──
if (($_GET['action'] ?? '') === 'delete' && !empty($_GET['name'])) {
    if (!$sessionOk) { http_response_code(403); echo json_encode(['error'=>'Super Admin session required to delete.']); exit; }
    $path = safe_backup_path($backupDir, $_GET['name']);
    if ($path) @unlink($path);
    header('Content-Type: application/json');
    echo json_encode(['ok' => true]);
    exit;
}

$pdo = db();
$tables = ['users', 'projects', 'quotations', 'summary', 'activity_log', 'auth_log'];

function sql_escape_value($v, PDO $pdo) {
    if ($v === null) return 'NULL';
    return $pdo->quote((string)$v);
}

function dump_table(PDO $pdo, string $table): string {
    $out = "\n-- ---------------------------------------------------------\n";
    $out .= "-- Table: {$table}\n";
    $out .= "-- ---------------------------------------------------------\n";

    // Structure — reproduce exactly via SHOW CREATE TABLE (safer/more
    // accurate than hand-maintaining a second copy of schema.sql here).
    $createRow = $pdo->query("SHOW CREATE TABLE `{$table}`")->fetch(PDO::FETCH_ASSOC);
    $createSql = $createRow['Create Table'] ?? '';
    $createSql = preg_replace('/^CREATE TABLE/', 'CREATE TABLE IF NOT EXISTS', $createSql, 1);
    $out .= $createSql . ";\n\n";

    // Data
    $stmt = $pdo->query("SELECT * FROM `{$table}`");
    $cols = null;
    $rowCount = 0;
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        if ($cols === null) $cols = array_keys($row);
        $vals = array_map(fn($v) => sql_escape_value($v, $pdo), array_values($row));
        $colList = '`' . implode('`,`', $cols) . '`';
        $out .= "INSERT INTO `{$table}` ({$colList}) VALUES (" . implode(',', $vals) . ");\n";
        $rowCount++;
    }
    $out .= "-- {$rowCount} row(s)\n";
    return $out;
}

// ── Build the dump ──────────────────────────────────────────
$stamp = date('Y-m-d_His');
$sql  = "-- Winner Holistic Consultants — full database backup\n";
$sql .= "-- Generated: " . date('c') . "\n";
$sql .= "-- Restore: cPanel → phpMyAdmin → your database → Import → choose this file → Go\n";
$sql .= "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n";
foreach ($tables as $t) {
    try { $sql .= dump_table($pdo, $t); }
    catch (Throwable $e) { $sql .= "\n-- Skipped {$t}: " . $e->getMessage() . "\n"; }
}
$sql .= "SET FOREIGN_KEY_CHECKS=1;\n";

// ── Save a rolling copy on the server ───────────────────────
$filename = "whc-backup-{$stamp}.sql";
$filepath = $backupDir . '/' . $filename;
@file_put_contents($filepath, $sql);

// Retention: delete backups older than 30 days so this doesn't quietly
// fill up your hosting quota over time.
foreach (glob($backupDir . '/whc-backup-*.sql') ?: [] as $old) {
    if (filemtime($old) < time() - 30 * 86400) @unlink($old);
}

// ── Stream the download ─────────────────────────────────────
header('Content-Type: application/sql');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . strlen($sql));
echo $sql;
