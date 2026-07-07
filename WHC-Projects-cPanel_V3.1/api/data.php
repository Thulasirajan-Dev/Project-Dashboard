<?php
// ============================================================
//  Winner Holistic Consultants – Data API (replaces Firebase)
//  api/data.php
//
//  The browser's fb-style helpers call this with a JSON body:
//    { op: "get"|"set"|"delete", path: "projects/p123", data: {...} }
//
//  Paths supported (company prefix optional: "mw/" | "whsf/"):
//    users                      users/<id>   users/<id>/<field>
//    projects                   projects/<id>
//    quotations/<cat>           quotations/<cat>/<id>
//    summary
//    activity_log               activity_log/<key>
//    auth_log                   auth_log/<key>
//
//  Returns Firebase-shaped results:
//    - a collection GET returns an object keyed by id  { id: {...}, ... }
//    - a single GET returns the record object (or null)
// ============================================================

require __DIR__ . '/db/conn.php';

// ── CORS ──────────────────────────────────────────────────────
$cfg = require __DIR__ . '/config.secret.php';
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
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('Method not allowed', 405);

// ── Require a valid server session ────────────────────────────
//  Access control is enforced HERE, on the server, not in the
//  browser. A forged/edited request without a real session cookie
//  gets nothing. This is the real lock behind the UI.
session_set_cookie_params([
    'lifetime' => 0, 'path' => '/', 'secure' => ($cfg['COOKIE_SECURE'] ?? true),
    'httponly' => true, 'samesite' => 'Strict',
]);
session_name('WHCSESS');
session_start();

if (empty($_SESSION['uid']) || empty($_SESSION['role'])) {
    json_err('Not authenticated', 401);
}
$ROLE = $_SESSION['role'];

$req  = body();
$op   = $req['op']   ?? '';
$path = trim($req['path'] ?? '', '/');
$data = $req['data'] ?? null;
if ($path === '') json_err('Missing path');

// ── Split off company prefix (mw/ or whsf/) ───────────────────
$company = 'whc';
foreach (['mw', 'whsf'] as $co) {
    if (strpos($path, $co . '/') === 0) { $company = $co; $path = substr($path, strlen($co) + 1); }
}
$seg = explode('/', $path);
$collection = $seg[0] ?? '';

// ── Server-side authorization matrix ──────────────────────────
//  WRITE permission per collection (set/delete). Reads are allowed
//  for any collection the role can reach via the UI; writes are the
//  sensitive part and are locked down here regardless of what the
//  browser claims. super_admin may do everything.
$WRITE_RULES = [
    'users'        => ['super_admin'],
    'projects'     => ['super_admin', 'coordinator', 'account'], // account edits LPO/credit fields; proposals stays view-only
    'quotations'   => ['super_admin', 'proposals'],
    'qtn_counter'  => ['super_admin', 'proposals', 'coordinator'], // coordinator mints revision numbers
    'options'      => ['super_admin', 'proposals', 'coordinator', 'account'], // anyone can add dropdown options
    'summary'      => ['super_admin'],
    'activity_log' => ['super_admin', 'proposals', 'coordinator', 'account'], // anyone logged in may append
    'auth_log'     => ['super_admin', 'proposals', 'coordinator', 'account'],
];
if ($op === 'set' || $op === 'delete') {
    $allowed = $WRITE_RULES[$collection] ?? ['super_admin'];
    if ($ROLE !== 'super_admin' && !in_array($ROLE, $allowed, true)) {
        json_err('Your role is not permitted to modify ' . $collection, 403);
    }
}

