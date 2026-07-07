<?php
// ============================================================
//  Winner Holistic Consultants – Frappe API Proxy (cPanel/PHP)
//  api/frappe.php
//
//  PHP port of the former netlify/functions/frappe.js.
//  Sits between the browser and Frappe Cloud. The API key/secret
//  NEVER reach the browser — they are read from config.secret.php
//  (or environment variables) on the server only.
//
//  Frontend calls this at:  /api/frappe.php
// ============================================================

// ---- Load secrets (file kept OUTSIDE web root if possible) ----
$cfg = require __DIR__ . '/config.secret.php';

$FRAPPE_URL    = $cfg['FRAPPE_URL']    ?? 'https://erp.winnerhc.com';
$FRAPPE_KEY    = $cfg['FRAPPE_API_KEY']    ?? '';
$FRAPPE_SECRET = $cfg['FRAPPE_API_SECRET'] ?? '';
$SITE_URL      = $cfg['SITE_URL'] ?? '*';

// ---- CORS headers ----
header('Access-Control-Allow-Origin: ' . $SITE_URL);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---- Require a valid login session ----
// This proxy uses our private Frappe API keys, so it must never be callable
// by anonymous visitors. Only authenticated app users may reach it.
session_set_cookie_params([
    'lifetime' => 0, 'path' => '/', 'secure' => ($cfg['COOKIE_SECURE'] ?? true),
    'httponly' => true, 'samesite' => 'Strict',
]);
session_name('WHCSESS');
session_start();
if (empty($_SESSION['uid'])) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Not authenticated']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ---- Check keys configured ----
if (!$FRAPPE_KEY || !$FRAPPE_SECRET) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'FRAPPE_API_KEY / FRAPPE_API_SECRET not set in config.secret.php']);
    exit;
}

// ---- Supported actions -> Frappe endpoints ----
$today    = (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d');
$plus60   = (new DateTime('now', new DateTimeZone('UTC')))->modify('+60 days')->format('Y-m-d');

$ACTIONS = [
    'employees' => [
        'endpoint' => '/api/resource/Employee',
        'params'   => [
            'fields'  => json_encode(['name','employee_name','designation','department','user_id']),
            'filters' => json_encode([['status','=','Active']]),
            'limit_page_length' => 200,
            'order_by' => 'employee_name asc',
        ],
    ],
    'projects' => [
        'endpoint' => '/api/resource/Project',
        'params'   => [
            'fields'  => json_encode(['name','project_name','customer','status','expected_start_date','expected_end_date','percent_complete']),
            'filters' => json_encode([['status','in','Open,In Progress']]),
            'limit_page_length' => 200,
            'order_by' => 'modified desc',
        ],
    ],
    'project_detail' => [
        'endpoint' => '/api/resource/Project/{name}',
        'params'   => [],
    ],
    'leaves' => [
        'endpoint' => '/api/resource/Leave Application',
        'params'   => [
            'fields'  => json_encode(['employee','employee_name','leave_type','from_date','to_date','status','total_leave_days']),
            'filters' => json_encode([
                ['status','=','Approved'],
                ['from_date','>=', $today],
                ['from_date','<=', $plus60],
            ]),
            'limit_page_length' => 200,
            'order_by' => 'from_date asc',
        ],
    ],
    'attendance' => [
        'endpoint' => '/api/resource/Attendance',
        'params'   => [
            'fields'  => json_encode(['employee','employee_name','attendance_date','status','working_hours']),
            'filters' => null, // built from request body
            'limit_page_length' => 50,
            'order_by' => 'attendance_date desc',
        ],
    ],
    'customers' => [
        'endpoint' => '/api/resource/Customer',
        'params'   => [
            'fields'  => json_encode(['name','customer_name','customer_type','territory','mobile_no','email_id']),
            'filters' => json_encode([['disabled','=',0]]),
            'limit_page_length' => 500,
            'order_by' => 'customer_name asc',
        ],
    ],
];

// ---- Parse request body ----
$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$action       = $body['action'] ?? null;
$extraFilters = $body['filters'] ?? null;
$docName      = $body['name'] ?? null;

if (!isset($ACTIONS[$action])) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => "Unknown action: " . $action . ". Valid: " . implode(', ', array_keys($ACTIONS))]);
    exit;
}

$actionCfg = $ACTIONS[$action];

// ---- Build URL ----
$endpoint = str_replace('{name}', rawurlencode($docName ?? ''), $actionCfg['endpoint']);
$params   = $actionCfg['params'];

// Allow caller to pass extra filters (e.g. filter attendance by employee)
if ($extraFilters !== null) {
    $params['filters'] = json_encode($extraFilters);
}

// Build query string (skip null/undefined)
$pairs = [];
foreach ($params as $k => $v) {
    if ($v === null) continue;
    $pairs[] = rawurlencode($k) . '=' . rawurlencode((string)$v);
}
$qs = implode('&', $pairs);
$url = $FRAPPE_URL . $endpoint . ($qs ? '?' . $qs : '');

// ---- Call Frappe via cURL ----
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: token ' . $FRAPPE_KEY . ':' . $FRAPPE_SECRET,
        'Content-Type: application/json',
        'Accept: application/json',
    ],
    CURLOPT_TIMEOUT => 30,
]);
$resp     = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($resp === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Could not reach Frappe Cloud']); error_log('frappe curl: ' . $curlErr);
    exit;
}

if ($httpCode < 200 || $httpCode >= 300) {
    http_response_code($httpCode);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Frappe request failed']); error_log('frappe.php upstream: ' . substr($resp,0,500));
    exit;
}

// ---- Success: pass Frappe's JSON straight through ----
http_response_code(200);
header('Content-Type: application/json');
header('Cache-Control: no-store');
echo $resp;
