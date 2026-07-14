<?php
// ============================================================
//  Root fallback redirect → /auth/
//
//  The primary redirect is the RewriteRule in .htaccess
//  ("^$ /auth/ [R=301,L]"). This file exists as a SAFETY NET:
//  cPanel's default DirectoryIndex list normally tries index.php
//  before index.html, so even if .htaccess is missing, misplaced,
//  or mod_rewrite is disabled on this host, visiting the bare
//  domain still lands on the login page instead of a 403/404 or
//  directory listing.
// ============================================================
header('Location: /auth/', true, 301);
exit;
