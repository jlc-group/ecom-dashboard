/**
 * ตั้ง is_admin + approved ให้อีเมลที่ระบุ (อัปเดตแถวที่มีอยู่ หรือ INSERT ถ้ายังไม่มี)
 * ใช้: จากโฟลเดอร์โปรเจกต์ที่มี .env
 *   node scripts/set-admin-users.js email1@... email2@...
 */
require('dotenv').config();
const { Client } = require('pg');

const emails = process.argv.slice(2).filter(Boolean);
if (emails.length === 0) {
  console.error('Usage: node scripts/set-admin-users.js email@... [email2@...]');
  process.exit(1);
}

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await c.connect();
  for (const email of emails) {
    const u = await c.query(
      `UPDATE employees SET is_admin = true, status = 'approved'
       WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
       RETURNING id, email, is_admin, status`,
      [email]
    );
    if (u.rowCount === 0) {
      const name = email.split('@')[0];
      const ins = await c.query(
        `INSERT INTO employees (name, email, brands, note, is_admin, status)
         VALUES ($1, $2, '', '', true, 'approved')
         RETURNING id, email, is_admin, status`,
        [name, email]
      );
      console.log('INSERT', ins.rows[0]);
    } else {
      console.log('UPDATE', u.rows[0]);
    }
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
