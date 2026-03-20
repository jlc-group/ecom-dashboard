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
const PORT = process.env.PORT || 8088;

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

// Columns that are TEXT (not numeric) — everything else is numeric
const TEXT_COLS = new Set(['date', 'brand', 'month', 'employee', 'task', 'detail', 'status',
  'start_date', 'due', 'note', 'name', 'email', 'brands', 'action', 'platform',
  'data_date', 'field', 'old_val', 'new_val', 'user', 'user_name', 'ts', 'due_date',
  'google_id', 'picture', 'visible_tabs']);

// Convert empty strings to null for numeric columns
function cleanVal(col, val) {
  if (TEXT_COLS.has(col)) return val ?? null;
  if (val === '' || val === undefined || val === null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// Generate SQL placeholders: "$1,$2,$3,..." — using function to prevent linter issues
function makePH(count) {
  const arr = [];
  for (let i = 1; i <= count; i++) arr.push('$' + i);
  return arr.join(',');
}

// ============================================================
// COLUMN MAPS per platform (camelCase keys → snake_case cols)
// ============================================================
// Table name mapping — DB ใช้ชื่อ daily_* ไม่ใช่ platform_*
const TABLE_MAP = { tt: 'daily_tiktok', sp: 'daily_shopee', lz: 'daily_lazada' };

const PLAT_COLS = {
  tt: ['date','brand','gmv','orders','sale_ads','organic','gmv_live',
       'cogs','promo','free','kol','prod_live','comm_live','comm_creator',
       'cost_gmv_ads','cost_gmv_live','total_exp','nm','nm_pct','roas'],
  sp: ['date','brand','gmv','orders','cogs','promo','free','comm_creator',
       'plat_fee','sp_ads','fb_cpas','affiliate','search_ads','shop_ads',
       'product_ads','total_exp','nm','nm_pct','roas'],
  lz: ['date','brand','gmv','orders','cogs','organic','promo','free',
       'comm_creator','plat_fee','lzsd','lz_gmv_max','aff_lz',
       'total_exp','nm','nm_pct','roas'],
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

// POST /api/auth/google — verify Google ID token, auto-register if new, return JWT
app.post('/api/auth/google', async (req, res) => {
  if (!googleClient) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  }
  try {
    var credential = req.body.credential;
    var ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    var payload = ticket.getPayload();
    var email = payload.email;
    var name = payload.name || email.split('@')[0];
    var picture = payload.picture || '';
    var googleId = payload.sub;

    // Check if user exists by email or google_id
    var result = await pool.query(
      'SELECT * FROM employees WHERE LOWER(email) = LOWER($1) OR google_id = $2',
      [email, googleId]
    );

    var emp;
    if (result.rows.length === 0) {
      // Auto-register: create new user with status='pending'
      var insertResult = await pool.query(
        'INSERT INTO employees (name, email, google_id, picture, status, is_admin) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [name, email, googleId, picture, 'pending', false]
      );
      emp = rowToCamel(insertResult.rows[0]);
      return res.json({
        status: 'pending',
        message: 'ลงทะเบียนสำเร็จ! กรุณารอ Admin อนุมัติ',
        user: { name: emp.name, email: emp.email, picture: emp.picture, status: 'pending' }
      });
    }

    // User exists — update google_id and picture if needed
    emp = result.rows[0];
    if (!emp.google_id || !emp.picture) {
      await pool.query(
        'UPDATE employees SET google_id = COALESCE(google_id, $1), picture = COALESCE(picture, $2) WHERE id = $3',
        [googleId, picture, emp.id]
      );
    }
    emp = rowToCamel(emp);

    // Check approval status
    if (emp.status === 'pending') {
      return res.json({
        status: 'pending',
        message: 'บัญชีของคุณกำลังรอ Admin อนุมัติ',
        user: { name: emp.name, email: emp.email, picture: emp.picture, status: 'pending' }
      });
    }
    if (emp.status === 'rejected') {
      return res.status(403).json({
        error: 'REJECTED',
        message: 'บัญชีของคุณถูกปฏิเสธ กรุณาติดต่อ Admin'
      });
    }

    // Approved — issue JWT
    var token = jwt.sign(
      { sub: emp.id, email: emp.email, name: emp.name, isAdmin: emp.isAdmin, visibleTabs: emp.visible_tabs || '' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    // Re-read with visible_tabs
    var freshRow = await pool.query('SELECT * FROM employees WHERE id = $1', [emp.id]);
    var freshEmp = rowToCamel(freshRow.rows[0]);
    res.json({ status: 'approved', token: token, user: freshEmp });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'AUTH_FAILED', message: 'การยืนยันตัวตนล้มเหลว' });
  }
});

// GET /api/admin/pending-users — Admin: list pending users
app.get('/api/admin/pending-users', requireAuth, async function(req, res) {
  try {
    var result = await pool.query(
      'SELECT id, name, email, picture, status, google_id FROM employees WHERE status = $1 ORDER BY id DESC',
      ['pending']
    );
    res.json(result.rows.map(rowToCamel));
  } catch (err) {
    console.error('GET /api/admin/pending-users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/all-users — Admin: list all users with status
app.get('/api/admin/all-users', requireAuth, async function(req, res) {
  try {
    var result = await pool.query(
      'SELECT id, name, email, picture, status, is_admin, google_id, visible_tabs FROM employees ORDER BY id'
    );
    res.json(result.rows.map(rowToCamel));
  } catch (err) {
    console.error('GET /api/admin/all-users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/approve-user — Admin: approve or reject a user
app.post('/api/admin/approve-user', requireAuth, async function(req, res) {
  try {
    var userId = req.body.userId;
    var action = req.body.action; // 'approve' or 'reject'
    if (!userId || !action) {
      return res.status(400).json({ error: 'userId and action required' });
    }
    var newStatus = action === 'approve' ? 'approved' : 'rejected';
    await pool.query('UPDATE employees SET status = $1 WHERE id = $2', [newStatus, userId]);
    res.json({ success: true, userId: userId, status: newStatus });
  } catch (err) {
    console.error('POST /api/admin/approve-user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/set-visible-tabs — Admin: set which tabs a user can see
app.post('/api/admin/set-visible-tabs', requireAuth, async function(req, res) {
  try {
    var userId = req.body.userId;
    var visibleTabs = req.body.visibleTabs || ''; // comma-separated tab keys, empty = all
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    await pool.query('UPDATE employees SET visible_tabs = $1 WHERE id = $2', [visibleTabs, userId]);
    res.json({ success: true, userId: userId, visibleTabs: visibleTabs });
  } catch (err) {
    console.error('POST /api/admin/set-visible-tabs error:', err);
    res.status(500).json({ error: err.message });
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
    const [brands, employees, tt, sp, lz, apmTasks, auditLog, fcRow] = await Promise.all([
      pool.query('SELECT name FROM brands ORDER BY name'),
      pool.query('SELECT id, name, email, brands, note, is_admin, status, picture, visible_tabs FROM employees WHERE status = $1 ORDER BY id', ['approved']),
      pool.query('SELECT * FROM daily_tiktok ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM daily_shopee ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM daily_lazada ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM apm_tasks ORDER BY id DESC'),
      pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 2000'),
      pool.query("SELECT value FROM config WHERE key = 'forecast_gmv_json' LIMIT 1"),
    ]);

    let forecastGMV = {};
    if (fcRow.rows.length > 0) {
      try { forecastGMV = JSON.parse(fcRow.rows[0].value); } catch(e) {}
    }

    res.json({
      brands:      brands.rows.map(r => r.name),
      employees:   employees.rows.map(rowToCamel),
      tt:          tt.rows.map(rowToCamel),
      sp:          sp.rows.map(rowToCamel),
      lz:          lz.rows.map(rowToCamel),
      apmTasks:    apmTasks.rows.map(rowToCamel),
      auditLog:    auditLog.rows.map(rowToCamel),
      forecastGMV: forecastGMV,
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

    // --- Platform data FIRST (FK: daily_*.brand → brands.code) ---
    for (const plat of ['tt', 'sp', 'lz']) {
      const table = TABLE_MAP[plat];
      await client.query('DELETE FROM ' + table);
    }

    // --- Brands (safe to delete now that daily tables are empty) ---
    if (Array.isArray(db.brands)) {
      await client.query('DELETE FROM brands');
      for (const name of db.brands) {
        await client.query('INSERT INTO brands (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [name]);
      }
    }

    // --- Employees (preserve google_id, status, picture) ---
    if (Array.isArray(db.employees)) {
      var existingEmps = await client.query('SELECT id, email, google_id, status, picture FROM employees');
      var empMap = {};
      existingEmps.rows.forEach(function(r){ if(r.email) empMap[r.email.toLowerCase()] = r; });
      var newEmpEmails = db.employees.map(function(e){ return (e.email||'').toLowerCase(); }).filter(Boolean);
      for (var row of existingEmps.rows) {
        if(row.email && !newEmpEmails.includes(row.email.toLowerCase())){
          await client.query('DELETE FROM employees WHERE id = $1', [row.id]);
        }
      }
      for (var emp of db.employees) {
        var empKey = (emp.email||'').toLowerCase();
        var exEmp = empMap[empKey];
        if(exEmp){
          await client.query(
            'UPDATE employees SET name=$1, brands=$2, note=$3, is_admin=$4 WHERE id=$5',
            [emp.name||'', emp.brands||'', emp.note||'', emp.isAdmin||false, exEmp.id]
          );
        } else {
          await client.query(
            'INSERT INTO employees (name, email, brands, note, is_admin, status) VALUES ($1,$2,$3,$4,$5,$6)',
            [emp.name||'', emp.email||'', emp.brands||'', emp.note||'', emp.isAdmin||false, 'approved']
          );
        }
      }
    }

    // --- Re-insert platform data ---
    for (const plat of ['tt', 'sp', 'lz']) {
      if (!Array.isArray(db[plat])) continue;
      const table = TABLE_MAP[plat];
      const cols  = PLAT_COLS[plat];
      const ph    = makePH(cols.length);
      for (const row of db[plat]) {
        const snake = rowToSnake(row);
        const vals  = cols.map(c => cleanVal(c, snake[c]));
        await client.query(
          'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + ph + ')',
          vals
        );
      }
    }

    // --- APM Tasks ---
    if (Array.isArray(db.apmTasks)) {
      await client.query('DELETE FROM apm_tasks');
      for (const t of db.apmTasks) {
        await client.query(
          'INSERT INTO apm_tasks (month, employee, brand, task, detail, status, start_date, due_date, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [t.month||'', t.employee||'', t.brand||'', t.task||'', t.detail||'',
           t.status||'not_started', t.startDate||null, t.due||null, t.note||'']
        );
      }
    }

    // --- Audit Log (append only, don't delete) ---
    if (Array.isArray(db.auditLog)) {
      for (const e of db.auditLog) {
        if (e.id && typeof e.id === 'number' && e.id > 1e12) {
          await client.query(
            'INSERT INTO audit_log (ts, user_name, action, platform, data_date, brand, field, old_val, new_val) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [e.ts||new Date().toISOString(), e.user||'', e.action||'', e.platform||'',
             e.dataDate||'', e.brand||'', e.field||'', e.oldVal||'', e.newVal||'']
          );
        }
      }
    }

    // --- Forecast GMV (store as JSON in config) ---
    if (db.forecastGMV && typeof db.forecastGMV === 'object') {
      const fcJson = JSON.stringify(db.forecastGMV);
      await client.query(
        "INSERT INTO config (key, value) VALUES ('forecast_gmv_json', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [fcJson]
      );
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
      'INSERT INTO audit_log (ts, user_name, action, platform, data_date, brand, field, old_val, new_val) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
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
  try {
    const { rows } = await pool.query('SELECT name FROM brands ORDER BY name');
    res.json(rows.map(r => r.name));
  } catch (err) {
    console.error('GET /api/brands error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/brands', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM brands');
    for (const name of req.body.brands || []) {
      await client.query('INSERT INTO brands (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [name]);
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
  try {
    const { rows } = await pool.query('SELECT id, name, email, brands, note, is_admin, status, picture, visible_tabs FROM employees WHERE status = $1 ORDER BY id', ['approved']);
    res.json(rows.map(rowToCamel));
  } catch (err) {
    console.error('GET /api/employees error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/employees', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // UPSERT: update existing by email, insert new ones — preserve google_id, status, picture
    var employees = req.body.employees || [];
    // Get existing employees to preserve auth fields
    var existing = await client.query('SELECT id, email, google_id, status, picture, visible_tabs FROM employees');
    var existingMap = {};
    existing.rows.forEach(function(r){ if(r.email) existingMap[r.email.toLowerCase()] = r; });

    // Delete employees not in the new list
    var newEmails = employees.map(function(e){ return (e.email||'').toLowerCase(); }).filter(Boolean);
    for (var row of existing.rows) {
      if(row.email && !newEmails.includes(row.email.toLowerCase())){
        await client.query('DELETE FROM employees WHERE id = $1', [row.id]);
      }
    }

    // Upsert each employee
    for (var e of employees) {
      var emailKey = (e.email||'').toLowerCase();
      var ex = existingMap[emailKey];
      if(ex){
        // Update existing — keep google_id, status, picture
        await client.query(
          'UPDATE employees SET name=$1, brands=$2, note=$3, is_admin=$4 WHERE id=$5',
          [e.name||'', e.brands||'', e.note||'', e.isAdmin||false, ex.id]
        );
      } else {
        // Insert new — status=approved (admin added them manually)
        await client.query(
          'INSERT INTO employees (name, email, brands, note, is_admin, status) VALUES ($1,$2,$3,$4,$5,$6)',
          [e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false, 'approved']
        );
      }
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
['tt', 'sp', 'lz'].forEach(function(plat) {
  var table = TABLE_MAP[plat];
  var cols  = PLAT_COLS[plat];
  var ph    = makePH(cols.length);

  app.get('/api/platform/' + plat, requireAuth, async function(req, res) {
    const { rows } = await pool.query('SELECT * FROM ' + table + ' ORDER BY date DESC, brand');
    res.json(rows.map(rowToCamel));
  });

  app.put('/api/platform/' + plat, requireAuth, async function(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM ' + table);
      for (const row of req.body.rows || []) {
        const snake = rowToSnake(row);
        const vals  = cols.map(function(c) { return cleanVal(c, snake[c]); });
        await client.query('INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + ph + ')', vals);
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
});

// ============================================================
// Daily data aliases — frontend เรียก /api/daily/:plat + /api/daily/:plat/bulk
// ============================================================
['tt', 'sp', 'lz'].forEach(function(plat) {
  var table = TABLE_MAP[plat];
  var cols  = PLAT_COLS[plat];
  var ph    = makePH(cols.length);

  app.get('/api/daily/' + plat, requireAuth, async function(req, res) {
    const { rows } = await pool.query('SELECT * FROM ' + table + ' ORDER BY date DESC, brand');
    res.json(rows.map(rowToCamel));
  });

  app.put('/api/daily/' + plat + '/bulk', requireAuth, async function(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rows = req.body.rows || req.body;
      const dataRows = Array.isArray(rows) ? rows : [];
      const brands = [...new Set(dataRows.map(function(r) { return r.brand; }).filter(Boolean))];
      for (const brand of brands) {
        await client.query('DELETE FROM ' + table + ' WHERE brand = $1', [brand]);
      }
      for (const row of dataRows) {
        const snake = rowToSnake(row);
        const vals  = cols.map(function(c) { return cleanVal(c, snake[c]); });
        await client.query('INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + ph + ')', vals);
      }
      await client.query('COMMIT');
      res.json({ success: true, count: dataRows.length });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PUT /api/daily/' + plat + '/bulk error:', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });
});

// ============================================================
// Forecast endpoint (placeholder)
// ============================================================
app.get('/api/forecast', requireAuth, async (req, res) => {
  res.json([]);
});

// ============================================================
// Audit with query param
// ============================================================
app.get('/api/audit', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 2000;
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT $1', [limit]);
  res.json(rows.map(rowToCamel));
});

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
        'INSERT INTO apm_tasks (month, employee, brand, task, detail, status, start_date, due_date, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
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
// Config key-value store (for LINE templates etc.)
// ============================================================
app.get('/api/config/:key', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT value FROM config WHERE key = $1', [req.params.key]);
    res.json({ value: rows.length > 0 ? rows[0].value : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config/:key', requireAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    await pool.query(
      'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
// Global error handling — prevent server crash
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (server still running):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection (server still running):', err.message || err);
});

// ============================================================
// Start
// ============================================================
app.listen(PORT, function() {
  console.log('ECOM Dashboard API running on port ' + PORT);
});
