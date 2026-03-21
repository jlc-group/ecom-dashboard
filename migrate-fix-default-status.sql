-- ============================================================
-- Fix: เปลี่ยน DEFAULT status จาก 'approved' เป็น 'pending'
-- เพื่อให้ user ใหม่ต้องรอ Admin อนุมัติก่อน
-- Run: psql $DATABASE_URL -f migrate-fix-default-status.sql
-- ============================================================

ALTER TABLE employees ALTER COLUMN status SET DEFAULT 'pending';
