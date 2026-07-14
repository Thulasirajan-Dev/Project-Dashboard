<?php
// ============================================================
//  Winner Holistic Consultants – Public Client View (read-only)
//  api/client-view.php
//
//  The ONLY public, no-login endpoint. A client opens
//  projects.winnerhc.com/client/?t=<token> and this returns
//  *only* that one project's safe, client-facing fields:
//    - project title / client name
//    - scope stages with status (Not started / In progress / Done)
//    - overall % complete (sum of Done-stage percentages)
//
//  It deliberately exposes NOTHING else: no quotation values, no
//  LPO/payment data, no internal notes, no other projects, and no
//  write capability. The token is a long random string per project,
//  so project IDs can't be guessed or enumerated.
//
//  GET  /api/client-view.php?t=<token>
// ============================================================

require __DIR__ . '/db/conn.php';

$cfg = require __DIR__ . '/config.secret.php';
header('Access-Control-Allow-Origin: ' . ($cfg['SITE_URL'] ?? '*'));
header('Content-Type: application/json');
header('Cache-Control: no-store');

$token = $_GET['t'] ?? '';
// Tokens are 48 hex chars (24 random bytes). Reject anything malformed
// fast, before touching the database.
if (!preg_match('/^[a-f0-9]{16,64}$/', $token)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid link']);
    exit;
}