try {
    switch ($collection) {

        // ──────────────────────────── USERS ────────────────────
        case 'users':
            handleUsers($op, $seg, $data);
            break;

        // ──────────────────────── PROJECTS ─────────────────────
        case 'projects':
            handleProjects($op, $seg, $data, $company);
            break;

        // ─────────────────────── QUOTATIONS ────────────────────
        case 'quotations':
            handleQuotations($op, $seg, $data, $company);
            break;

        // ───────────────────────── SUMMARY ─────────────────────
        case 'summary':
            handleSummary($op, $data, $company);
            break;

        // ─────────────────── QUOTATION COUNTERS ────────────────
        case 'qtn_counter':
            handleCounter($op, $seg, $data, $company);
            break;

        // ─────────────── DROPDOWN OPTION LISTS ─────────────────
        case 'options':
            handleOptions($op, $seg, $data, $company);
            break;

        // ──────────────────── ACTIVITY / AUTH LOG ──────────────
        case 'activity_log':
        case 'auth_log':
            handleLog($collection, $op, $seg, $data);
            break;

        default:
            json_err('Unknown collection: ' . $collection);
    }
} catch (Throwable $e) {
    // Log the real error server-side; return a generic message to the client
    // so we don't leak schema/SQL details.
    error_log('WHC data.php error: ' . $e->getMessage());
    json_err('Server error', 500);
}

// ============================================================
//  Handlers
// ============================================================

function handleUsers($op, $seg, $data) {
    $pdo = db();
    $id    = $seg[1] ?? null;
    $field = $seg[2] ?? null;   // users/<id>/<field> single-field write

    if ($op === 'get') {
        if (!$id) {
            // whole collection -> { id: {...} }
            $rows = $pdo->query("SELECT * FROM users")->fetchAll();
            $out = [];
            foreach ($rows as $r) $out[$r['id']] = userRow($r);
            json_out($out ?: null);
        }
        $st = $pdo->prepare("SELECT * FROM users WHERE id=?");
        $st->execute([$id]);
        $r = $st->fetch();
        if (!$r) json_out(null);
        if ($field) json_out($r[mapUserField($field)] ?? null);
        json_out(userRow($r));
    }

    if ($op === 'set') {
        if (!$id) json_err('users set requires an id');
        if ($field) {
            // single-field update (active / pin / role)
            $col = mapUserField($field);
            $val = is_bool($data) ? ($data ? 1 : 0) : $data;
            $st = $pdo->prepare("UPDATE users SET {$col}=? WHERE id=?");
            $st->execute([$val, $id]);
            json_out(true);
        }
        // full upsert
        $st = $pdo->prepare(
            "INSERT INTO users (id,name,email,role,pin,active,assigned_projects,created_at)
             VALUES (:id,:name,:email,:role,:pin,:active,:ap,:created)
             ON DUPLICATE KEY UPDATE
               name=VALUES(name), email=VALUES(email), role=VALUES(role),
               pin=VALUES(pin), active=VALUES(active), assigned_projects=VALUES(assigned_projects)"
        );
        $st->execute([
            ':id'      => $id,
            ':name'    => $data['name'] ?? '',
            ':email'   => $data['email'] ?? '',
            ':role'    => $data['role'] ?? '',
            ':pin'     => $data['pin'] ?? '',
            ':active'  => !empty($data['active']) ? 1 : 0,
            ':ap'      => json_encode($data['assignedProjects'] ?? []),
            ':created' => fmtTs($data['createdAt'] ?? null),
        ]);
        json_out(true);
    }

    if ($op === 'delete') {
        if (!$id) json_err('users delete requires an id');
        $pdo->prepare("DELETE FROM users WHERE id=?")->execute([$id]);
        json_out(true);
    }
}

