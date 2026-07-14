-- ============================================================
--  Winner Holistic Consultants – MySQL Schema (Hybrid)
--  api/db/schema.sql
--
--  Design: flat, queryable columns for the stable fields +
--  a JSON column ("data") holding the full original record
--  (including nested stages[], docs[], dynamic quotation fields).
--  This mirrors how the app already thinks about records while
--  giving you real SQL reporting on the columns that matter.
--
--  HOW TO LOAD:
--   1. cPanel → MySQL Databases → create a database + a user,
--      grant the user ALL PRIVILEGES on that database.
--   2. cPanel → phpMyAdmin → select that database → Import →
--      choose this file → Go.
--   3. Put the database name / user / password into
--      api/db/db.config.php
--
--  Requires MySQL 5.7+ or MariaDB 10.2+ (native JSON type).
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── USERS ─────────────────────────────────────────────────────
-- Fully relational (flat record). PIN stays SHA-256 hashed,
-- exactly as the current app produces it (hashPin()).
CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(64)  NOT NULL PRIMARY KEY,
  name              VARCHAR(190) NOT NULL,
  email             VARCHAR(190) NOT NULL DEFAULT '',
  role              VARCHAR(40)  NOT NULL,
  team              VARCHAR(60)  NOT NULL DEFAULT '',  -- Group/Team tag (Architecture, MEP, FLS, etc. — see DEP_TASK_DEPARTMENTS) — used to resolve "assigned to a department" on Dependent Tasks to the actual people on that team
  pin               CHAR(64)     NOT NULL,            -- SHA-256 hex
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  assigned_projects JSON         NULL,                -- array of project ids
  current_session   VARCHAR(64)  NULL,                -- one active session per user; see api/db/conn.php session_still_current()
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_name (name),
  KEY idx_role (role),
  KEY idx_active (active),
  KEY idx_team (team)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Existing database already loaded? Run this once to add the team column:
--   ALTER TABLE users ADD COLUMN team VARCHAR(60) NOT NULL DEFAULT '' AFTER role;
--   ALTER TABLE users ADD KEY idx_team (team);
-- Existing database already loaded? Run this once instead of the CREATE
-- TABLE above (which only runs for a brand-new install):
--   ALTER TABLE users ADD COLUMN current_session VARCHAR(64) NULL;

-- ── PROJECTS ──────────────────────────────────────────────────
-- Stable columns for filtering/reporting; "data" JSON holds the
-- full record (stages[], docs[], notes, attachment, etc.).
-- company = 'whc' | 'mw' | 'whsf'  (replaces the path prefix).
CREATE TABLE IF NOT EXISTS projects (
  id            VARCHAR(64)  NOT NULL,
  company       VARCHAR(16)  NOT NULL DEFAULT 'whc',
  title         VARCHAR(255) NULL,
  client        VARCHAR(255) NULL,
  status        VARCHAR(64)  NULL,
  coordinator   VARCHAR(190) NULL,
  project_type  VARCHAR(64)  NULL,
  erp_project_id VARCHAR(120) NULL,
  start_date    DATE         NULL,
  end_date      DATE         NULL,
  data          JSON         NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company, id),
  KEY idx_status (status),
  KEY idx_coordinator (coordinator),
  KEY idx_company (company)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── QUOTATIONS ────────────────────────────────────────────────
-- category = fitout | id | live | private
-- Stable columns + JSON for the dynamic per-category fields.
CREATE TABLE IF NOT EXISTS quotations (
  id            VARCHAR(64)  NOT NULL,
  company       VARCHAR(16)  NOT NULL DEFAULT 'whc',
  category      VARCHAR(32)  NOT NULL,
  qtn_number    VARCHAR(120) NULL,
  client        VARCHAR(255) NULL,
  status        VARCHAR(64)  NULL,
  gross_amount  DECIMAL(15,2) NULL,
  net_amount    DECIMAL(15,2) NULL,
  data          JSON         NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company, category, id),
  KEY idx_category (category),
  KEY idx_qtn_number (qtn_number),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SUMMARY ───────────────────────────────────────────────────
