-- Migration: Add editable_tabs column to employees
-- editable_tabs: comma-separated tab keys (empty = ALL tabs editable)
-- Tab keys: config,tt,sp,lz,monthly,dashboard,daily_dash,ads_eff,line,forecast,apm,audit
ALTER TABLE employees ADD COLUMN IF NOT EXISTS editable_tabs TEXT DEFAULT '';
