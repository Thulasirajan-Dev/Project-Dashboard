<?php
// ============================================================
//  Winner Holistic Consultants – OneDrive Attachment Upload (cPanel/PHP)
//  api/onedrive-upload.php
//
//  PHP port of netlify/functions/onedrive-upload.js.
//  Receives a small file (<=4MB) as base64 from the browser,
//  uploads it to one user's OneDrive via Microsoft Graph using
//  app (client-credentials) auth, creates a shareable view link,
//  and returns it. Azure credentials live ONLY in config.secret.php.
//
//  Frontend calls this at:  /api/onedrive-upload.php
// ============================================================

$cfg = require __DIR__ . '/config.secret.php';

$TENANT  = $cfg['AZURE_TENANT_ID']     ?? '';
$CLIENT  = $cfg['AZURE_CLIENT_ID']     ?? '';
$SECRET  = $cfg['AZURE_CLIENT_SECRET'] ?? '';
$OD_USER = $cfg['ONEDRIVE_USER']       ?? '';
$FOLDER  = $cfg['ONEDRIVE_FOLDER']     ?? 'WHC-Attachments';
$SITE_URL = $cfg['SITE_URL'] ?? '*';

$MAX_BYTES   = 4 * 1024 * 1024; // 4MB
$ALLOWED_EXT = ['pdf','png','jpg','jpeg','gif','webp','heic','bmp','tif','tiff'];

// ---- CORS ----
header('Access-Control-Allow-Origin: ' . $SITE_URL);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ---- Require a valid login session ----
// Uses our private Azure/OneDrive credentials — never callable anonymously.
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

if (!$TENANT || !$CLIENT || !$SECRET || !$OD_USER) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'OneDrive not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_USER in config.secret.php.']);
    exit;
}

// ---- Parse body ----
$raw = file_get_contents('php://input');
$payload = json_decode($raw ?: '{}', true);
if (!is_array($payload)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$fileName   = $payload['fileName']   ?? '';
$fileBase64 = $payload['fileBase64'] ?? '';
$recordType = $payload['recordType'] ?? '';
$recordId   = $payload['recordId']   ?? '';

if (!$fileName || !$fileBase64) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'fileName and fileBase64 are required']);
    exit;
}

// ---- Validate extension ----
$parts = explode('.', $fileName);
$ext = strtolower(end($parts));
if (!in_array($ext, $ALLOWED_EXT, true)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Only images and PDF files are allowed.']);
    exit;
}

// ---- Decode + size check ----
$buf = base64_decode($fileBase64, true);
if ($buf === false) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Bad file encoding']);
    exit;
}
if (strlen($buf) > $MAX_BYTES) {
    http_response_code(413);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'File too large (max 4MB).']);
    exit;
}

// ---- Helpers ----
function safeName($name) {
    $clean = preg_replace('/[^\w.\-]+/', '_', (string)$name);
    $clean = substr($clean, -80);
    return time() . '_' . $clean;
}

function graphToken($tenant, $client, $secret) {
    $url = "https://login.microsoftonline.com/{$tenant}/oauth2/v2.0/token";
    $post = http_build_query([
        'client_id'     => $client,
        'client_secret' => $secret,
        'scope'         => 'https://graph.microsoft.com/.default',
        'grant_type'    => 'client_credentials',
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $post,
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code < 200 || $code >= 300) {
        throw new Exception('Token request failed: ' . $code . ' ' . substr((string)$resp, 0, 200));
    }
    $j = json_decode($resp, true);
    return $j['access_token'] ?? null;
}

try {
    $token = graphToken($TENANT, $CLIENT, $SECRET);
    if (!$token) throw new Exception('No access token returned');

    // Organise files: /WHC-Attachments/<recordType>/<safeName>
    $sub = $recordType ? preg_replace('/[^\w\-]+/', '_', (string)$recordType) : 'misc';
    $fname = safeName(($recordId ? $recordId . '_' : '') . $fileName);
    $itemPath = "{$FOLDER}/{$sub}/{$fname}";

    // Encode each path segment (mirrors encodeURI on the path)
    $encodedPath = implode('/', array_map('rawurlencode', explode('/', $itemPath)));

    // ---- Simple PUT upload (<=4MB) ----
    $uploadUrl = "https://graph.microsoft.com/v1.0/users/" . rawurlencode($OD_USER)
        . "/drive/root:/{$encodedPath}:/content";

    $ch = curl_init($uploadUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => $buf,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/octet-stream',
        ],
        CURLOPT_TIMEOUT => 60,
    ]);
    $upResp = curl_exec($ch);
    $upCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($upResp === false || $upCode < 200 || $upCode >= 300) {
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Upload failed']); error_log('onedrive PUT: ' . substr((string)$upResp,0,300));
        exit;
    }

    $item = json_decode($upResp, true);
    $link = $item['webUrl'] ?? '';  // fallback

    // ---- Create an organization-view share link ----
    $itemId = $item['id'] ?? '';
    if ($itemId) {
        $linkUrl = "https://graph.microsoft.com/v1.0/users/" . rawurlencode($OD_USER)
            . "/drive/items/" . rawurlencode($itemId) . "/createLink";
        $ch = curl_init($linkUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['type' => 'view', 'scope' => 'organization']),
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Content-Type: application/json',
            ],
            CURLOPT_TIMEOUT => 30,
        ]);
        $linkResp = curl_exec($ch);
        $linkCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($linkResp !== false && $linkCode >= 200 && $linkCode < 300) {
            $lj = json_decode($linkResp, true);
            if (!empty($lj['link']['webUrl'])) $link = $lj['link']['webUrl'];
        }
    }

    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode([
        'ok'         => true,
        'url'        => $link,
        'name'       => $fileName,
        'size'       => strlen($buf),
        'itemId'     => $itemId,
        'uploadedAt' => (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z'),
    ]);
} catch (Exception $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Upload failed']); error_log('onedrive upload: ' . $e->getMessage());
}
