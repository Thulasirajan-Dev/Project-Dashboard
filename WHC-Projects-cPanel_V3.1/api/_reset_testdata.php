<?php
// ============================================================
//  _reset_testdata.php  —  ONE-TIME TEST DATA CLEANUP
// ------------------------------------------------------------
//  Wipes all test PROJECTS, QUOTATIONS, quotation COUNTERS, and
//  LOGS so you can test the new structure from a clean slate.
//
//  KEEPS: users (your logins) so you don't have to recreate them.
//
//  HOW TO USE:
//    1. Upload this file to /api/ on the server.
//    2. Visit:  https://projects.winnerhc.com/api/_reset_testdata.php?confirm=YES
//    3. It prints what it deleted.
//    4. DELETE THIS FILE from the server immediately afterwards.
//
//  Safe to run more than once. Does nothing without ?confirm=YES.
// ============================================================

require __DIR__ . '/db/conn.php';
header('Content-Type: text/plain; charset=utf-8');

if (($_GET['confirm'] ?? '') !== 'YES') {
    http_response_code(400);
    echo "Refusing to run.\n\n";
    echo "This will DELETE all test projects, quotations, counters and logs\n";
    echo "(your user logins are kept).\n\n";
    echo "To proceed, add ?confirm=YES to the URL:\n";
    echo "  /api/_reset_testdata.php?confirm=YES\n";
    exit;
}

try {
    $pdo = db();
    $report = [];

    // Projects
    $n = $pdo->exec("DELETE FROM projects");
    $report[] = "projects deleted: " . (int)$n;

    // Quotations
    $n = $pdo->exec("DELETE FROM quotations");
    $report[] = "quotations deleted: " . (int)$n;

    // Quotation counters live in the summary table under skey LIKE 'qtn_counter/%'.
    // Also clear the dashboard summary blob so it recomputes fresh.
    $n = $pdo->exec("DELETE FROM summary WHERE skey LIKE 'qtn_counter/%' OR skey = 'summary'");
    $report[] = "counters + summary rows deleted: " . (int)$n;

    // Activity + auth logs
    $n = $pdo->exec("DELETE FROM activity_log");
    $report[] = "activity_log deleted: " . (int)$n;
    $n = $pdo->exec("DELETE FROM auth_log");
    $report[] = "auth_log deleted: " . (int)$n;

    // Users are intentionally KEPT.
    $st = $pdo->query("SELECT COUNT(*) c FROM users");
    $u = $st->fetch();
    $report[] = "users kept: " . (int)($u['c'] ?? 0);

    echo "✓ Test data reset complete.\n\n";
    echo implode("\n", $report) . "\n\n";
    echo "Now DELETE this file (_reset_testdata.php) from the server.\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "Error: " . $e->getMessage() . "\n";
}