-- A single small document the dashboard reads/writes. Stored as
-- one row per company under a fixed key.
CREATE TABLE IF NOT EXISTS summary (
  company    VARCHAR(16) NOT NULL DEFAULT 'whc',
  skey       VARCHAR(64) NOT NULL DEFAULT 'summary',
  data       JSON        NOT NULL,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company, skey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ACTIVITY LOG ──────────────────────────────────────────────
-- Append-only. Time-ordered keys ("log_<ts>_...") preserved as id.
-- ── ACTIVITY LOG (structured, indexed — not a JSON blob per row) ──
-- Split into real columns so the log can actually be searched/filtered
-- server-side (by module, actor, project, date range) instead of pulling
-- every row and filtering in the browser. `meta` still holds free-form
-- extras (e.g. the field-by-field changes[] diff array) that don't need
-- their own column or their own index.
CREATE TABLE IF NOT EXISTS activity_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  company    VARCHAR(20)  NOT NULL DEFAULT 'whc',
  module     VARCHAR(40)  NOT NULL DEFAULT '',
  action     VARCHAR(120) NOT NULL DEFAULT '',
  actor      VARCHAR(190) NOT NULL DEFAULT '',   -- stable identity: email, falls back to name
  actor_name VARCHAR(190) NOT NULL DEFAULT '',
  role       VARCHAR(40)  NOT NULL DEFAULT '',
  target     VARCHAR(255) NOT NULL DEFAULT '',
  detail     TEXT         NULL,
  project_id VARCHAR(80)  NOT NULL DEFAULT '',
  meta       JSON         NULL,
  KEY idx_at (at),
  KEY idx_module_at (module, at),
  KEY idx_actor_at (actor, at),
  KEY idx_project_at (project_id, at),
  KEY idx_company_at (company, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── AUTH LOG ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  company    VARCHAR(20)  NOT NULL DEFAULT 'whc',
  action     VARCHAR(120) NOT NULL DEFAULT '',
  actor      VARCHAR(190) NOT NULL DEFAULT '',
  actor_name VARCHAR(190) NOT NULL DEFAULT '',
  target     VARCHAR(255) NOT NULL DEFAULT '',
  detail     TEXT         NULL,
  meta       JSON         NULL,
  KEY idx_at (at),
  KEY idx_actor_at (actor, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- ── Migrating an EXISTING database (already has the old id/at/data
-- schema)? Run this once instead of the CREATE TABLE statements above:
--
--   ALTER TABLE activity_log
--     ADD COLUMN company VARCHAR(20) NOT NULL DEFAULT 'whc' AFTER at,
--     ADD COLUMN module VARCHAR(40) NOT NULL DEFAULT '' AFTER company,
--     ADD COLUMN action VARCHAR(120) NOT NULL DEFAULT '' AFTER module,
--     ADD COLUMN actor VARCHAR(190) NOT NULL DEFAULT '' AFTER action,
--     ADD COLUMN actor_name VARCHAR(190) NOT NULL DEFAULT '' AFTER actor,
--     ADD COLUMN role VARCHAR(40) NOT NULL DEFAULT '' AFTER actor_name,
--     ADD COLUMN target VARCHAR(255) NOT NULL DEFAULT '' AFTER role,
--     ADD COLUMN detail TEXT NULL AFTER target,
--     ADD COLUMN project_id VARCHAR(80) NOT NULL DEFAULT '' AFTER detail,
--     ADD COLUMN meta JSON NULL AFTER project_id;
--   UPDATE activity_log SET
--     company    = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.company')), 'whc'),
--     module     = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.module')), ''),
--     action     = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.action')), ''),
--     actor      = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.by')), ''),
--     actor_name = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.byName')), ''),
--     role       = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.role')), ''),
--     target     = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.target')), ''),
--     detail     = JSON_UNQUOTE(JSON_EXTRACT(data,'$.detail')),
--     project_id = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.projectId')), ''),
--     meta       = JSON_EXTRACT(data,'$.changes')
--   WHERE module = '';
--   ALTER TABLE activity_log
--     ADD KEY idx_module_at (module, at),
--     ADD KEY idx_actor_at (actor, at),
--     ADD KEY idx_project_at (project_id, at),
--     ADD KEY idx_company_at (company, at);
--   -- (old `id` VARCHAR / `data` JSON columns can stay — harmless, just
--   -- unused going forward — or be dropped once you've confirmed the
--   -- migration looks right.)
--   -- Same pattern for auth_log (no module/project_id/role columns there).

-- ── DEPENDENT TASKS ───────────────────────────────────────────
-- Same hybrid pattern as projects/quotations: stable columns for
-- filtering/reporting (project, status, priority, assignee), plus a JSON
-- "data" column holding the full record (description, progress, raised-by,
-- status history, department label, etc.).
-- assignee_type = 'user' | 'department'
--   user       → assignee holds the user's email
--   department → assignee holds one of: Architecture | MEP | FLS |
--                Structural | Document Controller | Project Manager |
--                Resident Engineer
CREATE TABLE IF NOT EXISTS dependent_tasks (
  id            VARCHAR(64)  NOT NULL,
  company       VARCHAR(16)  NOT NULL DEFAULT 'whc',
  project_id    VARCHAR(64)  NOT NULL,
  title         VARCHAR(255) NOT NULL DEFAULT '',
  status        VARCHAR(32)  NOT NULL DEFAULT 'Open',
  priority      VARCHAR(20)  NOT NULL DEFAULT 'Medium',
  assignee_type VARCHAR(20)  NOT NULL DEFAULT 'department',
  assignee      VARCHAR(190) NOT NULL DEFAULT '',
  due_date      DATE         NULL,
  data          JSON         NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company, id),
  KEY idx_project (project_id),
  KEY idx_status (status),
  KEY idx_assignee (assignee),
  KEY idx_company (company)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
