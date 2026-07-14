<?php
// ============================================================
//  Winner Holistic Consultants – SERVER SECRETS
//  api/config.secret.php
//
//  ⚠️  THIS FILE HOLDS YOUR PRIVATE KEYS. DO NOT share it,
//      do NOT commit it to git, and do NOT expose it publicly.
//
//  These are the same values you had in Netlify's
//  Environment Variables. Fill them in below.
//
//  The accompanying .htaccess blocks this file from being
//  served over the web, so even though it sits in /api,
//  no browser can download it.
// ============================================================

return [

    // ── Frappe / ERPNext ──────────────────────────────────
    'FRAPPE_URL'        => 'https://erp.winnerhc.com',
    'FRAPPE_API_KEY'    => 'PASTE_YOUR_FRAPPE_API_KEY',
    'FRAPPE_API_SECRET' => 'PASTE_YOUR_FRAPPE_API_SECRET',

    // ── Microsoft / OneDrive (Azure app registration) ─────
    'AZURE_TENANT_ID'     => 'PASTE_YOUR_AZURE_TENANT_ID',
    'AZURE_CLIENT_ID'     => 'PASTE_YOUR_AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET' => 'PASTE_YOUR_AZURE_CLIENT_SECRET',
    'ONEDRIVE_USER'       => 'proofs@winnerhc.com',   // the mailbox/drive that stores attachments
    'ONEDRIVE_FOLDER'     => 'WHC-Attachments',

    // ── CORS lock (recommended: your exact site origin) ───
    // Use 'https://winnerhc.com' once live. '*' allows any origin (looser).
    'SITE_URL' => 'https://projects.winnerhc.com',

    // ── TEMPORARY: allow session cookie over plain HTTP ───
    // Set to false ONLY while testing without a valid SSL certificate.
    // ⚠️ MUST be true in production — false sends the session cookie
    //    unencrypted. Flip back to true once HTTPS/AutoSSL is working.
    'COOKIE_SECURE' => false,

    // ── Automated database backups (api/backup.php) ───────
    // A long random string used to authorize a cPanel Cron Job to trigger
    // a backup WITHOUT a logged-in session (cron can't hold a browser
    // cookie). Generate one yourself — e.g. run this once and paste the
    // result in: php -r "echo bin2hex(random_bytes(24));"
    // Treat it like a password: only your cron job command should know it.
    'BACKUP_TOKEN' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',

];