function handleProjects($op, $seg, $data, $company) {
    $pdo = db();
    $id = $seg[1] ?? null;

    if ($op === 'get') {
        if (!$id) {
            $st = $pdo->prepare("SELECT id,data FROM projects WHERE company=?");
            $st->execute([$company]);
            $out = [];
            foreach ($st->fetchAll() as $r) $out[$r['id']] = json_decode($r['data'], true);
            json_out($out ?: null);
        }
        $st = $pdo->prepare("SELECT data FROM projects WHERE company=? AND id=?");
        $st->execute([$company, $id]);
        $r = $st->fetch();
        json_out($r ? json_decode($r['data'], true) : null);
    }

    if ($op === 'set') {
        if (!$id) json_err('projects set requires an id');

        // Sub-path write, e.g. projects/ID/quotationGroups or projects/ID/project/title.
        // Load the existing record, update ONLY that nested key, and save back —
        // never overwrite the whole project with a fragment.
        if (isset($seg[2])) {
            $st = $pdo->prepare("SELECT data FROM projects WHERE company=? AND id=?");
            $st->execute([$company, $id]);
            $row = $st->fetch();
            $rec = $row ? json_decode($row['data'], true) : [];
            if (!is_array($rec)) $rec = [];
            // Walk/set the nested path (seg[2], seg[3], …).
            $keys = array_slice($seg, 2);
            $ref =& $rec;
            for ($i = 0; $i < count($keys) - 1; $i++) {
                $k = $keys[$i];
                if (!isset($ref[$k]) || !is_array($ref[$k])) $ref[$k] = [];
                $ref =& $ref[$k];
            }
            $ref[$keys[count($keys) - 1]] = $data;
            unset($ref);

            $st2 = $pdo->prepare(
                "INSERT INTO projects
                   (id,company,title,client,status,coordinator,project_type,erp_project_id,start_date,end_date,data)
                 VALUES (:id,:co,:title,:client,:status,:coord,:ptype,:erp,:sd,:ed,:data)
                 ON DUPLICATE KEY UPDATE
                   title=VALUES(title), client=VALUES(client), status=VALUES(status),
                   coordinator=VALUES(coordinator), project_type=VALUES(project_type),
                   erp_project_id=VALUES(erp_project_id), start_date=VALUES(start_date),
                   end_date=VALUES(end_date), data=VALUES(data)"
            );
            $proj = $rec['project'] ?? [];
            $st2->execute([
                ':id'    => $id,
                ':co'    => $company,
                ':title' => $proj['title']   ?? ($rec['title'] ?? null),
                ':client'=> $proj['client']  ?? ($rec['client'] ?? null),
                ':status'=> $rec['status']   ?? null,
                ':coord' => $proj['coordinator'] ?? ($rec['coordinator'] ?? null),
                ':ptype' => $rec['projectType'] ?? null,
                ':erp'   => $rec['erpProjectId'] ?? null,
                ':sd'    => fmtDate($rec['startDate'] ?? null),
                ':ed'    => fmtDate($rec['endDate'] ?? null),
                ':data'  => json_encode($rec),
            ]);
            json_out(true);
        }

        $st = $pdo->prepare(
            "INSERT INTO projects
               (id,company,title,client,status,coordinator,project_type,erp_project_id,start_date,end_date,data)
             VALUES (:id,:co,:title,:client,:status,:coord,:ptype,:erp,:sd,:ed,:data)
             ON DUPLICATE KEY UPDATE
               title=VALUES(title), client=VALUES(client), status=VALUES(status),
               coordinator=VALUES(coordinator), project_type=VALUES(project_type),
               erp_project_id=VALUES(erp_project_id), start_date=VALUES(start_date),
               end_date=VALUES(end_date), data=VALUES(data)"
        );
        $st->execute([
            ':id'    => $id,
            ':co'    => $company,
            ':title' => $data['title']        ?? ($data['projectName'] ?? null),
            ':client'=> $data['client']       ?? ($data['customer'] ?? null),
            ':status'=> $data['status']       ?? null,
            ':coord' => $data['coordinator']  ?? ($data['coordName'] ?? null),
            ':ptype' => $data['projectType']  ?? ($data['type'] ?? null),
            ':erp'   => $data['erpProjectId'] ?? null,
            ':sd'    => fmtDate($data['startDate'] ?? null),
            ':ed'    => fmtDate($data['endDate'] ?? null),
            ':data'  => json_encode($data),
        ]);
        json_out(true);
    }

    if ($op === 'delete') {
        if (!$id) json_err('projects delete requires an id');
        $pdo->prepare("DELETE FROM projects WHERE company=? AND id=?")->execute([$company, $id]);
        json_out(true);
    }
}

