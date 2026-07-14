<?php
// ============================================================
//  Winner Holistic Consultants – Database credentials
//  api/db/db.config.php
//
//  ⚠️  PRIVATE. The /api/.htaccess blocks .config.php from being
//      served over the web. Fill these from cPanel → MySQL Databases.
//
//  On cPanel the DB name and user are usually PREFIXED with your
//  account name, e.g.  hazrkhk3b2ip_whc  and  hazrkhk3b2ip_whcuser
// ============================================================

return [
    'host'    => 'localhost',
    'name'    => 'projects_db',      // e.g. hazrkhk3b2ip_whc
    'user'    => 'project_db',      // e.g. hazrkhk3b2ip_whcuser
    'pass'    => 'DB pass',
    'charset' => 'utf8mb4',
];
