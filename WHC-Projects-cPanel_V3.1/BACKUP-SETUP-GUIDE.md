# WHC — Database Backup Setup Guide

This documents the backup system added to the app: how it works, how to
restore from it, and how to make it run automatically.

## What it backs up

Every table in the database: `users`, `projects`, `quotations`, `summary`
(which also holds dropdown options, quotation counters, and the RBAC
permissions matrix), `activity_log`, `auth_log`. It's a complete backup —
nothing is excluded.

**What it does NOT back up:** file attachments stored in OneDrive (those
live in Microsoft's storage, not this database) and the application code
itself (that's your uploaded files — back those up separately if you make
custom edits, e.g. by keeping a copy of anything you upload).

## How it works

`api/backup.php` is a pure-PHP script — it does **not** rely on the
`mysqldump` command line tool, which many shared hosts disable. It queries
every table directly and writes out a standard `.sql` file (the same format
`mysqldump` produces: `CREATE TABLE IF NOT EXISTS` + `INSERT` statements),
so restoring it is completely ordinary.

Every time it runs, it:
1. Generates the full dump.
2. Saves a timestamped copy on the server under `api/backups/` (protected —
   nobody can browse to these files directly; they're only reachable
   through the authenticated script).
3. Deletes any saved backup older than 30 days, so this never quietly fills
   up your hosting storage quota.
4. Streams the file back as a download (only when triggered manually by a
   logged-in Super Admin — a cron-triggered run just saves the server copy).

## How to download a backup manually

1. Log in as Super Admin.
2. From the portal hub → **Manage Users** → **💾 Backups** tab.
3. Click **Download Backup Now**. Save the `.sql` file somewhere safe
   (your computer, Google Drive, email it to yourself — anywhere that
   isn't this same server).
4. The **Backups on this server** list on that page shows every backup
   currently saved server-side, with Download/Delete for each.

## How to restore from a backup

1. cPanel → **phpMyAdmin**.
2. Select your WHC database in the left sidebar.
3. Click **Import** (top menu).
4. Choose the `.sql` backup file, leave the format as SQL, click **Go**.

That's it. Every table gets recreated (if missing) and every row
re-inserted. Existing tables/rows aren't touched unless the import
overlaps with existing primary keys — for a true "wipe and restore",
drop the tables first (phpMyAdmin → select all tables → Drop) *before*
importing, or you'll end up with duplicate-key errors on rows that
already exist.

⚠️ **Test this once on a spare/staging database before you ever need it
for real**, so you're not learning the restore process for the first time
during an actual emergency.

## Setting up automatic backups (cPanel Cron Job)

A manual download only helps if someone remembers to do it. For a backup
that runs on its own on a schedule:

1. **Generate a secret token.** You need a long random string nobody else
   knows. If you have SSH/Terminal access in cPanel, run:
   ```
   php -r "echo bin2hex(random_bytes(24));"
   ```
   If you don't have terminal access, any long random password works —
   e.g. generate one in your password manager (32+ characters).

2. **Add it to `api/config.secret.php`** — find this line:
   ```php
   'BACKUP_TOKEN' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',
   ```
   Replace the placeholder with the string you generated. Save and
   re-upload the file.

3. **cPanel → Cron Jobs.**
4. Add a new cron job:
   - **Common Settings:** "Once Per Day" is a sensible default (pick a
     quiet hour, e.g. 3:00 AM).
   - **Command:**
     ```
     wget -q -O /dev/null "https://projects.winnerhc.com/api/backup.php?token=YOUR_TOKEN_HERE"
     ```
     (If `wget` isn't available on your host, use `curl -s -o /dev/null
     "https://..."` instead — either works, cPanel hosts usually have one
     or the other.)
5. Save. The cron job will now hit the backup script daily, which
   generates a fresh dump and saves it under `api/backups/` — no login
   needed, no email required, fully automatic.

**This still only protects you against needing an OLD version of the
data, or recovering from a mistake — not against losing the server
entirely**, since the backups live on the same server as everything
else. For real disaster protection, periodically (e.g. monthly) download
the latest backup from the Backups tab and store a copy somewhere
completely separate — your computer, a cloud drive, wherever. A five
minute habit is the difference between "restore in 10 minutes" and
"we lost everything."

## Security notes

- `api/backups/*.sql` files contain everything in your database,
  including PIN hashes and client data. They are blocked from direct
  web access (`.htaccess` inside that folder) — the only way to get one
  is through `api/backup.php`, which requires either a Super Admin
  session or the secret token.
- Treat `BACKUP_TOKEN` like a password. Anyone who has it can trigger a
  backup download without logging in. If you ever suspect it's leaked,
  generate a new one and update `config.secret.php`.
- Manual deletion of a saved backup (the Delete button) requires an
  actual Super Admin session — the cron token can create backups but
  can't delete them.
