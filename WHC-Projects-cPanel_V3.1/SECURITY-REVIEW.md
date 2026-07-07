# WHC — Security Review & Fixes

A security pass was done across all server endpoints and the data flow.
Findings and what was fixed:

## Fixed in this pass

1. **Unauthenticated API proxies (HIGH).** `api/frappe.php` and
   `api/onedrive-upload.php` had NO authentication — anyone on the internet who
   knew the URL could use your private Frappe/ERPNext API keys (read employees,
   projects, customers) or upload to your OneDrive. **Fixed:** both now require a
   valid login session, same as `data.php`. Frontend calls send the session
   cookie (`credentials:"include"`).

2. **PHP fatal bug (HIGH).** `auth.php` had `if (action === 'me')` instead of
   `$action` — on PHP 8 this throws a fatal error, which would have broken the
   "who am I" session check. **Fixed.**

3. **Error-detail disclosure (MEDIUM).** Several endpoints echoed raw exception
   / database / upstream error messages to the browser, which can leak schema,
   SQL fragments, or internal details to an attacker. **Fixed:** all now return
   generic messages and log the detail server-side via `error_log()`.

4. **Log-table injection hardening (DEFENSE-IN-DEPTH).** `data.php`'s log
   handler interpolates a table name into SQL. It was already constrained by the
   routing switch, but an explicit whitelist was added so the two log tables are
   the only possible values.

5. **Milestone owner = email (uniqueness).** Owner is now stored as the user's
   email (unique) rather than name, removing duplicate-name ambiguity. Dropdowns
   show "Name · email"; "owned by me" matches on email or name (so older
   name-based data still works).

## Verified OK (no change needed)

- **SQL injection:** every query uses parameterized placeholders (`?` / `:name`).
  No user input is concatenated into SQL.
- **Auth enforcement:** `data.php` requires a session for all reads/writes and
  enforces a server-side write matrix by role. View-only roles cannot write even
  via DevTools or direct API calls.
- **Session cookie:** HttpOnly, Secure, SameSite=Strict; ID regenerated on login.
- **Client link:** token is validated with a strict regex and compared with
  `hash_equals` (constant-time). The public endpoint returns ONLY title, client,
  scope stages + status, and % — no quotation/LPO/financial data, no other
  projects, no write path.
- **CORS:** `Allow-Origin` is locked to your site origin (not `*`) with
  credentials — the correct, safe combination.
- **PIN storage:** SHA-256 hashed; never sent to the browser (login verifies
  server-side; the browser no longer downloads user hashes).
- **Secrets:** shipped as placeholders; `.htaccess` blocks `config.secret.php`
  and `db.config.php` from being served over the web.

## Recommended hardening (optional, not blocking)

- **Move secrets outside the web root.** `.htaccess` protection is the standard
  cPanel approach and works, but the strongest pattern is to keep
  `config.secret.php` / `db.config.php` in a directory above `public_html` and
  `require` them by absolute path. Consider this if you want defense beyond
  `.htaccess`.
- **Upgrade PIN hashing.** SHA-256 (unsalted) matches the app's existing scheme.
  For stronger protection against offline cracking if the DB ever leaked,
  migrate to `password_hash()` (bcrypt) in future. Would require a one-time
  re-hash on next login.
- **Rate-limit login.** Consider a simple attempt counter to slow brute-forcing
  of PINs.
- **Note on PHP lint:** the PHP couldn't be runtime-linted in the build
  environment. Structure and braces are verified; do a quick first-run test of
  login and one data write on the live server (watch the browser Network tab for
  any 500s).
