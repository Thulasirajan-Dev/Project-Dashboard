# Running WHC Projects on its OWN subdomain (projects.winnerhc.com)

This keeps the app completely separate from your existing website. Your main
site at `winnerhc.com` is never touched — the app gets its own folder, its own
files, and its own address.

---

## Phase 1 — Create the subdomain

1. cPanel → **Domains** (or **Subdomains** on some themes) → **Create a New Domain** /
   **Create Subdomain**.
2. Subdomain / domain name: type **projects.winnerhc.com**.
3. **Document Root**: cPanel suggests something like
   `/home/hazrkhk3b2ip/projects.winnerhc.com`. Accept it (or note whatever path
   it shows — that folder is your app's private web root, separate from
   `public_html`).
4. Create it. cPanel makes the folder automatically.

> The document root is the key: everything for the app goes in THAT folder, not
> in `public_html`. That is the separation you asked for.

---

## Phase 2 — Secure it with SSL

1. cPanel → **SSL/TLS Status**.
2. Find `projects.winnerhc.com` in the list, tick it, click **Run AutoSSL**.
3. Wait a few minutes until it shows a valid certificate. (Your main domain
   already has SSL; this just extends coverage to the subdomain.)

---

## Phase 3 — Upload the app files

1. Unzip `WHC-Projects-cPanel.zip` on your computer.
2. cPanel → **File Manager** → open the subdomain's document root folder from
   Phase 1 (e.g. `projects.winnerhc.com`), NOT `public_html`.
3. File Manager → **Settings** (top right) → tick **Show Hidden Files
   (dotfiles)** so `.htaccess` is visible.
4. Upload the files so the document root directly contains:
   ```
   projects.winnerhc.com/
     .htaccess
     auth/  proposals/  coordinator/  account/  summary/  payments/  client/
     shared/
     api/
   ```
   (Tip: re-zip the *contents* locally, upload that zip, then **Extract** in
   File Manager. Make sure you don't end up with a nested `site/` folder.)

---

## Phase 4 — Database (same as before)

The database is shared at the server level — subdomain vs main domain makes no
difference here.

1. cPanel → **MySQL Databases** → create a database (e.g. `whc`), a user with a
   strong password, and add the user to the database with **ALL PRIVILEGES**.
   Note the full prefixed names (e.g. `hazrkhk3b2ip_whc` /
   `hazrkhk3b2ip_whcuser`).
2. cPanel → **phpMyAdmin** → select the database → **Import** →
   choose `api/db/schema.sql` → **Go**. Six tables should appear.

---

## Phase 5 — Fill in credentials

1. Edit `api/db/db.config.php` → put in the DB name, user, password from Phase 4.
2. Edit `api/config.secret.php` → paste your Frappe + Azure/OneDrive keys.
   `SITE_URL` is already set to `https://projects.winnerhc.com` — leave it.
3. cPanel → **Select PHP Version** → ensure `pdo_mysql` and `curl` are enabled.

---

## Phase 6 — (Optional) Import old Firebase data

1. In `api/.htaccess`, temporarily comment out (`#`) the line blocking `db/`.
2. Visit `https://projects.winnerhc.com/api/db/migrate-from-firebase.php?go=1`.
3. Check the counts → **delete** that file → un-comment the `.htaccess` line.

---

## Phase 7 — Test

1. Visit `https://projects.winnerhc.com/` → it should redirect to `/auth/`.
2. Log in (first-time super admin uses the bootstrap password in
   `shared/config.js`).
3. Create a test quotation + project, reload → they persist. Check phpMyAdmin
   for new rows.
4. Coordinator page → ERP dropdown populates → Frappe integration works.

---

## Phase 8 — Go live

1. Change the bootstrap password in `shared/config.js`.
2. Set `ENV` to `"live"` in `shared/config.js`.
3. Flip `ATTACH_ENABLED` to `true` in `shared/shared.js` once OneDrive is ready.

---

## Why almost nothing in the code had to change

A subdomain has its **own root**, so the app's root-absolute paths still resolve
correctly:
- `/` → `/auth/` redirect works (root of the subdomain).
- `/api/data.php`, `/api/frappe.php`, `/api/onedrive-upload.php` resolve under
  the subdomain.

The only setting tied to the address is `SITE_URL` (used for CORS so the API
only accepts calls from your app's origin) — already set to
`https://projects.winnerhc.com` in this package.

If you ever move it to a different address, change `SITE_URL` in
`api/config.secret.php` to match.
