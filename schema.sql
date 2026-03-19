-- ============================================================
-- ECOM Dashboard — PostgreSQL Schema
-- ============================================================

-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id     SERIAL PRIMARY KEY,
  name   VARCHAR(100) NOT NULL,
  brands TEXT DEFAULT '',
  note   TEXT DEFAULT ''
);

-- Platform data — TikTok
CREATE TABLE IF NOT EXISTS platform_tt (
  id             SERIAL PRIMARY KEY,
  date           DATE,
  brand          VARCHAR(100),
  gmv            NUMERIC(14,2) DEFAULT 0,
  orders         INTEGER DEFAULT 0,
  sale_ads       NUMERIC(14,2) DEFAULT 0,
  organic        NUMERIC(14,2) DEFAULT 0,
  gmv_live       NUMERIC(14,2) DEFAULT 0,
  cogs           NUMERIC(14,2) DEFAULT 0,
  promo          NUMERIC(14,2) DEFAULT 0,
  free           NUMERIC(14,2) DEFAULT 0,
  kol            NUMERIC(14,2) DEFAULT 0,
  prod_live      NUMERIC(14,2) DEFAULT 0,
  comm_live      NUMERIC(14,2) DEFAULT 0,
  comm_creator   NUMERIC(14,2) DEFAULT 0,
  cost_gmv_ads   NUMERIC(14,2) DEFAULT 0,
  cost_gmv_live  NUMERIC(14,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Platform data — Shopee
CREATE TABLE IF NOT EXISTS platform_sp (
  id             SERIAL PRIMARY KEY,
  date           DATE,
  brand          VARCHAR(100),
  gmv            NUMERIC(14,2) DEFAULT 0,
  orders         INTEGER DEFAULT 0,
  cogs           NUMERIC(14,2) DEFAULT 0,
  promo          NUMERIC(14,2) DEFAULT 0,
  free           NUMERIC(14,2) DEFAULT 0,
  comm_creator   NUMERIC(14,2) DEFAULT 0,
  plat_fee       NUMERIC(14,2) DEFAULT 0,
  sp_ads         NUMERIC(14,2) DEFAULT 0,
  fb_cpas        NUMERIC(14,2) DEFAULT 0,
  affiliate      NUMERIC(14,2) DEFAULT 0,
  search_ads     NUMERIC(14,2) DEFAULT 0,
  shop_ads       NUMERIC(14,2) DEFAULT 0,
  product_ads    NUMERIC(14,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Platform data — Lazada
CREATE TABLE IF NOT EXISTS platform_lz (
  id             SERIAL PRIMARY KEY,
  date           DATE,
  brand          VARCHAR(100),
  gmv            NUMERIC(14,2) DEFAULT 0,
  orders         INTEGER DEFAULT 0,
  organic        NUMERIC(14,2) DEFAULT 0,
  cogs           NUMERIC(14,2) DEFAULT 0,
  promo          NUMERIC(14,2) DEFAULT 0,
  free           NUMERIC(14,2) DEFAULT 0,
  comm_creator   NUMERIC(14,2) DEFAULT 0,
  plat_fee       NUMERIC(14,2) DEFAULT 0,
  lzsd           NUMERIC(14,2) DEFAULT 0,
  lz_gmv_max     NUMERIC(14,2) DEFAULT 0,
  aff_lz         NUMERIC(14,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- APM Tasks (task management)
CREATE TABLE IF NOT EXISTS apm_tasks (
  id          SERIAL PRIMARY KEY,
  month       VARCHAR(10) DEFAULT '',
  employee    VARCHAR(100) DEFAULT '',
  brand       VARCHAR(100) DEFAULT '',
  task        TEXT DEFAULT '',
  detail      TEXT DEFAULT '',
  status      VARCHAR(20) DEFAULT 'not_started',
  start_date  DATE,
  due         DATE,
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ DEFAULT NOW(),
  "user"     VARCHAR(100) DEFAULT '',
  action     VARCHAR(50) DEFAULT '',
  platform   VARCHAR(20) DEFAULT '',
  data_date  VARCHAR(20) DEFAULT '',
  brand      VARCHAR(100) DEFAULT '',
  field      VARCHAR(100) DEFAULT '',
  old_val    TEXT DEFAULT '',
  new_val    TEXT DEFAULT ''
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tt_date_brand   ON platform_tt(date, brand);
CREATE INDEX IF NOT EXISTS idx_sp_date_brand   ON platform_sp(date, brand);
CREATE INDEX IF NOT EXISTS idx_lz_date_brand   ON platform_lz(date, brand);
CREATE INDEX IF NOT EXISTS idx_apm_month       ON apm_tasks(month);
CREATE INDEX IF NOT EXISTS idx_audit_ts        ON audit_log(ts DESC);

-- Default brands
INSERT INTO brands (name) VALUES
  ('BRD_A'),('BRD_B'),('BRD_C'),('BRD_D'),('BRD_E'),('BRD_F')
ON CONFLICT (name) DO NOTHING;

-- Default employees
INSERT INTO employees (name) VALUES
  ('พนักงาน 1'),('พนักงาน 2'),('พนักงาน 3'),('พนักงาน 4'),('พนักงาน 5')
ON CONFLICT DO NOTHING;