function handleQuotations($op, $seg, $data, $company) {
    $pdo = db();
    $cat = $seg[1] ?? null;       // fitout | id | live | private
    $id  = $seg[2] ?? null;
    if (!$cat) json_err('quotations path requires a category');

    if ($op === 'get') {
        if (!$id) {
            $st = $pdo->prepare("SELECT id,data FROM quotations WHERE company=? AND category=?");
            $st->execute([$company, $cat]);
            $out = [];
            foreach ($st->fetchAll() as $r) $out[$r['id']] = json_decode($r['data'], true);
            json_out($out ?: null);
        }
        $st = $pdo->prepare("SELECT data FROM quotations WHERE company=? AND category=? AND id=?");
        $st->execute([$company, $cat, $id]);
        $r = $st->fetch();
        json_out($r ? json_decode($r['data'], true) : null);
    }

    if ($op === 'set') {
        if (!$id) json_err('quotations set requires an id');
        $st = $pdo->prepare(
            "INSERT INTO quotations
               (id,company,category,qtn_number,client,status,gross_amount,net_amount,data)
             VALUES (:id,:co,:cat,:qtn,:client,:status,:gross,:net,:data)
             ON DUPLICATE KEY UPDATE
               qtn_number=VALUES(qtn_number), client=VALUES(client), status=VALUES(status),
               gross_amount=VALUES(gross_amount), net_amount=VALUES(net_amount), data=VALUES(data)"
        );
        $st->execute([
            ':id'     => $id,
            ':co'     => $company,
            ':cat'    => $cat,
            ':qtn'    => $data['qtn_number'] ?? null,
            ':client' => $data['client'] ?? ($data['client_name'] ?? null),
            ':status' => $data['status'] ?? null,
            ':gross'  => isset($data['gross_amount']) ? (float)$data['gross_amount'] : null,
            ':net'    => isset($data['net_amount'])   ? (float)$data['net_amount']   : null,
            ':data'   => json_encode($data),
        ]);
        json_out(true);
    }

    if ($op === 'delete') {
        if (!$id) json_err('quotations delete requires an id');
        $pdo->prepare("DELETE FROM quotations WHERE company=? AND category=? AND id=?")
            ->execute([$company, $cat, $id]);
        json_out(true);
    }
}

// Quotation counters — stored in the `summary` table under a per-counter
// skey (e.g. 'qtn_counter/fitout'), so no schema change is needed.
// Global dropdown option lists — stored in the `summary` table under a
// per-list skey (e.g. 'options/subcontractor_type'). Shared across all users.
function handleOptions($op, $seg, $data, $company) {
    $pdo = db();
    $key = 'options/' . implode('/', $seg);
    if ($op === 'get') {
        $st = $pdo->prepare("SELECT data FROM summary WHERE company=? AND skey=?");
        $st->execute([$company, $key]);
        $r = $st->fetch();
        json_out($r ? json_decode($r['data'], true) : null);
    }
    if ($op === 'set') {
        $st = $pdo->prepare(
            "INSERT INTO summary (company,skey,data) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE data=VALUES(data)"
        );
        $st->execute([$company, $key, json_encode($data)]);
        json_out(true);
    }
    if ($op === 'delete') {
        $pdo->prepare("DELETE FROM summary WHERE company=? AND skey=?")->execute([$company, $key]);
        json_out(true);
    }
}

