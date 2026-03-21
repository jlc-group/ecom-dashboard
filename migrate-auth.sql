-- ============================================================
-- Migration: Add Google Auth + Admin Approval columns to employees
-- Run: psql $DATABASE_URL -f migrate-auth.sql
-- ============================================================

-- Add new columns (IF NOT EXISTS prevents errors if already added)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS picture TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
-- status values: 'pending', 'approved', 'rejected'

-- Existing employees (ที่อยู่ก่อน migration) auto-approved
UPDATE employees SET status = 'approved' WHERE status IS NULL OR status = '';

-- Index for fast lookup by email and google_id
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees (email);
CREATE INDEX IF NOT EXISTS idx_employees_google_id ON employees (google_id);
