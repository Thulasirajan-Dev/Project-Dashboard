# WHC Projects — cPanel Deployment Guide

This package is your Netlify/Firebase project re-homed to run on your existing
cPanel hosting (`winnerhc.com`). **Firebase stays exactly where it is** — only
the two Netlify Functions were rewritten (as PHP) so they run on cPanel.

---

## What changed vs the Netlify version

| Netlify thing | Replaced on cPanel with |
|---|---|
| `netlify/functions/frappe.js` | `api/frappe.php` |
| `netlify/functions/onedrive-upload.js` | `api/onedrive-upload.php` |
| Netlify environment variables | `api/config.secret.php` (your keys) |
| `netlify.toml` redirects/headers | `.htaccess` (web root) |
| Frontend endpoint URLs | updated to `/api/frappe.php` and `/api/onedrive-upload.php` |

Firebase, all HTML/CSS/JS, and your data are untouched.

---

## STEP 1 — Upload the files

In cPanel → **File Manager** → open `public_html` (this is the web root for
`winnerhc.com`). Upload **the entire contents** of the `site/` folder from this
package into `public_html` so you end up with:

```
public_html/
  .htaccess
  auth/  proposals/  coordinator/  account/  summary/  payments/  client/
  shared/
  api/
    frappe.php
    onedrive-upload.php
    config.secret.php
    .htaccess
  ...
```

Tip: zip the `site` folder locally, upload the zip, then use File Manager's
"Extract". Make sure hidden files (`.htaccess`) are visible — in File Manager
click **Settings** (top right) and tick **Show Hidden Files (dotfiles)**.

---

## STEP 2 — Put your secrets in config.secret.php

Open `public_html/api/config.secret.php` in File Manager's editor and paste the
**same values you had in Netlify's Environment Variables**:

- `FRAPPE_API_KEY`, `FRAPPE_API_SECRET`
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `ONEDRIVE_USER` (e.g. `proofs@winnerhc.com`)

Leave `SITE_URL` as `https://winnerhc.com`.

The `api/.htaccess` already blocks this file from being downloaded over the web.

---

## STEP 3 — Confirm PHP version

cPanel → **Select PHP Version**. Make sure it's **PHP 7.4 or newer** (8.x is
fine). Ensure the **curl** extension is ticked/enabled (it usually is by
default). The scripts use cURL to reach Frappe and Microsoft Graph.

---

## STEP 4 — Update Azure & Frappe allow-lists

Because the site origin is changing from your Netlify URL to
`https://winnerhc.com`:

- **Frappe**: if you restricted the API key by IP/origin, allow the cPanel
  server IP `68.178.150.231` (from your cPanel General Information).
- **Azure / OneDrive**: app (client-credentials) auth doesn't use redirect URIs,
  so usually nothing to change. Just confirm the client secret hasn't expired.

---

## STEP 5 — Turn the OneDrive uploader ON (when ready)

In `shared/shared.js` find:

```js
const ATTACH_ENABLED = false;
```

Set it to `true` once Step 2's Azure values are filled in and tested. While it's
`false`, the upload box shows a "coming soon" note instead of erroring — handy
for going live in stages.

---

## STEP 6 — Test

1. Visit `https://winnerhc.com/` → should redirect to `/auth/`.
2. Open each module (`/proposals`, `/coordinator`, etc.) → pages load, CSS/JS work.
3. Coordinator page → the ERP dropdowns should populate (that proves
   `api/frappe.php` → Frappe is working).
4. If a Frappe call fails, open browser DevTools → Network → click the
   `frappe.php` request → look at the response; the PHP returns a clear
   `error`/`detail` message.

---

## STEP 7 — Switch to the LIVE database (only when you're ready)

In `shared/config.js`:

```js
const ENV = "test";   // change to "live" for production data
```

Right now it's `test` (safe). Flip to `live` when you want real data.

---

## Security notes (recommended before real data)

- **Change the bootstrap password** in `shared/config.js`
  (`SUPER_ADMIN_BOOTSTRAP_PW = "whcadmin2026"`) to something private, and rotate
  it after first super-admin setup.
- **Tighten Firebase rules** using `firebase-rules-recommended.json` — by
  default a Realtime Database is open, meaning anyone with the URL can read/write.
- Keep `config.secret.php` out of any git repo or public backup.

---

## Update log — session timeout & previews

