/**
 * สร้าง database + ตารางให้ตรงกับ server.js (daily_*, brands.code, config, …)
 * ใช้: set ADMIN_URL หรืออ่านจาก process.env
 *
 *   node scripts/init-production-db.js
 *
 * default: สร้าง DB ecom_dashboard บน localhost postgres (จาก we-platform .env)
 */
const { Client } = require('pg');

const ADMIN_URL =
  process.env.ADMIN_URL || 'postgresql://postgres:postgres123@localhost:5432/postgres';
const DB_NAME = process.env.ECOM_DB_NAME || 'ecom_dashboard';
const APP_URL =
  process.env.DATABASE_URL ||
  `postgresql://postgres:postgres123@localhost:5432/${DB_NAME}`;

const statements = [
  `CREATE TABLE IF NOT EXISTS brands (
    code VARCHAR(100) PRIMARY KEY,
    name VARCHAR(100) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(200) DEFAULT '',
    brands TEXT DEFAULT '',
    note TEXT DEFAULT '',
    is_admin BOOLEAN DEFAULT false,
    can_view TEXT DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS daily_tiktok (
    id SERIAL PRIMARY KEY,
    date DATE,
    brand VARCHAR(100),
    gmv NUMERIC(14,2) DEFAULT 0,
    orders INTEGER DEFAULT 0,
    sale_ads NUMERIC(14,2) DEFAULT 0,
    organic NUMERIC(14,2) DEFAULT 0,
    gmv_live NUMERIC(14,2) DEFAULT 0,
    cogs NUMERIC(14,2) DEFAULT 0,
    promo NUMERIC(14,2) DEFAULT 0,
    free NUMERIC(14,2) DEFAULT 0,
    kol NUMERIC(14,2) DEFAULT 0,
    prod_live NUMERIC(14,2) DEFAULT 0,
    comm_live NUMERIC(14,2) DEFAULT 0,
    comm_creator NUMERIC(14,2) DEFAULT 0,
    cost_gmv_ads NUMERIC(14,2) DEFAULT 0,
    cost_gmv_live NUMERIC(14,2) DEFAULT 0,
    total_exp NUMERIC(14,2) DEFAULT 0,
    nm NUMERIC(14,2) DEFAULT 0,
    nm_pct NUMERIC(14,4) DEFAULT 0,
    roas NUMERIC(14,4) DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS daily_shopee (
    id SERIAL PRIMARY KEY,
    date DATE,
    brand VARCHAR(100),
    gmv NUMERIC(14,2) DEFAULT 0,
    orders INTEGER DEFAULT 0,
    cogs NUMERIC(14,2) DEFAULT 0,
    promo NUMERIC(14,2) DEFAULT 0,
    free NUMERIC(14,2) DEFAULT 0,
    comm_creator NUMERIC(14,2) DEFAULT 0,
    plat_fee NUMERIC(14,2) DEFAULT 0,
    sp_ads NUMERIC(14,2) DEFAULT 0,
    fb_cpas NUMERIC(14,2) DEFAULT 0,
    affiliate NUMERIC(14,2) DEFAULT 0,
    search_ads NUMERIC(14,2) DEFAULT 0,
    shop_ads NUMERIC(14,2) DEFAULT 0,
    product_ads NUMERIC(14,2) DEFAULT 0,
    total_exp NUMERIC(14,2) DEFAULT 0,
    nm NUMERIC(14,2) DEFAULT 0,
    nm_pct NUMERIC(14,4) DEFAULT 0,
    roas NUMERIC(14,4) DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS daily_lazada (
    id SERIAL PRIMARY KEY,
    date DATE,
    brand VARCHAR(100),
    gmv NUMERIC(14,2) DEFAULT 0,
    orders INTEGER DEFAULT 0,
    cogs NUMERIC(14,2) DEFAULT 0,
    organic NUMERIC(14,2) DEFAULT 0,
    promo NUMERIC(14,2) DEFAULT 0,
    free NUMERIC(14,2) DEFAULT 0,
    comm_creator NUMERIC(14,2) DEFAULT 0,
    plat_fee NUMERIC(14,2) DEFAULT 0,
    lzsd NUMERIC(14,2) DEFAULT 0,
    lz_gmv_max NUMERIC(14,2) DEFAULT 0,
    aff_lz NUMERIC(14,2) DEFAULT 0,
    total_exp NUMERIC(14,2) DEFAULT 0,
    nm NUMERIC(14,2) DEFAULT 0,
    nm_pct NUMERIC(14,4) DEFAULT 0,
    roas NUMERIC(14,4) DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS apm_tasks (
    id SERIAL PRIMARY KEY,
    month VARCHAR(10) DEFAULT '',
    employee VARCHAR(100) DEFAULT '',
    brand VARCHAR(100) DEFAULT '',
    task TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    status VARCHAR(20) DEFAULT 'not_started',
    start_date DATE,
    due_date DATE,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ DEFAULT NOW(),
    user_name VARCHAR(100) DEFAULT '',
    action VARCHAR(50) DEFAULT '',
    platform VARCHAR(20) DEFAULT '',
    data_date VARCHAR(20) DEFAULT '',
    brand VARCHAR(100) DEFAULT '',
    field VARCHAR(100) DEFAULT '',
    old_val TEXT DEFAULT '',
    new_val TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tt_date_brand ON daily_tiktok(date, brand)`,
  `CREATE INDEX IF NOT EXISTS idx_sp_date_brand ON daily_shopee(date, brand)`,
  `CREATE INDEX IF NOT EXISTS idx_lz_date_brand ON daily_lazada(date, brand)`,
  `CREATE INDEX IF NOT EXISTS idx_apm_month ON apm_tasks(month)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC)`,
];

const seeds = [
  `INSERT INTO brands (code, name) VALUES
    ('BRD_A','BRD_A'),('BRD_B','BRD_B'),('BRD_C','BRD_C'),
    ('BRD_D','BRD_D'),('BRD_E','BRD_E'),('BRD_F','BRD_F')
   ON CONFLICT (code) DO NOTHING`,
];

async function main() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rows } = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [DB_NAME]
  );
  if (rows.length === 0) {
    await admin.query('CREATE DATABASE ' + DB_NAME.replace(/[^a-zA-Z0-9_]/g, ''));
    console.log('Created database:', DB_NAME);
  } else {
    console.log('Database exists:', DB_NAME);
  }
  await admin.end();

  const app = new Client({ connectionString: APP_URL });
  await app.connect();
  for (const sql of statements) {
    await app.query(sql);
  }
  await app.query(seeds[0]);
  const { rows: ec } = await app.query('SELECT COUNT(*)::int AS c FROM employees');
  if (ec[0].c === 0) {
    await app.query(
      `INSERT INTO employees (name, email) VALUES
        ('พนักงาน 1',''),('พนักงาน 2',''),('พนักงาน 3',''),
        ('พนักงาน 4',''),('พนักงาน 5','')`
    );
  }
  await app.end();
  console.log('Schema ready. DATABASE_URL=', APP_URL.replace(/:[^:@]+@/, ':****@'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
