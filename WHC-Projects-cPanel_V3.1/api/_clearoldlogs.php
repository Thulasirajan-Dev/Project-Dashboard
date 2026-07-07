<?php
// ============================================================
//  ONE-TIME CLEANUP — DELETE THIS FILE AFTER USE.
//  Clears the old orphaned in-project log arrays (activityLog /
//  proposalLog) from every project's JSON. The app now stores all
//  activity in the central activity_log table, so these are dead data.
//
//  This does NOT touch the central activity_log table, and does NOT
//  remove any project, milestone, stage, or scope data — only the
//  two stale log arrays inside each project record.
//
//  Usage: upload to <subdomain>/api/_clearoldlogs.php, then visit
//         https://projects.winnerhc.com/api/_clearoldlogs.php
//         Read the summary, then DELETE this file.
// ============================================================

require __DIR__ . '/db/conn.php';
header('Content-Type: text/plain');

echo "WHC — clear orphaned in-project logs\n";
echo "====================================\n\n";

try {
    $pdo = db();
    $rows = $pdo->query("SELECT id, data FROM projects")->fetchAll(PDO::FETCH_ASSOC);
    echo "Projects found: " . count($rows) . "\n\n";

    $upd = $pdo->prepare("UPDATE projects SET data = ? WHERE id = ?");
    $cleared = 0;
    $entriesRemoved = 0;

    foreach ($rows as $r) {
        $d = json_decode($r['data'], true);
        if (!is_array($d)) continue;

        $before = 0;
        if (isset($d['activityLog']) && is_array($d['activityLog'])) $before += count($d['activityLog']);
        if (isset($d['proposalLog']) && is_array($d['proposalLog'])) $before += count($d['proposalLog']);

        if ($before === 0) continue;   // nothing to clear on this project

        // Reset the two stale arrays to empty (keep the keys so app code that
        // expects arrays still finds them).
        $d['activityLog'] = [];
        $d['proposalLog'] = [];

        $upd->execute([json_encode($d), $r['id']]);
        $cleared++;
        $entriesRemoved += $before;
        echo "Cleared project {$r['id']} — removed {$before} old log entries\n";
    }

    echo "\nDONE. Projects cleaned: {$cleared}. Old log entries removed: {$entriesRemoved}.\n";
    echo "The central activity_log table was NOT touched.\n";
    echo "\n>>> Now DELETE this file (api/_clearoldlogs.php) from the server. <<<\n";

} catch (Throwable $e) {
    http_response_code(500);
    echo "FAILED: " . $e->getMessage() . "\n";
    echo "No changes were committed for the failing row. Safe to retry after fixing.\n";
}
