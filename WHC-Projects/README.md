# Winner Holistic Consultants – Project Tracker
## Setup & Deployment Guide

---

## Folder Structure

```
whc/
├── shared/
│   ├── config.js          ← ⭐ THE ONLY FILE YOU NEED TO EDIT TO SWITCH DATABASES
│   ├── shared.js          ← Firebase helpers, auth, utilities (don't edit)
│   ├── frappe.js          ← Frappe ERP integration helpers (future use)
│   └── style.css          ← Shared CSS for all modules
│
├── auth/
│   ├── index.html         ← Login page + Super Admin user management
│   └── auth.js            ← User CRUD, role management, activity log
│
├── proposals/
│   ├── index.html         ← Proposals team portal
│   └── proposals-quotation.js  ← Dynamic quotation form, QTN generator
│
├── coordinator/
│   ├── index.html         ← Coordinator portal (name auto-filled from login)
│   └── coordinator.js     ← Project list, stages, docs, activity log
│
├── account/
│   ├── index.html         ← Admin dashboard
│   └── account.js         ← KPIs, all projects, coordinator workload, CSV export
│
├── summary/
│   ├── index.html         ← Summary dashboard (quotation analytics)
│   └── summary-dashboard.js  ← Monthly table, category KPIs, team performance
│
├── client/
│   └── index.html         ← Public read-only project status (no login, ?id= link)
│
├── netlify/
│   └── functions/
│       └── frappe.js      ← Frappe ERP proxy (future use, deploy when ready)
│
└── netlify.toml           ← Netlify routing rules
```

---

## Step 1 — Switch Database Environment

Open `shared/config.js` and set:

```js
const ENV = "test";   // use "live" for production
```

| ENV value | Firebase used |
|-----------|--------------|
| `"live"`  | `whc-projects-update-default-rtdb` (existing, real data) |
| `"test"`  | `whc-projects-test-default-rtdb` (new, safe for testing) |

A yellow badge appears at the bottom of every page when ENV is not "live".

---

## Step 2 — Create Test Firebase Project (first time only)

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it `whc-projects-test`
3. Left sidebar → **Build → Realtime Database → Create Database**
4. Choose **us-central1** → Start in **Test mode** → Enable
5. Copy the URL (e.g. `https://whc-projects-test-default-rtdb.firebaseio.com/`)
6. Paste it into `shared/config.js` under `test:`

---

## Step 3 — Deploy to Netlify

1. Push this folder to a GitHub repo
2. Go to https://app.netlify.com → **Add new site → Import from Git**
3. Select your repo → deploy settings are auto-detected from `netlify.toml`
4. Click **Deploy**

---

## Step 4 — First Login (create Super Admin)

1. Open `https://yoursite.netlify.app/auth/`
2. First-time setup screen appears (no users exist yet)
3. Enter bootstrap password: `whcadmin2026`
4. Enter your name, email, and set a PIN
5. Super Admin account created — you're in

---

## Step 5 — Add Team Members

From the Auth module (`/auth/`):

| Role | Module URL | Access |
|------|-----------|--------|
| `super_admin` | `/auth/` then full access | Everything |
| `proposals` | `/proposals/` | Create & view quotations |
| `coordinator` | `/coordinator/` | Assigned projects only |

---

## Module URLs (after deploy)

| Module | URL | Password |
|--------|-----|----------|
| Login / User Management | `/auth/` | PIN per user |
| Proposals | `/proposals/` | Auto-redirect after login |
| Coordinator | `/coordinator/` | Auto-redirect after login |
| Admin Dashboard | `/account/` | Super admin only |
| Summary Dashboard | `/summary/` | Super admin only |
| Client View | `/client/?id=PROJECT_ID` | Public — no login |

---

## Auto QTN Number Format

| Category | Format | Last used |
|----------|--------|-----------|
| Fitout Folder | `1709-26` | starts at 1709 |
| Live Folder | `W-L-747-26-R0` | starts at 747 |
| ID Folder | `W-ID-108-26` | starts at 108 |
| Private Folder | `W-P-316-26` | starts at 316 |

Counters stored in Firebase under `qtn_counter/`. Auto-increments on each new quotation.

---

## Firebase Data Structure

```
Firebase Root/
├── users/                  ← Auth module (team members, roles, PINs)
├── auth_log/               ← Login activity log
├── projects/               ← Coordinator projects (stages, docs, activity)
├── quotations/
│   ├── fitout/             ← Fitout Folder quotations
│   ├── live/               ← Live Folder quotations
│   ├── id/                 ← ID Folder quotations
│   └── private/            ← Private Folder quotations
├── qtn_counter/            ← Auto-increment QTN number counters
└── summary/                ← Monthly summary counters
```

---

## Future: Frappe ERP Integration

When ready to connect `https://erp.winnerhc.com`:

1. Go to Frappe → My Settings → API Access → Generate Keys
2. Add to Netlify environment variables:
   - `FRAPPE_API_KEY`
   - `FRAPPE_API_SECRET`
   - `FRAPPE_URL` = `https://erp.winnerhc.com`
3. The `netlify/functions/frappe.js` proxy is already built and ready
4. Import `shared/frappe.js` in any module to start pulling Employee, Project, Leave data

---

## Support

Built for Winner Holistic Consultants · Abu Dhabi
