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
//    dependent_tasks            dependent_tasks/<id>  (filters via body: projectId/status/assignee)
//    summary
//    activity_log               activity_log/<key>
//    auth_log                   auth_log/<key>
//
//  Returns Firebase-shaped results:
//    - a collection GET returns an object keyed by id  { id: {...}, ... }
//    - a single GET returns the record object (or null)
// ============================================================

require __DIR__ . '/db/conn.php';
require __DIR__ . '/permissions.php';

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

if (empty($_SESSION['uid']) || empty($_SESSION['role'])) {
    json_err('Not authenticated', 401);
}
// One session per user (see api/db/conn.php session_still_current): if
// someone signed into this same account elsewhere, that login's token
// overwrote this one's in the DB, so this request is now stale.
if (!session_still_current($_SESSION['uid'], $_SESSION['stoken'] ?? '')) {
    session_kill();
    json_err('This account signed in on another device/browser. You have been signed out here.', 401);
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
//  WRITE permission per collection (set/delete), from api/permissions.php
//  — the single source of truth, mirrored client-side in
//  shared/permissions.js. Reads are allowed for any collection the role
//  can reach via the UI; writes are the sensitive part and are locked
//  down here regardless of what the browser claims. super_admin may do
//  everything.
if ($op === 'set' || $op === 'delete' || $op === 'increment') {
    if (!rbac_can_write($collection, $ROLE)) {
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

        // ─────────────────── DEPENDENT TASKS ───────────────────
        case 'dependent_tasks':
            handleDependentTasks($op, $seg, $data, $company);
            break;

        // ───────────────────────── SUMMARY ─────────────────────
        case 'summary':
            handleSummary($op, $seg, $data, $company);
            break;

        // ─────────────────── QUOTATION COUNTERS ────────────────
        case 'qtn_counter':
            handleCounter($op, $seg, $data, $company);
            break;

        // ─────────────── DROPDOWN OPTION LISTS ─────────────────
        case 'options':
            handleOptions($op, $seg, $data, $company);
            break;

        // ─────────────── RBAC MATRIX OVERRIDES ─────────────────
        case 'rbac':
            handleRbac($op, $seg, $data, $company);
            break;

        // ──────────────────── ACTIVITY / AUTH LOG ──────────────
        case 'activity_log':
        case 'auth_log':
            handleLog($collection, $op, $seg, $data, $company);
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
        // full upsert — team column may not exist yet if the migration
        // hasn't been run; try with it first, fall back without it.
        try {
            $st = $pdo->prepare(
                "INSERT INTO users (id,name,email,role,team,pin,active,assigned_projects,created_at)
                 VALUES (:id,:name,:email,:role,:team,:pin,:active,:ap,:created)
                 ON DUPLICATE KEY UPDATE
                   name=VALUES(name), email=VALUES(email), role=VALUES(role), team=VALUES(team),
                   pin=VALUES(pin), active=VALUES(active), assigned_projects=VALUES(assigned_projects)"
            );
            $st->execute([
                ':id'      => $id,
                ':name'    => $data['name'] ?? '',
                ':email'   => $data['email'] ?? '',
                ':role'    => $data['role'] ?? '',
                ':team'    => $data['team'] ?? '',
                ':pin'     => $data['pin'] ?? '',
                ':active'  => !empty($data['active']) ? 1 : 0,
                ':ap'      => json_encode($data['assignedProjects'] ?? []),
                ':created' => fmtTs($data['createdAt'] ?? null),
            ]);
        } catch (Throwable $e) {
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
        }
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

// ── DEPENDENT TASKS ──────────────────────────────────────────
// Same hybrid pattern as handleProjects — stable columns for filtering
// (project, status, priority, assignee) + a JSON "data" column for the
// full record (description, progress, raised-by, status history, etc.).
function depTaskRowOut($r) {
    $out = json_decode($r['data'], true);
    if (!is_array($out)) $out = [];
    $out['id'] = $r['id'];
    $out['projectId'] = $r['project_id'];
    $out['title'] = $r['title'];
    $out['status'] = $r['status'];
    $out['priority'] = $r['priority'];
    $out['assigneeType'] = $r['assignee_type'];
    $out['assignee'] = $r['assignee'];
    $out['dueDate'] = $r['due_date'];
    $out['createdAt'] = $r['created_at'];
    $out['updatedAt'] = $r['updated_at'];
    return $out;
}
function handleDependentTasks($op, $seg, $data, $company) {
    $pdo = db();
    $id = $seg[1] ?? null;

    if ($op === 'get') {
        if ($id) {
            $st = $pdo->prepare("SELECT * FROM dependent_tasks WHERE company=? AND id=?");
            $st->execute([$company, $id]);
            $r = $st->fetch();
            json_out($r ? depTaskRowOut($r) : null);
        }
        // $data doubles as the filter object, same convention as handleLog.
        $f = is_array($data) ? $data : [];
        $where = ['company = ?']; $params = [$company];
        if (!empty($f['projectId'])) { $where[] = 'project_id = ?'; $params[] = $f['projectId']; }
        if (!empty($f['status']) && $f['status'] !== 'all') { $where[] = 'status = ?'; $params[] = $f['status']; }
        if (!empty($f['assignee'])) { $where[] = 'assignee = ?'; $params[] = $f['assignee']; }
        if (!empty($f['assigneeType'])) { $where[] = 'assignee_type = ?'; $params[] = $f['assigneeType']; }
        $sql = "SELECT * FROM dependent_tasks WHERE " . implode(' AND ', $where) . " ORDER BY created_at DESC";
        $st = $pdo->prepare($sql);
        $st->execute($params);
        json_out(array_map('depTaskRowOut', $st->fetchAll()));
    }

    if ($op === 'set') {
        if (!$id) json_err('dependent_tasks set requires an id');
        $rec = is_array($data) ? $data : [];
        $st = $pdo->prepare(
            "INSERT INTO dependent_tasks
               (id,company,project_id,title,status,priority,assignee_type,assignee,due_date,data)
             VALUES (:id,:co,:pid,:title,:status,:priority,:atype,:assignee,:due,:data)
             ON DUPLICATE KEY UPDATE
               project_id=VALUES(project_id), title=VALUES(title), status=VALUES(status),
               priority=VALUES(priority), assignee_type=VALUES(assignee_type),
               assignee=VALUES(assignee), due_date=VALUES(due_date), data=VALUES(data)"
        );
        $st->execute([
            ':id'       => $id,
            ':co'       => $company,
            ':pid'      => (string)($rec['projectId'] ?? ''),
            ':title'    => (string)($rec['title'] ?? ''),
            ':status'   => (string)($rec['status'] ?? 'Open'),
            ':priority' => (string)($rec['priority'] ?? 'Medium'),
            ':atype'    => (string)($rec['assigneeType'] ?? 'department'),
            ':assignee' => (string)($rec['assignee'] ?? ''),
            ':due'      => fmtDate($rec['dueDate'] ?? null),
            ':data'     => json_encode($rec),
        ]);
        json_out(true);
    }

    if ($op === 'delete') {
        if (!$id) json_err('dependent_tasks delete requires an id');
        $pdo->prepare("DELETE FROM dependent_tasks WHERE company=? AND id=?")->execute([$company, $id]);
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

// RBAC matrix overrides — the editable "who can do what" table in Manage
// Users. Stored the same way as options (one JSON blob in `summary`), but
// as its OWN collection with its own write rule (super_admin only — see
// $WRITE_RULES below) rather than piggybacking on `options`, which many
// more roles can write to. This ONLY overrides MODULE_ACCESS/CAPABILITIES
// (client-side gates) — collection-level write permissions
// (RBAC_WRITE_RULES in permissions.php) are NOT editable here; that's the
// deeper security boundary and stays hardcoded on purpose.
function handleRbac($op, $seg, $data, $company) {
    $pdo = db();
    $key = 'rbac_matrix';
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
    if ($op === 'increment') {
        // Atomic "give me the next number": two requests arriving at the
        // same instant (e.g. two Proposals users both hitting "New
        // Quotation" for the same category) must never receive the same
        // sequence number. A plain get-then-set from the client can't
        // guarantee that (two reads can both see the same old value before
        // either write lands) — so this is one locked transaction instead.
        $startSeq = isset($data['startSeq']) ? (int)$data['startSeq'] : 1;
        // Ensure the row exists first — INSERT IGNORE is safe if two
        // requests race here, only one insert wins — so the FOR UPDATE
        // lock below always has a real row to lock, even on the very
        // first-ever use of this counter.
        $pdo->prepare("INSERT IGNORE INTO summary (company,skey,data) VALUES (?,?,?)")
            ->execute([$company, $key, json_encode(['seq' => $startSeq, 'updatedAt' => date('c')])]);
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare("SELECT data FROM summary WHERE company=? AND skey=? FOR UPDATE");
            $st->execute([$company, $key]);
            $r = $st->fetch();
            $cur = $r ? json_decode($r['data'], true) : null;
            $seq = ($cur && isset($cur['seq'])) ? (int)$cur['seq'] : $startSeq;
            $up = $pdo->prepare("UPDATE summary SET data=? WHERE company=? AND skey=?");
            $up->execute([json_encode(['seq' => $seq + 1, 'updatedAt' => date('c')]), $company, $key]);
            $pdo->commit();
            json_out(['seq' => $seq]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            json_err('Counter increment failed', 500);
        }
    }
}

function handleSummary($op, $seg, $data, $company) {
    $pdo = db();
    if ($op === 'get') {
        $st = $pdo->prepare("SELECT data FROM summary WHERE company=? AND skey='summary'");
        $st->execute([$company]);
        $r = $st->fetch();
        $rec = $r ? json_decode($r['data'], true) : [];
        if (!is_array($rec)) $rec = [];
        // Sub-path read, e.g. summary/2026-07/fitout — walk into the nested
        // structure instead of always returning the whole blob (that bug
        // meant a monthly/category counter update was silently landing on
        // the ROOT of the blob instead of its proper nested slot).
        if (isset($seg[1])) {
            $ref = $rec;
            foreach (array_slice($seg, 1) as $k) {
                if (!is_array($ref) || !isset($ref[$k])) { $ref = null; break; }
                $ref = $ref[$k];
            }
            json_out($ref);
        }
        json_out($rec ?: null);
    }
    if ($op === 'set') {
        if (isset($seg[1])) {
            // Sub-path write: load, update ONLY that nested key, save back —
            // same merge-not-overwrite pattern as handleProjects.
            $st = $pdo->prepare("SELECT data FROM summary WHERE company=? AND skey='summary'");
            $st->execute([$company]);
            $r = $st->fetch();
            $rec = $r ? json_decode($r['data'], true) : [];
            if (!is_array($rec)) $rec = [];
            $keys = array_slice($seg, 1);
            $ref =& $rec;
            for ($i = 0; $i < count($keys) - 1; $i++) {
                $k = $keys[$i];
                if (!isset($ref[$k]) || !is_array($ref[$k])) $ref[$k] = [];
                $ref =& $ref[$k];
            }
            $ref[$keys[count($keys) - 1]] = $data;
            unset($ref);
            $st2 = $pdo->prepare(
                "INSERT INTO summary (company,skey,data) VALUES (?,'summary',?)
                 ON DUPLICATE KEY UPDATE data=VALUES(data)"
            );
            $st2->execute([$company, json_encode($rec)]);
            json_out(true);
        }
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

// Structured, indexed activity/auth log — real columns instead of an
// opaque JSON blob, so filtering actually happens in SQL (fast, scales)
// instead of pulling every row and filtering in the browser.
function handleLog($table, $op, $seg, $data, $company) {
    if ($table !== 'activity_log' && $table !== 'auth_log') {
        json_err('Invalid log table', 400);
    }
    $pdo = db();
    $isActivity = ($table === 'activity_log');
    $key = $seg[1] ?? null;   // legacy: a specific row id, if ever addressed directly

    if ($op === 'get') {
        if ($key) {
            $st = $pdo->prepare("SELECT * FROM {$table} WHERE id=? AND company=?");
            $st->execute([$key, $company]);
            $r = $st->fetch();
            json_out($r ? logRowOut($r, $isActivity) : null);
        }
        // $data doubles as the filter object for a log query — never cached
        // client-side, so a fresh filtered read every time.
        $f = is_array($data) ? $data : [];
        $where = ['company = ?']; $params = [$company];
        if ($isActivity && !empty($f['module']) && $f['module'] !== 'all') { $where[] = 'module = ?'; $params[] = $f['module']; }
        if ($isActivity && !empty($f['projectId'])) { $where[] = 'project_id = ?'; $params[] = $f['projectId']; }
        if (!empty($f['actor'])) { $where[] = 'actor = ?'; $params[] = $f['actor']; }
        if (!empty($f['from'])) { $where[] = 'at >= ?'; $params[] = $f['from']; }
        if (!empty($f['to'])) { $where[] = 'at <= ?'; $params[] = $f['to']; }
        if (!empty($f['q'])) {
            $cols = $isActivity ? ['action','actor_name','target','detail','module'] : ['action','actor_name','target','detail'];
            $ors = [];
            foreach ($cols as $c) { $ors[] = "{$c} LIKE ?"; $params[] = '%' . $f['q'] . '%'; }
            $where[] = '(' . implode(' OR ', $ors) . ')';
        }
        $limit = min(500, max(1, (int)($f['limit'] ?? 300)));
        $sql = "SELECT * FROM {$table} WHERE " . implode(' AND ', $where) . " ORDER BY at DESC, id DESC LIMIT {$limit}";
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll();
        json_out(array_map(fn($r) => logRowOut($r, $isActivity), $rows));
    }

    if ($op === 'set') {
        $e = is_array($data) ? $data : [];
        if ($isActivity) {
            $st = $pdo->prepare(
                "INSERT INTO activity_log (at,company,module,action,actor,actor_name,role,target,detail,project_id,meta)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)"
            );
            $st->execute([
                fmtTs($e['at'] ?? null), $company,
                (string)($e['module'] ?? ''), (string)($e['action'] ?? ''),
                (string)($e['by'] ?? ''), (string)($e['byName'] ?? ''), (string)($e['role'] ?? ''),
                (string)($e['target'] ?? ''), $e['detail'] ?? null,
                (string)($e['projectId'] ?? ''),
                (isset($e['changes']) && $e['changes']) ? json_encode($e['changes']) : null,
            ]);
        } else {
            $st = $pdo->prepare(
                "INSERT INTO auth_log (at,company,action,actor,actor_name,target,detail,meta)
                 VALUES (?,?,?,?,?,?,?,?)"
            );
            $st->execute([
                fmtTs($e['at'] ?? null), $company,
                (string)($e['action'] ?? ''), (string)($e['by'] ?? ''), (string)($e['byName'] ?? ''),
                (string)($e['target'] ?? ''), $e['detail'] ?? null,
                (isset($e['changes']) && $e['changes']) ? json_encode($e['changes']) : null,
            ]);
        }
        json_out(true);
    }

    if ($op === 'delete') {
        $f = is_array($data) ? $data : [];
        if (!empty($f['mode']) && $f['mode'] !== 'all' && preg_match('/^older_(\d+)d$/', $f['mode'], $m)) {
            $days = (int)$m[1];
            $pdo->prepare("DELETE FROM {$table} WHERE company=? AND at < DATE_SUB(NOW(), INTERVAL ? DAY)")->execute([$company, $days]);
            json_out(true);
        }
        if ($isActivity && !empty($f['projectId'])) {
            $pdo->prepare("DELETE FROM activity_log WHERE company=? AND project_id=?")->execute([$company, $f['projectId']]);
            json_out(true);
        }
        if ($key) { $pdo->prepare("DELETE FROM {$table} WHERE id=? AND company=?")->execute([$key, $company]); json_out(true); }
        $pdo->prepare("DELETE FROM {$table} WHERE company=?")->execute([$company]);  // clear whole log for this company
        json_out(true);
    }
}
// Shape a DB row back into the same field names the client already
// understands (matches the old JSON-blob entry shape, so no client-side
// rewrite needed beyond how the request itself is made).
function logRowOut($r, $isActivity) {
    $out = [
        'id'     => (int)$r['id'],
        'at'     => str_replace(' ', 'T', $r['at']) . (strpos($r['at'], '.') === false ? '.000Z' : 'Z'),
        'action' => $r['action'], 'by' => $r['actor'], 'byName' => $r['actor_name'],
        'target' => $r['target'], 'detail' => $r['detail'],
    ];
    if ($isActivity) {
        $out['module'] = $r['module']; $out['role'] = $r['role']; $out['projectId'] = $r['project_id'];
    }
    if (!empty($r['meta'])) $out['changes'] = json_decode($r['meta'], true);
    return $out;
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
        'team'             => $r['team'] ?? '',
        'pin'              => $r['pin'],
        'active'           => (bool)$r['active'],
        'assignedProjects' => $r['assigned_projects'] ? json_decode($r['assigned_projects'], true) : [],
        'createdAt'        => $r['created_at'],
    ];
}
function mapUserField($field) {
    $map = ['active' => 'active', 'pin' => 'pin', 'role' => 'role',
            'name' => 'name', 'email' => 'email', 'team' => 'team'];
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
