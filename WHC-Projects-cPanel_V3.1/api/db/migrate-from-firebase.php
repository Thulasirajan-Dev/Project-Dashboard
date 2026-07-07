<?php
// ============================================================
//  Winner Holistic Consultants – One-time Firebase → MySQL import
//  api/db/migrate-from-firebase.php
//
//  Pulls your existing Firebase Realtime Database data and inserts
//  it into the new MySQL tables. RUN ONCE, then DELETE this file.
//
//  HOW TO RUN:
//   1. Make sure schema.sql is already imported and db.config.php
//      is filled in.
//   2. Set the FIREBASE_EXPORT_URL below to your database's REST
//      root (the value that used to be in config.js), e.g.
//      https://whc-project-6e1b8-default-rtdb.firebaseio.com
//      — If your DB rules require auth, append ?auth=YOUR_DB_SECRET
//   3. Visit  https://projects.winnerhc.com/api/db/migrate-from-firebase.php?go=1
//      (temporarily comment out the db/ block in api/.htaccess, or
//       run via cron / cPanel Terminal, to reach it.)
//   4. Review the printed counts, then DELETE this file.
//
//  Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE.
// ============================================================

require __DIR__ . '/conn.php';

$FIREBASE_EXPORT_URL = 'https://whc-project-6e1b8-default-rtdb.firebaseio.com'; // ← your test DB root (no trailing slash)

header('Content-Type: text/plain');

if (($_GET['go'] ?? '') !== '1') {
    echo "Add ?go=1 to run. This imports Firebase data into MySQL.\n";
    echo "Source: {$FIREBASE_EXPORT_URL}\n";
    exit;
}

function fb_fetch($base, $path) {
    $url = rtrim($base, '/') . '/' . $path . '.json';
    // If your rules need a secret: $url .= '?auth=YOUR_DB_SECRET';
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60]);
    $r = curl_exec($ch);
    curl_close($ch);
    return $r === false ? null : json_decode($r, true);
}

$pdo = db();
$counts = [];

// Companies map to path prefixes
$companies = ['whc' => '', 'mw' => 'mw/', 'whsf' => 'whsf/'];

// ── users (global, no company prefix) ─────────────────────────
$users = fb_fetch($FIREBASE_EXPORT_URL, 'users') ?: [];
$n = 0;
foreach ($users as $id => $u) {
    $st = $pdo->prepare(
        "INSERT INTO users (id,name,email,role,pin,active,assigned_projects,created_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),email=VALUES(email),role=VALUES(role),
           pin=VALUES(pin),active=VALUES(active),assigned_projects=VALUES(assigned_projects)"
    );
    $st->execute([
        $u['id'] ?? $id, $u['name'] ?? '', $u['email'] ?? '', $u['role'] ?? '',
        $u['pin'] ?? '', !empty($u['active']) ? 1 : 0,
        json_encode($u['assignedProjects'] ?? []),
        !empty($u['createdAt']) ? date('Y-m-d H:i:s', strtotime($u['createdAt'])) : date('Y-m-d H:i:s'),
    ]);
    $n++;
}
$counts['users'] = $n;

// ── projects + quotations per company ─────────────────────────
$catMap = ['fitout' => 'fitout', 'id' => 'id', 'live' => 'live', 'private' => 'private'];
foreach ($companies as $co => $prefix) {

    // projects
    $projects = fb_fetch($FIREBASE_EXPORT_URL, $prefix . 'projects') ?: [];
    $n = 0;
    foreach ($projects as $id => $p) {
        $st = $pdo->prepare(
            "INSERT INTO projects (id,company,title,client,status,coordinator,project_type,erp_project_id,start_date,end_date,data)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE title=VALUES(title),client=VALUES(client),status=VALUES(status),
               coordinator=VALUES(coordinator),project_type=VALUES(project_type),
               erp_project_id=VALUES(erp_project_id),start_date=VALUES(start_date),
               end_date=VALUES(end_date),data=VALUES(data)"
        );
        $st->execute([
            $id, $co,
            $p['title'] ?? ($p['projectName'] ?? null),
            $p['client'] ?? ($p['customer'] ?? null),
            $p['status'] ?? null,
            $p['coordinator'] ?? ($p['coordName'] ?? null),
            $p['projectType'] ?? ($p['type'] ?? null),
            $p['erpProjectId'] ?? null,
            !empty($p['startDate']) ? date('Y-m-d', strtotime($p['startDate'])) : null,
            !empty($p['endDate'])   ? date('Y-m-d', strtotime($p['endDate']))   : null,
            json_encode($p),
        ]);
        $n++;
    }
    $counts["projects[$co]"] = $n;

    // quotations
    foreach ($catMap as $cat => $_) {
        $qs = fb_fetch($FIREBASE_EXPORT_URL, $prefix . 'quotations/' . $cat) ?: [];
        $n = 0;
        foreach ($qs as $id => $q) {
            $st = $pdo->prepare(
                "INSERT INTO quotations (id,company,category,qtn_number,client,status,gross_amount,net_amount,data)
                 VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE qtn_number=VALUES(qtn_number),client=VALUES(client),
                   status=VALUES(status),gross_amount=VALUES(gross_amount),net_amount=VALUES(net_amount),data=VALUES(data)"
            );
            $st->execute([
                $id, $co, $cat,
                $q['qtn_number'] ?? null,
                $q['client'] ?? ($q['client_name'] ?? null),
                $q['status'] ?? null,
                isset($q['gross_amount']) ? (float)$q['gross_amount'] : null,
                isset($q['net_amount'])   ? (float)$q['net_amount']   : null,
                json_encode($q),
            ]);
            $n++;
        }
        $counts["quotations[$co/$cat]"] = $n;
    }

    // summary
    $sum = fb_fetch($FIREBASE_EXPORT_URL, $prefix . 'summary');
    if ($sum !== null) {
        $pdo->prepare("INSERT INTO summary (company,skey,data) VALUES (?,'summary',?)
                       ON DUPLICATE KEY UPDATE data=VALUES(data)")
            ->execute([$co, json_encode($sum)]);
        $counts["summary[$co]"] = 1;
    }
}

// ── activity_log + auth_log (global) ──────────────────────────
foreach (['activity_log', 'auth_log'] as $table) {
    $log = fb_fetch($FIREBASE_EXPORT_URL, $table) ?: [];
    $n = 0;
    foreach ($log as $key => $row) {
        $at = !empty($row['at']) ? strtotime($row['at']) : (!empty($row['time']) ? strtotime($row['time']) : time());
        $st = $pdo->prepare("INSERT INTO {$table} (id,at,data) VALUES (?,?,?)
                             ON DUPLICATE KEY UPDATE data=VALUES(data)");
        $st->execute([$key, date('Y-m-d H:i:s', $at ?: time()), json_encode($row)]);
        $n++;
    }
    $counts[$table] = $n;
}

echo "Import complete.\n\n";
foreach ($counts as $k => $v) echo str_pad($k, 28) . " : $v\n";
echo "\n⚠️  DELETE this file now (api/db/migrate-from-firebase.php).\n";
