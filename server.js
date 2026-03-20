// ============================================================
// ECOM Dashboard — Express API Server
// ============================================================
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
const path    = require('path');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));   // serve index.html

// --- PostgreSQL Pool ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// --- Google OAuth ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ============================================================
// HELPER: camelCase ↔ snake_case
// ============================================================
const toSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const toCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function rowToCamel(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

function rowToSnake(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (['id','created_at','updated_at','createdAt','updatedAt'].includes(k)) continue;
    out[toSnake(k)] = v;
  }
  return out;
}

// ============================================================
// COLUMN MAPS per platform (camelCase keys → snake_case cols)
// ============================================================
const PLAT_COLS = {
  tt: ['date','brand','gmv','orders','sale_ads','organic','gmv_live',
       'cogs','promo','free','kol','prod_live','comm_live','comm_creator',
       'cost_gmv_ads','cost_gmv_live'],
  sp: ['date','brand','gmv','orders','cogs','promo','free','comm_creator',
       'plat_fee','sp_ads','fb_cpas','affiliate','search_ads','shop_ads','product_ads'],
  lz: ['date','brand','gmv','orders','organic','cogs','promo','free',
       'comm_creator','plat_fee','lzsd','lz_gmv_max','aff_lz'],
};

// ============================================================
// AUTH: Middleware & Endpoints
// ============================================================
function requireAuth(req, res, next) {
  if (!GOOGLE_CLIENT_ID) return next(); // skip auth if not configured
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const token = authHeader.replace('Bearer ', '');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

// POST /api/auth/google — verify Google ID token, return JWT
app.post('/api/auth/google', async (req, res) => {
  if (!googleClient) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  }
  try {
    const { credential } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    const { rows } = await pool.query(
      'SELECT * FROM employees WHERE LOWER(email) = LOWER($1)', [email]
    );
    if (rows.length === 0) {
      return res.status(403).json({
        error: 'NOT_FOUND',
        message: 'ไม่พบ email นี้ในระบบ กรุณาติดต่อ Admin'
      });
    }
    const emp = rowToCamel(rows[0]);
    const token = jwt.sign(
      { sub: emp.id, email: emp.email, name: emp.name, isAdmin: emp.isAdmin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: emp });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'AUTH_FAILED', message: 'การยืนยันตัวตนล้มเหลว' });
  }
});

// GET /api/auth/me — verify JWT, return user info
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1', [decoded.sub]);
    if (rows.length === 0) return res.status(401).json({ error: 'USER_NOT_FOUND' });
    res.json({ user: rowToCamel(rows[0]) });
  } catch (err) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
});