function handleCounter($op, $seg, $data, $company) {
    $pdo = db();
    $key = implode('/', $seg);            // e.g. "qtn_counter/fitout"
    if ($op === 'get') {
        $st = $pdo->prepare("SELECT data FROM summary WHERE company=? AND skey=?");
        $st->execute([$company, $key]);
        $r = $st->fetch();
        json_out($r ? json_decode($r['data'], true) : null);
    }
    if ($op === 'set') {
        $st = $pdo->prepare(
            "INSERT INTO summary (company,skey,data) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE data=VALUES(data)"
        );
        $st->execute([$company, $key, json_encode($data)]);
        json_out(true);
    }
    if ($op === 'delete') {
        $pdo->prepare("DELETE FROM summary WHERE company=? AND skey=?")->execute([$company, $key]);
        json_out(true);
    }
}

function handleSummary($op, $data, $company) {
    $pdo = db();
    if ($op === 'get') {
        $st = $pdo->prepare("SELECT data FROM summary WHERE company=? AND skey='summary'");
        $st->execute([$company]);
        $r = $st->fetch();
        json_out($r ? json_decode($r['data'], true) : null);
    }
    if ($op === 'set') {
        $st = $pdo->prepare(
            "INSERT INTO summary (company,skey,data) VALUES (?,'summary',?)
             ON DUPLICATE KEY UPDATE data=VALUES(data)"
        );
        $st->execute([$company, json_encode($data)]);
        json_out(true);
    }
    if ($op === 'delete') {
        $pdo->prepare("DELETE FROM summary WHERE company=? AND skey='summary'")->execute([$company]);
        json_out(true);
    }
}

function handleLog($table, $op, $seg, $data) {
    // Defense in depth: only these two tables are ever valid here.
    if ($table !== 'activity_log' && $table !== 'auth_log') {
        json_err('Invalid log table', 400);
    }
    $pdo = db();
    $key = $seg[1] ?? null;

    if ($op === 'get') {
        if (!$key) {
            // whole log -> { key: {...} } ordered by time
            $rows = $pdo->query("SELECT id,data FROM {$table} ORDER BY at ASC")->fetchAll();
            $out = [];
            foreach ($rows as $r) $out[$r['id']] = json_decode($r['data'], true);
            json_out($out ?: null);
        }
        $st = $pdo->prepare("SELECT data FROM {$table} WHERE id=?");
        $st->execute([$key]);
        $r = $st->fetch();
        json_out($r ? json_decode($r['data'], true) : null);
    }

    if ($op === 'set') {
        if (!$key) json_err("{$table} set requires a key");
        $st = $pdo->prepare(
            "INSERT INTO {$table} (id,at,data) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE data=VALUES(data)"
        );
        $st->execute([$key, fmtTs($data['at'] ?? $data['time'] ?? null), json_encode($data)]);
        json_out(true);
    }

    if ($op === 'delete') {
        if (!$key) {
            $pdo->exec("DELETE FROM {$table}");   // clear whole log
            json_out(true);
        }
        $pdo->prepare("DELETE FROM {$table} WHERE id=?")->execute([$key]);
        json_out(true);
    }
}

// ============================================================
//  Small helpers
// ============================================================
function userRow($r) {
    return [
        'id'               => $r['id'],
        'name'             => $r['name'],
        'email'            => $r['email'],
        'role'             => $r['role'],
        'pin'              => $r['pin'],
        'active'           => (bool)$r['active'],
        'assignedProjects' => $r['assigned_projects'] ? json_decode($r['assigned_projects'], true) : [],
        'createdAt'        => $r['created_at'],
    ];
}
function mapUserField($field) {
    $map = ['active' => 'active', 'pin' => 'pin', 'role' => 'role',
            'name' => 'name', 'email' => 'email'];
    return $map[$field] ?? 'id';   // unknown field -> harmless
}
function fmtTs($v) {
    if (!$v) return date('Y-m-d H:i:s');
    $t = strtotime($v);
    return $t ? date('Y-m-d H:i:s', $t) : date('Y-m-d H:i:s');
}
function fmtDate($v) {
    if (!$v) return null;
    $t = strtotime($v);
    return $t ? date('Y-m-d', $t) : null;
}
