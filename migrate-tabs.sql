-- Migration: Add visible_tabs column to employees
-- visible_tabs: comma-separated tab keys (empty = ALL tabs visible)
-- Tab keys: config,tt,sp,lz,monthly,dashboard,daily_dash,ads_eff,line,forecast,apm,audit
ALTER TABLE employees ADD COLUMN IF NOT EXISTS visible_tabs TEXT DEFAULT '';
