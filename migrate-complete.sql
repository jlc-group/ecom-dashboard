-- ============================================================
-- Migration: Add missing tables & columns for full data sync
-- Run: psql $DATABASE_URL -f migrate-complete.sql
-- ============================================================

-- 1. Add target_nm column to brands table
ALTER TABLE brands ADD COLUMN IF NOT EXISTS target_nm NUMERIC DEFAULT 8.5;

-- 2. Create forecast table for monthly GMV targets
CREATE TABLE IF NOT EXISTS forecast (
  id SERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  platform TEXT NOT NULL,      -- tt, sp, lz
  month_index INTEGER NOT NULL, -- 0-11 (Jan-Dec)
  value NUMERIC DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forecast_brand ON forecast (brand);

-- 3. Create config table (key-value store) if not exists
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Done!
SELECT 'Migration complete!' AS status;
