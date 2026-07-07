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
  pin               CHAR(64)     NOT NULL,            -- SHA-256 hex
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  assigned_projects JSON         NULL,                -- array of project ids
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_name (name),
  KEY idx_role (role),
  KEY idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
CREATE TABLE IF NOT EXISTS activity_log (
  id         VARCHAR(80) NOT NULL PRIMARY KEY,
  at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data       JSON        NOT NULL,
  KEY idx_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── AUTH LOG ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_log (
  id         VARCHAR(80) NOT NULL PRIMARY KEY,
  at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data       JSON        NOT NULL,
  KEY idx_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