// GET /api/config — return public config (Google Client ID)
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// ============================================================
// GET /api/data — Load entire DB (mimics the old loadDB)
// ============================================================
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const [brands, employees, tt, sp, lz, apmTasks, auditLog] = await Promise.all([
      pool.query('SELECT name FROM brands ORDER BY id'),
      pool.query('SELECT id, name, email, brands, note, is_admin, can_view FROM employees ORDER BY id'),
      pool.query('SELECT * FROM platform_tt ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM platform_sp ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM platform_lz ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM apm_tasks ORDER BY id DESC'),
      pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 2000'),
    ]);

    res.json({
      brands:    brands.rows.map(r => r.name),
      employees: employees.rows.map(rowToCamel),
      tt:        tt.rows.map(rowToCamel),
      sp:        sp.rows.map(rowToCamel),
      lz:        lz.rows.map(rowToCamel),
      apmTasks:  apmTasks.rows.map(rowToCamel),
      auditLog:  auditLog.rows.map(rowToCamel),
    });
  } catch (err) {
    console.error('GET /api/data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PUT /api/data — Save entire DB (mimics the old saveDB)
// ============================================================
app.put('/api/data', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const db = req.body;

    // --- Brands ---
    if (Array.isArray(db.brands)) {
      await client.query('DELETE FROM brands');
      for (const name of db.brands) {
        await client.query('INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
      }
    }

    // --- Employees ---
    if (Array.isArray(db.employees)) {
      await client.query('DELETE FROM employees');
      for (const e of db.employees) {
        await client.query(
          'INSERT INTO employees (name, email, brands, note, is_admin, can_view) VALUES ($1,$2,$3,$4,$5,$6)',
          [e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false, JSON.stringify(e.canView||[])]
        );
      }
    }

    // --- Platform data ---
    for (const plat of ['tt', 'sp', 'lz']) {
      if (!Array.isArray(db[plat])) continue;
      const table = `platform_${plat}`;
      const cols  = PLAT_COLS[plat];
      await client.query(`DELETE FROM ${table}`);

      for (const row of db[plat]) {
        const snake = rowToSnake(row);
        const vals  = cols.map(c => snake[c] ?? null);
        const ph    = cols.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph})`,
          vals
        );
      }
    }

    // --- APM Tasks ---
    if (Array.isArray(db.apmTasks)) {
      await client.query('DELETE FROM apm_tasks');
      for (const t of db.apmTasks) {
        await client.query(
          `INSERT INTO apm_tasks (month, employee, brand, task, detail, status, start_date, due, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [t.month||'', t.employee||'', t.brand||'', t.task||'', t.detail||'',
           t.status||'not_started', t.startDate||null, t.due||null, t.note||'']
        );
      }
    }

    // --- Audit Log (append only, don't delete) ---
    if (Array.isArray(db.auditLog)) {
      for (const e of db.auditLog) {
        // Only insert if it doesn't already have a DB id
        if (e.id && typeof e.id === 'number' && e.id > 1e12) {
          // Client-generated id (timestamp) → insert new
          await client.query(
            `INSERT INTO audit_log (ts, "user", action, platform, data_date, brand, field, old_val, new_val)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [e.ts||new Date().toISOString(), e.user||'', e.action||'', e.platform||'',
             e.dataDate||'', e.brand||'', e.field||'', e.oldVal||'', e.newVal||'']
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, savedBy: req.headers['x-user'] || '' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/data error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// POST /api/audit — Append single audit entry
// ============================================================
app.post('/api/audit', requireAuth, async (req, res) => {
  try {
    const e = req.body;
    await pool.query(
      `INSERT INTO audit_log (ts, "user", action, platform, data_date, brand, field, old_val, new_val)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.ts||new Date().toISOString(), e.user||'', e.action||'', e.platform||'',
       e.dataDate||'', e.brand||'', e.field||'', e.oldVal||'', e.newVal||'']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/audit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Brands CRUD
// ============================================================
app.get('/api/brands', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM brands ORDER BY id');
  res.json(rows.map(r => r.name));
});

app.put('/api/brands', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM brands');
    for (const name of req.body.brands || []) {
      await client.query('INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// Employees CRUD
// ============================================================
app.get('/api/employees', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, brands, note, is_admin, can_view FROM employees ORDER BY id');
  res.json(rows.map(rowToCamel));
});

app.put('/api/employees', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM employees');
    for (const e of req.body.employees || []) {
      await client.query(
        'INSERT INTO employees (name, email, brands, note, is_admin, can_view) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false, JSON.stringify(e.canView||[])]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// Platform data CRUD — generic per platform
// ============================================================
for (const plat of ['tt', 'sp', 'lz']) {
  const table = `platform_${plat}`;
  const cols  = PLAT_COLS[plat];

  app.get(`/api/platform/${plat}`, requireAuth, async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY date DESC, brand`);
    res.json(rows.map(rowToCamel));
  });

  app.put(`/api/platform/${plat}`, requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${table}`);
      for (const row of req.body.rows || []) {
        const snake = rowToSnake(row);
        const vals  = cols.map(c => snake[c] ?? null);
        const ph    = cols.map((_, i) => `$${i + 1}`).join(',');
        await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph})`, vals);
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });
}

// ============================================================
// APM Tasks CRUD
// ============================================================
app.get('/api/apm-tasks', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM apm_tasks ORDER BY id DESC');
  res.json(rows.map(rowToCamel));
});

app.put('/api/apm-tasks', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM apm_tasks');
    for (const t of req.body.tasks || []) {
      await client.query(
        `INSERT INTO apm_tasks (month, employee, brand, task, detail, status, start_date, due, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [t.month||'', t.employee||'', t.brand||'', t.task||'', t.detail||'',
         t.status||'not_started', t.startDate||null, t.due||null, t.note||'']
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// Health check
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

// ============================================================
// Fallback → index.html
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// Start
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ ECOM Dashboard API running on port ${PORT}`);
});