**120-minute idle session timeout** (in `shared/shared.js`):
- The session now auto-expires after 120 minutes of *inactivity*. Any real
  interaction (click, keypress, scroll, touch) resets the clock.
- A red warning bar appears ~2 minutes before logout with a **"Stay signed in"**
  button. Clicking it (or any activity) cancels the logout.
- On timeout the user is sent to `/auth/?timeout=1`, which shows a friendly
  "signed out after 120 minutes of inactivity" notice.
- To change the window, edit `SESSION_IDLE_MS` near the top of the Auth helpers
  in `shared/shared.js` (currently `120 * 60 * 1000`). The warning lead time is
  `SESSION_WARN_MS`.
- Fully client-side — no server calls, no bandwidth cost.

**Improved attachment previews** (in `shared/shared.js` + `shared/style.css`):
- Images now always render a visual preview (uses the stored thumbnail, or
  falls back to the full image), with a graceful card fallback if the image
  can't load.
- PDFs now show an **inline embedded preview** of the document (first page) in a
  framed box, with the tap-to-open card kept underneath. Previously PDFs showed
  only a card.
- Upload types are unchanged (images + PDF, 4MB) per your instruction.

---

## Update log — Firebase removed, data now in cPanel MySQL

Your data backend moved from Firebase to a MySQL database on cPanel.
Design is **hybrid**: stable columns for filtering/reporting + a JSON
column holding each record's full nested shape (stages, docs, dynamic
quotation fields). Login keeps the existing SHA-256 PIN flow — only the
user records moved into MySQL.

### New files
```
api/data.php                     ← data API the browser calls (replaces Firebase)
api/db/schema.sql                ← MySQL tables (import via phpMyAdmin)
api/db/db.config.php             ← DB name/user/password (PRIVATE)
api/db/conn.php                  ← shared PDO connection
api/db/migrate-from-firebase.php ← one-time data import, then delete
```

### Frontend change
`shared/shared.js` — the `fbGet` / `fbSet` / `fbDelete` helpers now POST to
`/api/data.php` instead of Firebase. Because every page already routes through
these three helpers, **no page code changed**. `shared/config.js` no longer
holds any Firebase URL.

### Setup steps (do these in order)

1. **Create the database** — cPanel → *MySQL Databases*:
   - Create a new database (you're at 8/10, so you have room).
   - Create a DB user with a strong password.
   - Add that user to the database with **ALL PRIVILEGES**.
   - Note the full prefixed names (e.g. `hazrkhk3b2ip_whc` /
     `hazrkhk3b2ip_whcuser`).

2. **Import the schema** — cPanel → *phpMyAdmin* → select the database →
   *Import* → choose `api/db/schema.sql` → *Go*. You should see the tables
   `users, projects, quotations, summary, activity_log, auth_log`.

3. **Fill in DB credentials** — edit `api/db/db.config.php` with the database
   name, user, and password from step 1.

4. **(Optional) Bring your existing data over** — if your Firebase test data is
   worth keeping:
   - Open `api/db/migrate-from-firebase.php`, confirm `FIREBASE_EXPORT_URL`
     points at your Firebase DB root.
   - Temporarily comment out the `db/` block line in `api/.htaccess`.
   - Visit `https://winnerhc.com/api/db/migrate-from-firebase.php?go=1`.
   - Check the printed counts, **then delete that file** and restore the
     `.htaccess` line.
   - If your Firebase rules block anonymous reads, either relax them briefly or
     append `?auth=YOUR_DB_SECRET` in the script's `fb_fetch` URL.

5. **Confirm PHP has PDO MySQL** — cPanel → *Select PHP Version* → ensure
   `pdo_mysql` (and `mysqlnd`) are enabled. They almost always are by default.

6. **Test** — open the app, log in. Create a quotation and a project, reload —
   they should persist (now coming from MySQL). In *phpMyAdmin* you should see
   new rows in `quotations` / `projects`, with the flat columns populated and
   the full record in the `data` JSON column.

### What you can now do that Firebase made awkward
- Query/report directly in phpMyAdmin, e.g.
  `SELECT company, status, COUNT(*) FROM projects GROUP BY company, status;`
- Back up everything with cPanel's normal MySQL backups.
- Your data is no longer reachable from a public Firebase URL.

### After it works — decommission Firebase
Once you've confirmed data reads/writes against MySQL, you can disable or
delete the Firebase project. Nothing in the app points to it anymore.
The old `firebase-rules-recommended.json` is now irrelevant and can be removed.
