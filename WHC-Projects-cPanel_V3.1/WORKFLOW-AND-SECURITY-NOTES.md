# WHC — New Workflow & Security Build Notes

This documents everything added in this round so you (or any developer) can
test and verify on the live server.

## 1. Server-side authentication & access control (real security)

**New files**
- `api/auth.php` — login / logout / "me" / signup. Verifies the SHA-256 PIN
  against MySQL on the SERVER and starts a hardened PHP session cookie
  (HttpOnly, Secure, SameSite=Strict). The browser never downloads other
  users' hashes.
- `api/data.php` — now REQUIRES a valid session for every read/write, and
  enforces a server-side write matrix (e.g. `proposals` role cannot write to
  `projects`; only `super_admin` writes `users`/`summary`). This is the real
  lock: editing the page in DevTools or calling the API directly is rejected
  by the server.

**Frontend changes (`shared/shared.js`)**
- `loginWithPin()` now calls `auth.php` (no more downloading all users).
- `serverSignup()` / `serverLogout()` added.
- All data calls send the session cookie (`credentials:"include"`).

**Bootstrap (first Super Admin)**
- When the `users` table is empty, `auth.php`'s `signup` allows creating the
  first super_admin ONLY with the correct `BOOTSTRAP_PW` (in
  `api/config.secret.php`, currently `whcadmin2026` — CHANGE IT).
- ⚠️ TEST THIS FIRST on the live server: create the first admin, then log in.
  The first-admin setup screen wiring is the one area to verify end-to-end
  against your live DB, since it couldn't be run in the build sandbox.

## 2. New project workflow (Proposal → Coordinator + Account)

**Awarded gate:** a quotation becomes a project when `Status = Won` AND
`LPO Received = Y`. Computed — no new status field.

**Inline Project Details (Proposals):** the quotation form now has a Project
Details block (`proposals/proposals-quotation.js`) that activates on award:
- Folder Path (text reference)
- Scope of Work: stage rows (name + %), running total, optional file
- LPO Milestones: rows (name + value), running total, optional file

On save (when awarded), `ensureProjectFromQuotation()` creates the project for
the other teams (this function already existed and is reused).

**Coordinator:** scope rows arrive as stages of type `awarded_scope` with a
clean three-state status (Not started / In progress / Done). The coordinator
bar shows overall **% complete = sum of "Done" stage percentages**.

**Account:** LPO milestones arrive as proper `lpos[]` records (name + amount,
status pending) in the existing LPO/Payments tab, where the Account role
credits them (invoiced/credited/payment ref) — the existing role rules already
do this.

## 3. Secure client link (read-only, token-based)

- `api/client-view.php` — public, no-login endpoint. Takes `?t=<token>` and
  returns ONLY: project title, client name, scope stages + status, and overall
  % complete. No quotation values, no LPO/payment data, no other projects, no
  write path.
- Each project gets a random `clientToken` (already generated in
  `ensureProjectFromQuotation`). `projectLink()` now builds
  `/client/?t=<token>` instead of the guessable `?id=`.
- `client/index.html` rewritten as a minimal, self-contained status page that
  reads only from `client-view.php`. (Old version backed up conceptually; the
  new one exposes nothing internal.)

### Note on "no source code visible"
A browser must receive HTML/CSS/JS to render a page, so the client page's
markup is technically viewable (true of every website). What matters is that it
contains NO data or logic of value: it only fetches the few safe fields for one
project by token. All sensitive logic, data, and credentials stay server-side
in PHP/MySQL, which the browser can never see.

## Testing order on the live server
1. Create first Super Admin (bootstrap) → log in. **Verify this first.**
2. Create one user per role; confirm each sees only its allowed modules.
3. As Proposals: create a quotation; set Won + LPO=Y; fill scope stages + LPO
   milestones; save. Confirm a project appears for Coordinator + Account.
4. As Coordinator: set scope stage statuses; watch the % complete chip.
5. As Account: credit an LPO milestone in the LPO/Payments tab.
6. Open the client link (Share/Copy Link) in a private window: confirm it shows
   scope + status + % only, and that changing `?t=` to a wrong value shows
   "unavailable".
7. Try to write as a view-only role via DevTools → should be refused by the
   server (403).