try {
    $pdo = db();
    // Find the project whose JSON data.clientToken matches. We scan the
    // (small) projects table; for larger volumes add a generated column
    // + index on clientToken.
    $st = $pdo->query("SELECT id, company, title, client, data FROM projects");
    $match = null;
    foreach ($st->fetchAll() as $row) {
        $d = json_decode($row['data'], true);
        if ($d && isset($d['clientToken']) && hash_equals($d['clientToken'], $token)) {
            $match = ['row' => $row, 'data' => $d];
            break;
        }
    }

    if (!$match) {
        http_response_code(404);
        echo json_encode(['error' => 'This link may be invalid or the project was removed.']);
        exit;
    }

    $d = $match['data'];
    $proj = $d['project'] ?? [];

    // Build the client-safe quotation list — one entry PER quotation (the
    // original + each revision), so the client page can show them as
    // separate tabs, matching Coordinator's view. Only client-appropriate
    // fields (name/code/desc + milestone status) — never values or fees.
    $quotations = [];
    $msTotalValue = 0; $msCreditedValue = 0;
    foreach (($d['quotationGroups'] ?? []) as $g) {
        $scopeItems = [];
        foreach (($g['scope'] ?? []) as $s) {
            $nm = $s['name'] ?? '';
            if ($nm === '') continue;
            $scopeItems[] = ['code' => $s['code'] ?? '', 'name' => $nm, 'desc' => $s['desc'] ?? ''];
        }
        $groupTotal = $g['contractTotal'] ?? 0;
        $milestones = [];
        foreach (($g['milestones'] ?? []) as $m) {
            $nm = $m['name'] ?? '';
            if ($nm === '') continue;
            $stageStatus = $m['stageStatus'] ?? 'Not started';
            $isRaised = ($stageStatus === 'Raise Invoice' || $stageStatus === 'Done'); // mirrors shared.js isMilestoneRaised()
            $rawStatus = $m['status'] ?? '';
            // Mirrors shared.js accountStatus() — Account's own 4-state
            // progression (Open / Invoice Pending / Invoice Raised /
            // Credited), with the same legacy-data inference for older
            // records that only ever had pending/credited.
            if ($rawStatus === 'credited' || $rawStatus === 'Credited') {
                $status = 'Credited';
            } elseif (in_array($rawStatus, ['Open', 'Invoice Pending', 'Invoice Raised'], true)) {
                $status = $rawStatus;
            } else {
                $status = $isRaised ? 'Invoice Pending' : 'Open';
            }
            // Milestone progress is by VALUE, not a headcount ratio — mirrors
            // the live amount calc used everywhere else (contractTotal × pct).
            // Completed Scope Payment rows are excluded — they're a closeout
            // payment for Hold/Cancelled projects, not normal progress.
            $amt = $groupTotal ? round($groupTotal * ((float)($m['pct'] ?? 0)) / 100) : (float)($m['amount'] ?? 0);
            if (!empty($m['isGovtFee'])) $amt = (float)($m['actualAmount'] ?? 0);
            if (empty($m['isCompletedScopePayment'])) {
                $msTotalValue += $amt;
                if ($status === 'Credited') $msCreditedValue += $amt;
            }
            $milestones[] = ['name' => $nm, 'status' => $status];
        }
        $quotations[] = [
            'quotationNo' => $g['quotationNo'] ?? '',
            'isRevision'  => !empty($g['isRevision']),
            'createdAt'   => $g['createdAt'] ?? '',
            'scopeItems'  => $scopeItems,
            'milestones'  => $milestones,
        ];
    }
    // Fallback to legacy awarded_scope stages if no quotation groups yet —
    // no milestone value data exists in this path, so the milestone
    // percentage just stays 0 (handled below).
    if (!$quotations) {
        $legacyScope = [];
        foreach (($d['stages'] ?? []) as $s) {
            if (($s['type'] ?? '') !== 'awarded_scope') continue;
            $nm = $s['name'] ?? '';
            if ($nm === '') continue;
            $legacyScope[] = ['code' => '', 'name' => $nm, 'desc' => ''];
        }
        if ($legacyScope) {
            $quotations[] = ['quotationNo' => '', 'isRevision' => false, 'createdAt' => '', 'scopeItems' => $legacyScope, 'milestones' => []];
        }
    }
    $milestonePercent = $msTotalValue > 0 ? (int)round(min(100, ($msCreditedValue / $msTotalValue) * 100)) : 0;

    // Approval stages (drawing prep / authority approvals). Client sees only
    // the stage name + a simplified status — never app numbers or internal dates.
    $approvalStages = [];
    $apDone = 0; $apTotal = 0;
    foreach (($d['stages'] ?? []) as $s) {
        if (($s['type'] ?? '') === 'awarded_scope') continue;   // scope, not an approval stage
        $nm = $s['name'] ?? '';
        if ($nm === '') continue;
        $raw = strtolower($s['status'] ?? '');
        // Map internal statuses into client-friendly buckets.
        if (strpos($raw, 'approv') !== false || strpos($raw, 'completed') !== false
            || $raw === 'done' || $raw === 'received' || $raw === 'signed') {
            $label = 'Approved'; $apDone++;
        } elseif (strpos($raw, 'reject') !== false) {
            $label = 'Rejected';
        } elseif ($raw === 'hold') {
            $label = 'On hold';
        } elseif ($raw === '' || $raw === 'not started' || $raw === 'not-started' || $raw === 'pending'
            || $raw === 'requirement-pending' || $raw === 'not-received' || $raw === 'awaiting-docs'
            || $raw === 'not-part-scope') {
            $label = 'Pending';
        } else {
            // under-review, under-preparation, sent-client-review, waiting-applicant,
            // submitted, comments-shared, inspection-scheduled, etc.
            $label = 'In progress';
        }
        $apTotal++;
        $approvalStages[] = ['name' => $nm, 'status' => $label];
    }
    $approvalPct = $apTotal ? (int)round(min(100, ($apDone / $apTotal) * 100)) : 0;

    // Client-safe documents: only the project attachment(s), name + link.
    $documents = [];
    if (!empty($d['attachment']) && !empty($d['attachment']['url'])) {
        $documents[] = ['name' => $d['attachment']['name'] ?? 'Document', 'url' => $d['attachment']['url']];
    }
    foreach (($d['clientDocuments'] ?? []) as $doc) {
        if (!empty($doc['url'])) $documents[] = ['name' => $doc['name'] ?? 'Document', 'url' => $doc['url']];
    }

    // Combined display name: "<folder>_<title>" (e.g. 1278_Alguir).
    $baseTitle = $match['row']['title'] ?: ($proj['title'] ?? 'Project');
    $folder = $d['folderPath'] ?? '';
    $displayTitle = $baseTitle;
    if ($folder !== '') {
        // Avoid double-prefix if title already starts with the folder.
        if (strpos($baseTitle, $folder) !== 0) {
            $displayTitle = $folder . '_' . $baseTitle;
        }
    }

    echo json_encode([
        'ok'        => true,
        'title'     => $displayTitle,
        'client'    => $match['row']['client'] ?: ($proj['client'] ?? ''),
        'milestonePercent' => $milestonePercent,
        'percent'        => $milestonePercent, // kept for older cached client pages
        'quotations'     => $quotations,
        'approvalStages' => $approvalStages,
        'approvalPercent'=> $approvalPct,
        'documents'      => $documents,
        'updated'   => $d['updatedAt'] ?? null,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to load project status right now.']);
}
