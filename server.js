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
const SERVER_VERSION = '2026-03-22-v2'; // ใช้เช็คว่า server รัน code ใหม่จริง

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ป้องกัน browser + CDN cache — ให้โหลด code ใหม่ทุกครั้ง
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('CDN-Cache-Control', 'no-store');
    res.set('ETag', SERVER_VERSION + '-' + Date.now());
  }
  next();
});
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
// true = Sign-in ด้วย Google แล้วใช้งานได้ทันที ไม่ต้องรอ Admin อนุมัติ (รวมถึงคนที่ค้าง pending เดิม)
const AUTO_APPROVE_USERS = process.env.AUTO_APPROVE_USERS === 'true';

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
  'google_id', 'picture', 'visible_tabs', 'editable_tabs', 'can_view']);

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
async function issueJwtForEmployee(res, employeeId) {
  const freshRow = await pool.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  if (freshRow.rows.length === 0) {
    return res.status(500).json({ error: 'USER_NOT_FOUND' });
  }
  const freshEmp = rowToCamel(freshRow.rows[0]);
  const token = jwt.sign(
    { sub: freshEmp.id, email: freshEmp.email, name: freshEmp.name, isAdmin: freshEmp.isAdmin, visibleTabs: freshEmp.visibleTabs || '', editableTabs: freshEmp.editableTabs || '' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ status: 'approved', token: token, user: freshEmp });
}

async function requireAuth(req, res, next) {
  if (!GOOGLE_CLIENT_ID) return next(); // skip auth if not configured
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    // Double-check user is still approved in DB (ป้องกันกรณี JWT ยังไม่หมดอายุแต่ถูกระงับแล้ว)
    const { rows } = await pool.query('SELECT status FROM employees WHERE id = $1', [decoded.sub]);
    if (rows.length === 0 || rows[0].status !== 'approved') {
      return res.status(403).json({ error: 'NOT_APPROVED', message: 'บัญชีถูกระงับหรือยังไม่อนุมัติ' });
    }
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
      var newStatus = AUTO_APPROVE_USERS ? 'approved' : 'pending';
      var defaultVt = AUTO_APPROVE_USERS ? DEFAULT_VISIBLE_TABS : '';
      var defaultEt = AUTO_APPROVE_USERS ? DEFAULT_EDITABLE_TABS : '';
      var insertResult = await pool.query(
        'INSERT INTO employees (name, email, google_id, picture, status, is_admin, visible_tabs, editable_tabs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [name, email, googleId, picture, newStatus, false, defaultVt, defaultEt]
      );
      var newId = insertResult.rows[0].id;
      if (!AUTO_APPROVE_USERS) {
        var rowNew = await pool.query('SELECT * FROM employees WHERE id = $1', [newId]);
        emp = rowToCamel(rowNew.rows[0]);
        return res.json({
          status: 'pending',
          message: 'ลงทะเบียนสำเร็จ! กรุณารอ Admin อนุมัติ',
          user: { name: emp.name, email: emp.email, picture: emp.picture, status: 'pending' }
        });
      }
      return issueJwtForEmployee(res, newId);
    }

    // User exists — update google_id and picture if needed
    emp = result.rows[0];
    var isFirstGoogleLogin = !emp.google_id;
    if (isFirstGoogleLogin || !emp.picture) {
      await pool.query(
        'UPDATE employees SET google_id = COALESCE(google_id, $1), picture = COALESCE(picture, $2) WHERE id = $3',
        [googleId, picture, emp.id]
      );
    }

    // ถ้า login ผ่าน Google ครั้งแรก (ยังไม่มี google_id) และไม่ใช่ admin → ต้องรออนุมัติ
    if (isFirstGoogleLogin && !emp.is_admin && !AUTO_APPROVE_USERS) {
      console.log('[AUTH] Setting first-login user to pending:', emp.id, emp.email);
      await pool.query('UPDATE employees SET status = $1 WHERE id = $2', ['pending', emp.id]);
      emp.status = 'pending';
    }

    emp = rowToCamel(emp);

    // Check approval status — ต้องเป็น 'approved' เท่านั้นถึงจะเข้าได้
    if (emp.status === 'rejected') {
      return res.status(403).json({
        error: 'REJECTED',
        message: 'บัญชีของคุณถูกปฏิเสธ กรุณาติดต่อ Admin'
      });
    }
    if (emp.status !== 'approved') {
      // status เป็น pending, null, undefined, หรืออื่นๆ → ต้องรออนุมัติ
      if (AUTO_APPROVE_USERS) {
        console.log('[AUTH] AUTO_APPROVE re-approving user:', emp.id, emp.email);
        await pool.query('UPDATE employees SET status = $1 WHERE id = $2', ['approved', emp.id]);
        return issueJwtForEmployee(res, emp.id);
      }
      // ถ้า status เป็น null ให้อัพเดตเป็น pending
      if (!emp.status) {
        await pool.query('UPDATE employees SET status = $1 WHERE id = $2', ['pending', emp.id]);
      }
      return res.json({
        status: 'pending',
        message: 'บัญชีของคุณกำลังรอ Admin อนุมัติ',
        user: { name: emp.name, email: emp.email, picture: emp.picture, status: 'pending' }
      });
    }

    // Approved — issue JWT
    return issueJwtForEmployee(res, emp.id);
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
      'SELECT id, name, email, picture, status, is_admin, google_id, visible_tabs, editable_tabs FROM employees ORDER BY id'
    );
    res.json(result.rows.map(rowToCamel));
  } catch (err) {
    console.error('GET /api/admin/all-users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ค่าเริ่มต้น: user ใหม่ที่ approved จะเห็นและแก้ไขได้แค่ Current Task เท่านั้น (admin ค่อยเปิดเพิ่มเอง)
var DEFAULT_VISIBLE_TABS = 'apm';
var DEFAULT_EDITABLE_TABS = 'apm';

// POST /api/admin/approve-user — Admin: approve or reject a user
app.post('/api/admin/approve-user', requireAuth, async function(req, res) {
  try {
    var userId = req.body.userId;
    var action = req.body.action; // 'approve' or 'reject'
    if (!userId || !action) {
      return res.status(400).json({ error: 'userId and action required' });
    }
    var newStatus = action === 'approve' ? 'approved' : 'rejected';
    console.log('[ADMIN] approve-user:', userId, 'action:', action, 'newStatus:', newStatus);
    // ปลด trigger ชั่วคราวเพื่อให้ admin approve ได้
    var client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL myapp.admin_approve = 'true'");
      if (action === 'approve') {
        var current = await client.query('SELECT visible_tabs, editable_tabs FROM employees WHERE id = $1', [userId]);
        if (current.rows.length > 0) {
          var vt = current.rows[0].visible_tabs;
          var et = current.rows[0].editable_tabs;
          var setVt = (!vt || vt === '') ? DEFAULT_VISIBLE_TABS : vt;
          var setEt = (!et || et === '') ? DEFAULT_EDITABLE_TABS : et;
          await client.query('UPDATE employees SET status = $1, visible_tabs = $2, editable_tabs = $3 WHERE id = $4', [newStatus, setVt, setEt, userId]);
        } else {
          await client.query('UPDATE employees SET status = $1 WHERE id = $2', [newStatus, userId]);
        }
      } else {
        await client.query('UPDATE employees SET status = $1 WHERE id = $2', [newStatus, userId]);
      }
      await client.query('COMMIT');
    } catch(e2) {
      await client.query('ROLLBACK');
      throw e2;
    } finally {
      client.release();
    }
    res.json({ success: true, userId: userId, status: newStatus });
  } catch (err) {
    console.error('POST /api/admin/approve-user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/delete-user — Admin: ลบพนักงานที่ถูกปฏิเสธ (rejected only)
app.post('/api/admin/delete-user', requireAuth, async function(req, res) {
  try {
    var userId = req.body.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    // เช็คว่า user ต้องเป็น rejected เท่านั้น
    var { rows } = await pool.query('SELECT status, email, name FROM employees WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
    if (rows[0].status !== 'rejected') {
      return res.status(400).json({ error: 'ลบได้เฉพาะพนักงานที่ถูกปฏิเสธแล้วเท่านั้น' });
    }

    console.log('[ADMIN] delete-user:', userId, rows[0].email, rows[0].name);

    var client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL myapp.admin_approve = 'true'");
      await client.query('DELETE FROM employees WHERE id = $1', [userId]);
      await client.query('COMMIT');
    } catch(e2) {
      await client.query('ROLLBACK');
      throw e2;
    } finally {
      client.release();
    }

    res.json({ success: true, deleted: userId });
  } catch (err) {
    console.error('POST /api/admin/delete-user error:', err);
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

// POST /api/admin/set-editable-tabs — Admin: set which tabs a user can edit
app.post('/api/admin/set-editable-tabs', requireAuth, async function(req, res) {
  try {
    var userId = req.body.userId;
    var editableTabs = req.body.editableTabs || ''; // comma-separated tab keys, empty = all
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    await pool.query('UPDATE employees SET editable_tabs = $1 WHERE id = $2', [editableTabs, userId]);
    res.json({ success: true, userId: userId, editableTabs: editableTabs });
  } catch (err) {
    console.error('POST /api/admin/set-editable-tabs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — verify JWT, return user info (ต้องเป็น approved เท่านั้น)
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'NO_TOKEN' });
  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1', [decoded.sub]);
    if (rows.length === 0) return res.status(401).json({ error: 'USER_NOT_FOUND' });
    var emp = rowToCamel(rows[0]);
    // ต้องเป็น approved เท่านั้น — ถ้าไม่ใช่ให้บล็อค
    if (emp.status !== 'approved') {
      return res.status(403).json({ error: 'NOT_APPROVED', message: 'บัญชียังไม่อนุมัติหรือถูกระงับ', user: { name: emp.name, email: emp.email, status: emp.status || 'pending' } });
    }
    res.json({ user: emp });
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
    const [brands, employees, tt, sp, lz, apmTasks, auditLog, forecast, configRows] = await Promise.all([
      pool.query('SELECT code, name, target_nm FROM brands ORDER BY sort_order, name'),
      pool.query('SELECT id, name, email, brands, note, is_admin, status, picture, visible_tabs, editable_tabs, can_view FROM employees WHERE status = $1 ORDER BY id', ['approved']),
      pool.query('SELECT * FROM daily_tiktok ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM daily_shopee ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM daily_lazada ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM apm_tasks ORDER BY id DESC'),
      pool.query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 2000'),
      pool.query('SELECT brand, platform, month_index, value FROM forecast ORDER BY brand, platform, month_index'),
      pool.query("SELECT key, value FROM config WHERE key IN ('line_token','line_group','line_send_time','line_sum_send_time','line_brand_send_time','line_reminder_send_time','reminder_template','forecast_platforms','brand_plat_map','line_templates','line_custom_msgs','line_send_summary','line_send_brand')"),
    ]);

    // Build brandTargets & brandNames from brands table
    var brandTargets = {};
    var brandNames = {};
    brands.rows.forEach(function(r){
      brandTargets[r.code] = { nm: r.target_nm != null ? parseFloat(r.target_nm) : 8.5 };
      brandNames[r.code] = r.name || r.code;
    });

    // Build forecastGMV from forecast table (dynamic platforms)
    var forecastGMV = {};
    forecast.rows.forEach(function(r){
      if(!forecastGMV[r.brand]) forecastGMV[r.brand] = {};
      if(!forecastGMV[r.brand][r.platform]) forecastGMV[r.brand][r.platform] = Array(12).fill(0);
      forecastGMV[r.brand][r.platform][r.month_index] = parseFloat(r.value)||0;
    });

    // Build LINE config from config table
    var configMap = {};
    configRows.rows.forEach(function(r){ configMap[r.key] = r.value; });

    // Parse forecast platforms (default to TT/SP/LZ)
    var forecastPlatforms = null;
    try { forecastPlatforms = JSON.parse(configMap['forecast_platforms'] || 'null'); } catch(e){}
    if(!Array.isArray(forecastPlatforms) || forecastPlatforms.length === 0) {
      forecastPlatforms = [{k:'tt',label:'TikTok',color:'#ff6b6b'},{k:'sp',label:'Shopee',color:'#ffa94d'},{k:'lz',label:'Lazada',color:'#a78bfa'}];
    }

    // Parse brand-platform mapping
    var brandPlatMap = null;
    try { brandPlatMap = JSON.parse(configMap['brand_plat_map'] || 'null'); } catch(e){}
    if(!brandPlatMap || typeof brandPlatMap !== 'object') brandPlatMap = {};

    res.json({
      brands:       brands.rows.map(r => r.code),
      brandTargets: brandTargets,
      brandNames:   brandNames,
      employees:    employees.rows.map(function(r){ var e = rowToCamel(r); e.canView = e.canView ? e.canView.split(',').filter(Boolean) : []; return e; }),
      tt:           tt.rows.map(rowToCamel),
      sp:           sp.rows.map(rowToCamel),
      lz:           lz.rows.map(rowToCamel),
      apmTasks:     apmTasks.rows.map(rowToCamel),
      auditLog:     auditLog.rows.map(rowToCamel),
      forecastGMV:  forecastGMV,
      forecastPlatforms: forecastPlatforms,
      brandPlatMap: brandPlatMap,
      lineToken:    configMap['line_token'] || '',
      lineGroup:    configMap['line_group'] || '',
      lineSendTime: configMap['line_send_time'] || '09:00',
      lineSumSendTime: configMap['line_sum_send_time'] || '',
      lineBrandSendTime: configMap['line_brand_send_time'] || '',
      lineReminderSendTime: configMap['line_reminder_send_time'] || '17:00',
      reminderTitle: (function(){ try { return JSON.parse(configMap['reminder_template']||'{}').title; } catch(e){} return undefined; })(),
      reminderItem1Title: (function(){ try { return JSON.parse(configMap['reminder_template']||'{}').item1Title; } catch(e){} return undefined; })(),
      reminderItem1Desc: (function(){ try { return JSON.parse(configMap['reminder_template']||'{}').item1Desc; } catch(e){} return undefined; })(),
      reminderItem2Title: (function(){ try { return JSON.parse(configMap['reminder_template']||'{}').item2Title; } catch(e){} return undefined; })(),
      reminderItem2Desc: (function(){ try { return JSON.parse(configMap['reminder_template']||'{}').item2Desc; } catch(e){} return undefined; })(),
      reminderThankMsg: (function(){ try { return JSON.parse(configMap['reminder_template']||'{}').thankMsg; } catch(e){} return undefined; })(),
      lineTemplates: configMap['line_templates'] || null,
      lineCustomMsgs: configMap['line_custom_msgs'] || null,
      lineSendSummary: configMap['line_send_summary'] || 'YES',
      lineSendBrand: configMap['line_send_brand'] || 'YES',
    });
  } catch (err) {
    console.error('GET /api/data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/data/beacon — Save via sendBeacon (beforeunload)
// sendBeacon ส่ง token ผ่าน query param เพราะตั้ง header ไม่ได้
// ============================================================
app.post('/api/data/beacon', async (req, res) => {
  try {
    var token = req.query.token;
    if (!token) return res.status(401).json({ error: 'NO_TOKEN' });
    var decoded = jwt.verify(token, JWT_SECRET);
    // Reuse the same save logic — forward to PUT handler
    req.user = decoded;
    req.body = req.body || {};
    var db = req.body;

    // === 1) Config values — LINE config is NOW saved via POST /api/config/save (saveConfig) ===
    // Do NOT save LINE config keys here — beacon sends stale DB values that overwrite real saved values
    try {
      if (db.lineTemplates) await pool.query("INSERT INTO config (key, value) VALUES ('line_templates', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [typeof db.lineTemplates === 'string' ? db.lineTemplates : JSON.stringify(db.lineTemplates)]);
      if (db.lineCustomMsgs) await pool.query("INSERT INTO config (key, value) VALUES ('line_custom_msgs', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [typeof db.lineCustomMsgs === 'string' ? db.lineCustomMsgs : JSON.stringify(db.lineCustomMsgs)]);
      console.log('[BEACON] config saved OK (skipped LINE config keys)');
    } catch(eCfg) {
      console.error('[BEACON] config save error:', eCfg.message);
    }

    // === 2) Platform data + brands + employees — in transaction (can fail independently) ===
    var client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Platform data first (FK)
      for (var plat of ['tt', 'sp', 'lz']) {
        var table = TABLE_MAP[plat];
        await client.query('DELETE FROM ' + table);
      }
      // Brands — ไม่ save ผ่าน beacon แล้ว (ใช้ PUT /api/brands แทน เพื่อป้องกัน stale overwrite)
      // Employees
      if (Array.isArray(db.employees)) {
        var existingEmps = await client.query('SELECT id, email FROM employees');
        var empMap = {};
        existingEmps.rows.forEach(function(r){ if(r.email) empMap[r.email.toLowerCase()] = r; });
        for (var emp of db.employees) {
          var empKey = (emp.email||'').toLowerCase();
          var exEmp = empMap[empKey];
          if(exEmp) {
            var canViewStr = Array.isArray(emp.canView) ? emp.canView.join(',') : (emp.canView||'');
            await client.query('UPDATE employees SET name=$1, brands=$2, note=$3, is_admin=$4, can_view=$5 WHERE id=$6', [emp.name||'', emp.brands||'', emp.note||'', emp.isAdmin||false, canViewStr, exEmp.id]);
          }
        }
      }
      // Platform data re-insert
      for (var plat of ['tt', 'sp', 'lz']) {
        if (!Array.isArray(db[plat])) continue;
        var table = TABLE_MAP[plat];
        var cols = PLAT_COLS[plat];
        var ph = makePH(cols.length);
        for (var row of db[plat]) {
          var snake = rowToSnake(row);
          var vals = cols.map(function(c){ return cleanVal(c, snake[c]); });
          await client.query('INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + ph + ')', vals);
        }
      }
      await client.query('COMMIT');
    } catch(e2) {
      await client.query('ROLLBACK');
      console.error('[BEACON] data save error:', e2.message);
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('beacon auth error:', e.message);
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
});

// DEBUG: ดูค่า config ใน DB
app.get('/api/debug/config', async (req, res) => {
  try {
    var { rows } = await pool.query("SELECT key, value FROM config ORDER BY key");
    var obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    res.json(obj);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// POST /api/config/save — Save config values ONLY (lightweight, no platform data)
// ============================================================
app.post('/api/config/save', requireAuth, async (req, res) => {
  console.log('[CONFIG-SAVE] body:', JSON.stringify(req.body));
  try {
    var data = req.body;
    var configKeys = {
      lineToken:'line_token', lineGroup:'line_group', lineSendTime:'line_send_time',
      lineSumSendTime:'line_sum_send_time', lineBrandSendTime:'line_brand_send_time',
      lineReminderSendTime:'line_reminder_send_time', lineSendSummary:'line_send_summary',
      lineSendBrand:'line_send_brand'
    };
    var saved = [];
    for (var jsKey of Object.keys(configKeys)) {
      if (data[jsKey] !== undefined) {
        await pool.query("INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [configKeys[jsKey], data[jsKey]]);
        saved.push(jsKey);
      }
    }
    // Reminder template fields
    var reminderTpl = {};
    if (data.reminderTitle !== undefined) reminderTpl.title = data.reminderTitle;
    if (data.reminderItem1Title !== undefined) reminderTpl.item1Title = data.reminderItem1Title;
    if (data.reminderItem1Desc !== undefined) reminderTpl.item1Desc = data.reminderItem1Desc;
    if (data.reminderItem2Title !== undefined) reminderTpl.item2Title = data.reminderItem2Title;
    if (data.reminderItem2Desc !== undefined) reminderTpl.item2Desc = data.reminderItem2Desc;
    if (data.reminderThankMsg !== undefined) reminderTpl.thankMsg = data.reminderThankMsg;
    if (Object.keys(reminderTpl).length > 0) {
      // Merge with existing template
      var existing = {};
      try {
        var { rows } = await pool.query("SELECT value FROM config WHERE key = 'reminder_template'");
        if (rows.length > 0) existing = JSON.parse(rows[0].value || '{}');
      } catch(e){}
      Object.assign(existing, reminderTpl);
      await pool.query("INSERT INTO config (key, value) VALUES ('reminder_template', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(existing)]);
      saved.push('reminderTemplate');
    }
    // LINE templates & custom messages
    if (data.lineTemplates !== undefined) {
      await pool.query("INSERT INTO config (key, value) VALUES ('line_templates', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [typeof data.lineTemplates === 'string' ? data.lineTemplates : JSON.stringify(data.lineTemplates)]);
      saved.push('lineTemplates');
    }
    if (data.lineCustomMsgs !== undefined) {
      await pool.query("INSERT INTO config (key, value) VALUES ('line_custom_msgs', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [typeof data.lineCustomMsgs === 'string' ? data.lineCustomMsgs : JSON.stringify(data.lineCustomMsgs)]);
      saved.push('lineCustomMsgs');
    }
    console.log('[CONFIG] saved:', saved.join(', '));
    res.json({ success: true, saved: saved });
  } catch(e) {
    console.error('[CONFIG] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PUT /api/data — Save entire DB (mimics the old saveDB)
// ============================================================
app.put('/api/data', requireAuth, async (req, res) => {
  const db = req.body;

  // === 1) Config values — LINE config keys are NOW saved via POST /api/config/save (saveConfig) ===
  // Do NOT save LINE config keys here — PUT sends stale DB values that overwrite real saved values
  try {
    if (db.lineTemplates !== undefined && db.lineTemplates !== null) await pool.query("INSERT INTO config (key, value) VALUES ('line_templates', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [typeof db.lineTemplates === 'string' ? db.lineTemplates : JSON.stringify(db.lineTemplates)]);
    if (db.lineCustomMsgs !== undefined && db.lineCustomMsgs !== null) await pool.query("INSERT INTO config (key, value) VALUES ('line_custom_msgs', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [typeof db.lineCustomMsgs === 'string' ? db.lineCustomMsgs : JSON.stringify(db.lineCustomMsgs)]);
    if (Array.isArray(db.forecastPlatforms)) await pool.query("INSERT INTO config (key, value) VALUES ('forecast_platforms', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(db.forecastPlatforms)]);
    if (db.brandPlatMap && typeof db.brandPlatMap === 'object') await pool.query("INSERT INTO config (key, value) VALUES ('brand_plat_map', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(db.brandPlatMap)]);
    var reminderTpl = {};
    if (db.reminderTitle !== undefined) reminderTpl.title = db.reminderTitle;
    if (db.reminderItem1Title !== undefined) reminderTpl.item1Title = db.reminderItem1Title;
    if (db.reminderItem1Desc !== undefined) reminderTpl.item1Desc = db.reminderItem1Desc;
    if (db.reminderItem2Title !== undefined) reminderTpl.item2Title = db.reminderItem2Title;
    if (db.reminderItem2Desc !== undefined) reminderTpl.item2Desc = db.reminderItem2Desc;
    if (db.reminderThankMsg !== undefined) reminderTpl.thankMsg = db.reminderThankMsg;
    if (Object.keys(reminderTpl).length > 0) await pool.query("INSERT INTO config (key, value) VALUES ('reminder_template', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(reminderTpl)]);
  } catch(eCfg) {
    console.error('[SAVE] config save error:', eCfg.message);
  }

  // === 2) Platform data + brands + employees — in transaction ===
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Platform data FIRST (FK: daily_*.brand → brands.code) ---
    for (const plat of ['tt', 'sp', 'lz']) {
      const table = TABLE_MAP[plat];
      await client.query('DELETE FROM ' + table);
    }

    // --- Brands (safe to delete now that daily tables are empty) ---
    if (Array.isArray(db.brands)) {
      await client.query('DELETE FROM brands');
      for (var bi = 0; bi < db.brands.length; bi++) {
        var bCode = db.brands[bi];
        var bName = (db.brandNames && db.brandNames[bCode]) || bCode;
        var bTarget = (db.brandTargets && db.brandTargets[bCode] && db.brandTargets[bCode].nm != null) ? db.brandTargets[bCode].nm : 8.5;
        await client.query('INSERT INTO brands (code, name, target_nm, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [bCode, bName, bTarget, bi]);
      }
    }

    // --- Forecast GMV (dynamic platforms) ---
    if (db.forecastGMV && typeof db.forecastGMV === 'object') {
      await client.query('DELETE FROM forecast');
      var fcBrands = Object.keys(db.forecastGMV);
      for (var fi = 0; fi < fcBrands.length; fi++) {
        var fcBrand = fcBrands[fi];
        var platKeys = Object.keys(db.forecastGMV[fcBrand]);
        for (var pi = 0; pi < platKeys.length; pi++) {
          var fcPlat = platKeys[pi];
          var vals = db.forecastGMV[fcBrand][fcPlat];
          if (!Array.isArray(vals)) continue;
          for (var mi = 0; mi < vals.length; mi++) {
            if (vals[mi]) {
              await client.query('INSERT INTO forecast (brand, platform, month_index, value) VALUES ($1,$2,$3,$4)', [fcBrand, fcPlat, mi, vals[mi]]);
            }
          }
        }
      }
    }

    // --- Employees: อัพเดตเฉพาะ name, brands, note, is_admin ของคนที่มีอยู่แล้ว ---
    // ไม่ INSERT/DELETE พนักงาน — ใช้ปุ่ม "บันทึกพนักงาน" หรือ Google login แทน
    console.log('[SAVE] PUT /api/data employees section — UPDATE only, NO INSERT/DELETE (v2)');
    if (Array.isArray(db.employees)) {
      var existingEmps = await client.query('SELECT id, email FROM employees');
      var empMap = {};
      existingEmps.rows.forEach(function(r){ if(r.email) empMap[r.email.toLowerCase()] = r; });
      for (var emp of db.employees) {
        var empKey = (emp.email||'').toLowerCase();
        var exEmp = empMap[empKey];
        if(exEmp){
          var canViewStr = Array.isArray(emp.canView) ? emp.canView.join(',') : (emp.canView||'');
          await client.query(
            'UPDATE employees SET name=$1, brands=$2, note=$3, is_admin=$4, can_view=$5 WHERE id=$6',
            [emp.name||'', emp.brands||'', emp.note||'', emp.isAdmin||false, canViewStr, exEmp.id]
          );
        }
        // ไม่ INSERT ใหม่ และไม่ DELETE — จัดการผ่านหน้า admin เท่านั้น
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
      await client.query("SELECT setval(pg_get_serial_sequence('apm_tasks','id'), 1, false)").catch(function(){
        return client.query("CREATE SEQUENCE IF NOT EXISTS apm_tasks_id_seq; ALTER TABLE apm_tasks ALTER COLUMN id SET DEFAULT nextval('apm_tasks_id_seq'); SELECT setval('apm_tasks_id_seq', 1, false);");
      });
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
    const { rows } = await pool.query('SELECT code, name, target_nm FROM brands ORDER BY sort_order, name');
    res.json(rows.map(r => ({ code: r.code, name: r.name, targetNm: r.target_nm })));
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
    var brandList = req.body.brands || [];
    var targets = req.body.brandTargets || {};
    var names = req.body.brandNames || {};
    for (var i = 0; i < brandList.length; i++) {
      var code = brandList[i];
      var nm = (targets[code] && targets[code].nm != null) ? targets[code].nm : 8.5;
      var bname = names[code] || code;
      await client.query('INSERT INTO brands (code, name, target_nm, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [code, bname, nm, i]);
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
    const { rows } = await pool.query('SELECT id, name, email, brands, note, is_admin, status, picture, visible_tabs, editable_tabs, can_view FROM employees WHERE status = $1 ORDER BY id', ['approved']);
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
    var existing = await client.query('SELECT id, email, google_id, status, picture, visible_tabs, editable_tabs FROM employees');
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
        var cvStr = Array.isArray(e.canView) ? e.canView.join(',') : (e.canView||'');
        await client.query(
          'UPDATE employees SET name=$1, brands=$2, note=$3, is_admin=$4, can_view=$5 WHERE id=$6',
          [e.name||'', e.brands||'', e.note||'', e.isAdmin||false, cvStr, ex.id]
        );
      } else {
        // Insert new — status=pending (ต้องอนุมัติแยกต่างหาก)
        var cvStr2 = Array.isArray(e.canView) ? e.canView.join(',') : (e.canView||'');
        await client.query(
          'INSERT INTO employees (name, email, brands, note, is_admin, status, can_view) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false, 'pending', cvStr2]
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
// Forecast CRUD
// ============================================================
app.get('/api/forecast', requireAuth, async (req, res) => {
  try {
    var { rows } = await pool.query('SELECT brand, platform, month_index, value FROM forecast ORDER BY brand, platform, month_index');
    var forecastGMV = {};
    rows.forEach(function(r){
      if(!forecastGMV[r.brand]) forecastGMV[r.brand] = {};
      if(!forecastGMV[r.brand][r.platform]) forecastGMV[r.brand][r.platform] = Array(12).fill(0);
      forecastGMV[r.brand][r.platform][r.month_index] = parseFloat(r.value)||0;
    });
    res.json(forecastGMV);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/forecast', requireAuth, async (req, res) => {
  var client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM forecast');
    var data = req.body.forecastGMV || req.body;
    var fcBrands = Object.keys(data);
    for (var fi = 0; fi < fcBrands.length; fi++) {
      var brand = fcBrands[fi];
      var plats = Object.keys(data[brand]);
      for (var pi = 0; pi < plats.length; pi++) {
        var plat = plats[pi];
        var vals = data[brand][plat];
        if (!Array.isArray(vals)) continue;
        for (var mi = 0; mi < vals.length; mi++) {
          if (vals[mi]) {
            await client.query('INSERT INTO forecast (brand, platform, month_index, value) VALUES ($1,$2,$3,$4)', [brand, plat, mi, vals[mi]]);
          }
        }
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
    // Ensure SERIAL sequence exists and reset it
    await client.query("SELECT setval(pg_get_serial_sequence('apm_tasks','id'), 1, false)").catch(function(){
      // If no sequence, create one
      return client.query("CREATE SEQUENCE IF NOT EXISTS apm_tasks_id_seq; ALTER TABLE apm_tasks ALTER COLUMN id SET DEFAULT nextval('apm_tasks_id_seq'); SELECT setval('apm_tasks_id_seq', 1, false);");
    });
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
// LINE Schedule — ให้ภายนอก (Apps Script / cron) ดึงตารางส่ง
// ============================================================
app.get('/api/line/schedule', async (req, res) => {
  try {
    // ดึง config ที่เกี่ยวข้อง
    var { rows: cfgRows } = await pool.query(
      "SELECT key, value FROM config WHERE key IN ('line_token','line_group','line_sum_send_time','line_brand_send_time','line_custom_msgs','line_templates','forecast_platforms','brand_plat_map')"
    );
    var cfg = {};
    cfgRows.forEach(function(r){ cfg[r.key] = r.value; });

    // ดึงข้อมูลทั้งหมด
    var [brandsRes, tt, sp, lz, fcRes] = await Promise.all([
      pool.query('SELECT code, name, target_nm FROM brands ORDER BY sort_order, name'),
      pool.query('SELECT * FROM daily_tiktok ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM daily_shopee ORDER BY date DESC, brand'),
      pool.query('SELECT * FROM daily_lazada ORDER BY date DESC, brand'),
      pool.query('SELECT brand, platform, month_index, value FROM forecast'),
    ]);

    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = String(today.getMonth()+1).padStart(2,'0');
    var dd = String(today.getDate()).padStart(2,'0');
    var todayStr = yyyy + '-' + mm + '-' + dd;
    var monthPrefix = yyyy + '-' + mm;
    var mi = today.getMonth(); // 0-indexed
    var daysInMonth = new Date(yyyy, mi+1, 0).getDate();
    var daysRemain = daysInMonth - today.getDate();
    var thMonths = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    var dateLabel = today.getDate() + ' ' + thMonths[mi+1] + ' ' + (yyyy + 543);
    var monthName = thMonths[mi+1];

    // FC platforms
    var fcPlat = [{k:'tt',label:'TikTok'},{k:'sp',label:'Shopee'},{k:'lz',label:'Lazada'}];
    try { var fp = JSON.parse(cfg['forecast_platforms']||'null'); if(Array.isArray(fp)&&fp.length) fcPlat=fp; } catch(e){}
    var brandPlatMap = {};
    try { var bpm = JSON.parse(cfg['brand_plat_map']||'null'); if(bpm&&typeof bpm==='object') brandPlatMap=bpm; } catch(e){}

    // Build forecast lookup
    var forecastGMV = {};
    fcRes.rows.forEach(function(r){
      if(!forecastGMV[r.brand]) forecastGMV[r.brand] = {};
      if(!forecastGMV[r.brand][r.platform]) forecastGMV[r.brand][r.platform] = [];
      forecastGMV[r.brand][r.platform][r.month_index] = parseFloat(r.value)||0;
    });

    // Tag rows with platform
    var allTagged = [];
    tt.rows.forEach(function(r){ allTagged.push(Object.assign({}, r, {_plat:'tt'})); });
    sp.rows.forEach(function(r){ allTagged.push(Object.assign({}, r, {_plat:'sp'})); });
    lz.rows.forEach(function(r){ allTagged.push(Object.assign({}, r, {_plat:'lz'})); });

    // Ads calculator (ads only — for ROAS)
    function calcAds(r){
      var n = function(k){ return parseFloat(r[k])||0; };
      if(r._plat==='tt') return n('cost_gmv_ads')+n('cost_gmv_live');
      if(r._plat==='sp') return n('sp_ads')+n('fb_cpas')+n('affiliate')+n('search_ads')+n('shop_ads')+n('product_ads');
      if(r._plat==='lz') return n('lzsd')+n('lz_gmv_max')+n('aff_lz');
      return 0;
    }

    // MK cost calculator (ไม่รวม cogs, plat_fee — for MK%)
    function calcTotalCost(r){
      var n = function(k){ return parseFloat(r[k])||0; };
      if(r._plat==='tt') return n('promo')+n('free')+n('kol')+n('prod_live')+n('comm_live')+n('comm_creator')+n('cost_gmv_ads')+n('cost_gmv_live');
      if(r._plat==='sp') return n('promo')+n('free')+n('comm_creator')+n('sp_ads')+n('fb_cpas')+n('affiliate')+n('search_ads')+n('shop_ads')+n('product_ads');
      if(r._plat==='lz') return n('promo')+n('free')+n('comm_creator')+n('lzsd')+n('lz_gmv_max')+n('aff_lz');
      return 0;
    }

    // Sum rows helper
    function sumRows(rows){
      var gmv=0,orders=0,ads=0,totalCost=0,nm=0;
      var byPlat={tt:{gmv:0,ads:0},sp:{gmv:0,ads:0},lz:{gmv:0,ads:0}};
      var byBrand={};
      rows.forEach(function(r){
        var g=parseFloat(r.gmv)||0, o=parseFloat(r.orders)||0, a=calcAds(r), tc=calcTotalCost(r), n=parseFloat(r.nm)||0;
        gmv+=g; orders+=o; ads+=a; totalCost+=tc; nm+=n;
        if(byPlat[r._plat]){ byPlat[r._plat].gmv+=g; byPlat[r._plat].ads+=a; }
        var b=r.brand;
        if(b){
          if(!byBrand[b]) byBrand[b]={gmv:0,orders:0,ads:0,totalCost:0,nm:0};
          byBrand[b].gmv+=g; byBrand[b].orders+=o; byBrand[b].ads+=a; byBrand[b].totalCost+=tc; byBrand[b].nm+=n;
        }
      });
      return {gmv:gmv,orders:orders,ads:ads,totalCost:totalCost,nm:nm,byPlat:byPlat,byBrand:byBrand};
    }

    var todayRows = allTagged.filter(function(r){ return String(r.date||'').substring(0,10)===todayStr; });
    var monthRows = allTagged.filter(function(r){ return String(r.date||'').substring(0,7)===monthPrefix; });

    var todayData = sumRows(todayRows);
    var monthData = sumRows(monthRows);

    // Days passed (unique dates with data)
    var uniqueDates = {};
    monthRows.forEach(function(r){ uniqueDates[String(r.date||'').substring(0,10)]=1; });
    var daysPassed = Object.keys(uniqueDates).length || 1;
    var monthAvg = monthData.gmv / daysPassed;

    // FC target
    var brandList = brandsRes.rows.map(function(b){ return b.code; });
    var fcTarget = 0;
    var brandFc = {};
    brandList.forEach(function(b){
      var bTarget = 0;
      var plats = (brandPlatMap[b] && brandPlatMap[b].length>0) ? fcPlat.filter(function(pp){ return brandPlatMap[b].indexOf(pp.k)>=0; }) : fcPlat;
      plats.forEach(function(pl){
        if(forecastGMV[b] && forecastGMV[b][pl.k] && forecastGMV[b][pl.k][mi]) bTarget += forecastGMV[b][pl.k][mi];
      });
      brandFc[b] = bTarget;
      fcTarget += bTarget;
    });
    var fcPct = fcTarget>0 ? (monthData.gmv/fcTarget*100) : 0;
    var fcGap = Math.max(0, fcTarget - monthData.gmv);
    var fcDailyNeed = daysRemain>0 ? fcGap/daysRemain : 0;
    var todayRoas = todayData.ads>0 ? todayData.gmv/todayData.ads : 0;
    var monthRoas = monthData.ads>0 ? monthData.gmv/monthData.ads : 0;

    // Progress bar
    var pctClamped = Math.min(100, fcPct);
    var filled = Math.round(pctClamped/10);
    var fcBar = '';
    for(var i=0;i<filled;i++) fcBar+='█';
    for(var j=filled;j<10;j++) fcBar+='░';

    // Motivation
    var motivation = '';
    if(fcPct >= 100) motivation = '🏆 ยอดเยี่ยม! ทะลุเป้าแล้ว! ไปต่อกันเลย! 💪🔥';
    else if(fcPct >= 80) motivation = '🔥 ใกล้มาก! เหลือแค่นิดเดียว สู้ๆ! 💪';
    else if(fcPct >= 60) motivation = '💪 กำลังไปได้ดี ยังพอไหว ลุยต่อ!';
    else if(fcPct >= 40) motivation = '⚡ ต้องเร่งมือหน่อยนะ ยังมีเวลา!';
    else motivation = '🚀 ต้องเพิ่มเต็มกำลัง เร่งเครื่องเลย!';

    // Platform daily rows
    var platColors = {tt:'🔴',sp:'🟠',lz:'🟣'};
    var platDailyRows = fcPlat.map(function(pl){
      var tg = (todayData.byPlat[pl.k]||{}).gmv||0;
      var mg = (monthData.byPlat[pl.k]||{}).gmv||0;
      var icon = platColors[pl.k]||'⚪';
      return icon+' '+pl.label+': ฿'+Math.round(tg).toLocaleString()+' (วันนี้) | ฿'+Math.round(mg).toLocaleString()+' (เดือน)';
    }).join('\n');

    var fmtN = function(v){ return Math.round(v).toLocaleString(); };
    var nmTarget = 8.5, roasTarget = 3, mkTarget = 40;
    var nmPct = monthData.gmv>0 ? (monthData.nm/monthData.gmv*100) : 0;

    // MK% calculations (using totalCost, not just ads)
    var todayMkPct = todayData.gmv>0 ? (todayData.totalCost/todayData.gmv*100) : 0;
    var monthMkPct = monthData.gmv>0 ? (monthData.totalCost/monthData.gmv*100) : 0;

    // MK warnings per brand
    var mkOverBrands = brandList.filter(function(b){
      var bm = monthData.byBrand[b];
      return bm && bm.gmv>0 && (bm.totalCost/bm.gmv*100)>mkTarget;
    });
    var mkWarnings = '';
    if(mkOverBrands.length>0){
      mkWarnings = '🚨 MK% เกินเป้า (>' + mkTarget + '%):\n' + mkOverBrands.map(function(b){
        var bm = monthData.byBrand[b];
        return '⚠️ ' + b + ' → MK ' + (bm.totalCost/bm.gmv*100).toFixed(1) + '%';
      }).join('\n');
    } else if(monthData.gmv>0){
      mkWarnings = '✅ ทุกแบรนด์ MK% อยู่ในเป้า!';
    }

    // All vars
    var vars = {
      '{date}': dateLabel, '{month_name}': monthName,
      '{days_passed}': String(daysPassed), '{days_remain}': String(daysRemain),
      '{today_gmv}': fmtN(todayData.gmv), '{today_orders}': fmtN(todayData.orders),
      '{today_ads}': fmtN(todayData.ads), '{today_roas}': todayRoas.toFixed(1),
      '{today_roas_status}': todayRoas>=roasTarget?'✅':'⚠️',
      '{today_mk_pct}': todayMkPct.toFixed(1),
      '{today_mk_status}': todayMkPct<=mkTarget?'✅':'🔴',
      '{month_gmv}': fmtN(monthData.gmv), '{month_orders}': fmtN(monthData.orders),
      '{month_ads}': fmtN(monthData.ads), '{month_avg}': fmtN(Math.round(monthAvg)),
      '{month_roas}': monthRoas.toFixed(1),
      '{month_mk_pct}': monthMkPct.toFixed(1),
      '{month_mk_status}': monthMkPct<=mkTarget?'✅':'🔴',
      '{mk_warnings}': mkWarnings, '{mk_target}': String(mkTarget),
      '{fc_target}': fmtN(fcTarget), '{fc_pct}': fcPct.toFixed(1),
      '{fc_gap}': fmtN(Math.round(fcGap)), '{fc_daily_need}': fmtN(Math.round(fcDailyNeed)),
      '{fc_bar}': fcBar, '{motivation}': motivation,
      '{plat_daily_rows}': platDailyRows,
      // Legacy compat
      '{gmv}': fmtN(monthData.gmv), '{orders}': fmtN(monthData.orders),
      '{ads}': fmtN(monthData.ads), '{roas}': monthRoas.toFixed(1),
      '{roas_status}': monthRoas>=roasTarget?'✅':'⚠️',
      '{tt_gmv}': fmtN((monthData.byPlat.tt||{}).gmv||0),
      '{sp_gmv}': fmtN((monthData.byPlat.sp||{}).gmv||0),
      '{lz_gmv}': fmtN((monthData.byPlat.lz||{}).gmv||0),
      '{nm_target}': String(nmTarget), '{roas_target}': String(roasTarget),
      '{nm_pct}': nmPct.toFixed(1), '{nm_status}': nmPct>=nmTarget?'✅':'⚠️',
    };

    function applyVars(text) {
      if (!text) return '';
      Object.keys(vars).forEach(function(k) { text = text.split(k).join(vars[k]); });
      return text;
    }

    // Parse templates
    var templates = {};
    try { templates = JSON.parse(cfg['line_templates'] || '{}'); } catch(e) {}

    // ── Build Flex Messages (server-side) ──
    var roasTarget = 3;
    function mkClr(p){ return p<=mkTarget?'#00C853':'#FF5252'; }
    function roasClr(v){ return v>=roasTarget?'#00C853':'#FFC107'; }
    function fcClr(p){ return p>=100?'#00C853':p>=70?'#4CAF50':p>=40?'#FFC107':'#FF5252'; }
    function hRow(label,val,color){ return {type:'box',layout:'horizontal',contents:[{type:'text',text:label,size:'sm',color:'#AAAAAA',flex:3},{type:'text',text:val,size:'sm',color:color||'#FFFFFF',weight:'bold',align:'end',flex:4}]}; }

    // Progress bar helper
    function makeBar(pct,color){
      var filled = Math.min(10,Math.round(Math.min(100,pct)/10));
      var boxes = [];
      for(var bi=0;bi<10;bi++) boxes.push({type:'box',layout:'vertical',contents:[{type:'filler'}],width:'8%',height:'8px',backgroundColor:bi<filled?(color||'#00C853'):'#444444',cornerRadius:'2px'});
      return {type:'box',layout:'horizontal',spacing:'xs',margin:'sm',contents:boxes};
    }

    // Platform rows for flex
    var pColors = {tt:'#FF5252',sp:'#FF9800',lz:'#B388FF'};
    var platFlexRows = fcPlat.map(function(pl){
      var tg = ((todayData.byPlat[pl.k])||{}).gmv||0;
      var mg = ((monthData.byPlat[pl.k])||{}).gmv||0;
      return {type:'box',layout:'horizontal',contents:[
        {type:'text',text:pl.label,size:'sm',color:pColors[pl.k]||'#AAAAAA',flex:2},
        {type:'text',text:'฿'+fmtN(tg),size:'sm',color:'#FFFFFF',align:'end',flex:3},
        {type:'text',text:'฿'+fmtN(mg),size:'sm',color:'#AAAAAA',align:'end',flex:3}
      ],margin:'sm'};
    });

    var sumFlex = {
      type:'bubble',size:'mega',
      styles:{header:{backgroundColor:'#1A237E'},body:{backgroundColor:'#1B1B1B'}},
      header:{type:'box',layout:'vertical',contents:[
        {type:'text',text:'📊 JLC ALL ONLINE Daily Report',size:'lg',weight:'bold',color:'#FFFFFF'},
        {type:'text',text:dateLabel,size:'sm',color:'#B0BEC5',margin:'xs'}
      ],paddingAll:'16px'},
      body:{type:'box',layout:'vertical',spacing:'md',paddingAll:'16px',contents:[
        {type:'text',text:'📅 ยอดวันนี้',weight:'bold',color:'#00C853',size:'sm'},
        {type:'box',layout:'vertical',spacing:'xs',margin:'sm',contents:[
          hRow('GMV','฿'+fmtN(todayData.gmv)),
          hRow('Ads','฿'+fmtN(todayData.ads)), hRow('MK%',todayMkPct.toFixed(1)+'%',mkClr(todayMkPct)),
          hRow('ROAS',todayRoas.toFixed(1)+'x',roasClr(todayRoas))
        ]},
        {type:'separator',color:'#444444'},
        {type:'text',text:'📆 สะสมเดือน '+monthName+' ('+daysPassed+' วัน)',weight:'bold',color:'#42A5F5',size:'sm'},
        {type:'box',layout:'vertical',spacing:'xs',margin:'sm',contents:[
          hRow('GMV สะสม','฿'+fmtN(monthData.gmv)), hRow('เฉลี่ย/วัน','฿'+fmtN(Math.round(monthAvg)),'#42A5F5'),
          hRow('Ads สะสม','฿'+fmtN(monthData.ads)),
          hRow('MK%',monthMkPct.toFixed(1)+'%',mkClr(monthMkPct))
        ]},
        {type:'separator',color:'#444444'},
        {type:'text',text:'🎯 เป้า FC: ฿'+fmtN(fcTarget),weight:'bold',color:'#FFC107',size:'sm'},
        makeBar(fcPct),
        {type:'box',layout:'horizontal',margin:'xs',contents:[
          {type:'text',text:'ทำได้ '+fcPct.toFixed(1)+'%',size:'xs',color:fcClr(fcPct)},
          {type:'text',text:'ขาด ฿'+fmtN(Math.round(fcGap)),size:'xs',color:'#FF5252',align:'end'}
        ]},
        {type:'text',text:'⏳ ต้องทำ/วัน ฿'+fmtN(Math.round(fcDailyNeed))+' (เหลือ '+daysRemain+' วัน)',size:'xs',color:'#AAAAAA',margin:'xs'},
        {type:'separator',color:'#444444'},
        {type:'box',layout:'horizontal',contents:[
          {type:'text',text:'ช่องทาง',size:'xs',color:'#AAAAAA',flex:2},
          {type:'text',text:'วันนี้',size:'xs',color:'#AAAAAA',align:'end',flex:3},
          {type:'text',text:'เดือน',size:'xs',color:'#AAAAAA',align:'end',flex:3}
        ]}
      ].concat(platFlexRows).concat([
        {type:'separator',color:'#444444'},
        {type:'text',text:motivation,size:'sm',color:'#00C853',wrap:true,align:'center',margin:'sm'}
      ])}
    };

    // Brand Flex — Carousel (1 bubble per brand)
    var lineBrandOrder = ["JH-ECOM","JARVIT","J-DENT"];
    var brandHeaderColors = {"jh-ecom":'#1B5E20','jarvit':'#E91E63','j-dent':'#388E3C'};
    var defaultHeaderColors = ['#4A148C','#1A237E','#004D40','#BF360C','#1B5E20','#F57F17'];
    // Sort brands by preferred order
    var sortedBrandList = lineBrandOrder.filter(function(ob){ return brandList.find(function(bl){ return bl.toLowerCase()===ob.toLowerCase(); }); });
    brandList.forEach(function(bl){ if(!sortedBrandList.find(function(s){ return s.toLowerCase()===bl.toLowerCase(); })) sortedBrandList.push(bl); });
    var brandBubbles = [];
    var hColorIdx = 0;
    sortedBrandList.forEach(function(b){
      var bM = monthData.byBrand[b] || {gmv:0,orders:0,ads:0,totalCost:0,nm:0};
      var bT = todayData.byBrand[b] || {gmv:0,orders:0,ads:0,totalCost:0,nm:0};
      var bGmv=(bM||{}).gmv||0, bTG=(bT||{}).gmv||0, bAds=(bM||{}).ads||0;
      var bTotalCost=(bM||{}).totalCost||0;
      var bRoas=bAds>0?bGmv/bAds:0, bFT=brandFc[b]||0;
      var bFP=bFT>0?(bGmv/bFT*100):0, bFG=Math.max(0,bFT-bGmv), bMk=bGmv>0?(bTotalCost/bGmv*100):0;
      var icon=bFP>=100?'🏆':bFP>=70?'🟢':bFP>=40?'🟡':'🔴';
      var bDailyNeed = daysRemain>0 ? bFG/daysRemain : 0;
      var hClr = brandHeaderColors[b.toLowerCase()] || defaultHeaderColors[hColorIdx % defaultHeaderColors.length];
      hColorIdx++;

      brandBubbles.push({
        type:'bubble',size:'kilo',
        styles:{header:{backgroundColor:hClr},body:{backgroundColor:'#1B1B1B'}},
        header:{type:'box',layout:'vertical',contents:[
          {type:'text',text:icon+' '+b,size:'lg',weight:'bold',color:'#FFFFFF'},
          {type:'text',text:dateLabel,size:'xs',color:'#B0BEC5',margin:'xs'}
        ],paddingAll:'14px'},
        body:{type:'box',layout:'vertical',spacing:'sm',paddingAll:'14px',contents:[
          {type:'text',text:'📅 วันนี้',weight:'bold',color:'#00C853',size:'xs'},
          hRow('GMV','฿'+fmtN(bTG)),
          {type:'separator',color:'#444444'},
          {type:'text',text:'📆 เดือน '+monthName,weight:'bold',color:'#42A5F5',size:'xs'},
          hRow('GMV สะสม','฿'+fmtN(bGmv)),
          hRow('Ads','฿'+fmtN(bAds)), hRow('MK%',bMk.toFixed(1)+'%',mkClr(bMk)),
          hRow('ROAS',bRoas.toFixed(1)+'x',bRoas>=roasTarget?'#00C853':'#FFC107'),
          {type:'separator',color:'#444444'},
          {type:'text',text:'🎯 FC: ฿'+fmtN(bFT),weight:'bold',color:'#FFC107',size:'xs'},
          makeBar(bFP,fcClr(bFP)),
          {type:'box',layout:'horizontal',contents:[
            {type:'text',text:bFP.toFixed(1)+'%',size:'xs',color:fcClr(bFP),weight:'bold'},
            {type:'text',text:'ขาด ฿'+fmtN(bFG),size:'xs',color:'#FF5252',align:'end'}
          ]},
          {type:'text',text:'⏳ ต้องทำ/วัน ฿'+fmtN(Math.round(bDailyNeed)),size:'xs',color:'#AAAAAA'}
        ]}
      });
    });

    var brandFlex = { type:'carousel', contents: brandBubbles };

    // Build schedule array
    var schedule = [];

    // 1) Summary Report (Flex)
    schedule.push({
      id: 'summary',
      name: 'Summary Report',
      sendTime: cfg['line_sum_send_time'] || '09:00',
      messageType: 'flex',
      altText: 'JLC ALL ONLINE Daily Report — ' + dateLabel,
      flex: sumFlex
    });

    // 2) Per-Brand Report (Flex)
    schedule.push({
      id: 'per_brand',
      name: 'Per-Brand Report',
      sendTime: cfg['line_brand_send_time'] || '09:00',
      messageType: 'flex',
      altText: 'Brand Report — ' + dateLabel,
      flex: brandFlex
    });

    // 3) Custom messages
    var customMsgs = [];
    try { customMsgs = JSON.parse(cfg['line_custom_msgs'] || '[]'); } catch(e) {}
    customMsgs.forEach(function(m) {
      var text = m.type === 'template' ? applyVars(m.content || '') : (m.content || '');
      schedule.push({
        id: m.id,
        name: m.name || 'Custom',
        sendTime: m.sendTime || '09:00',
        type: m.type,
        message: text
      });
    });

    res.json({
      lineToken: cfg['line_token'] || '',
      lineGroup: cfg['line_group'] || '',
      schedule: schedule
    });
  } catch (err) {
    console.error('GET /api/line/schedule error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/line/send — ส่ง LINE message จริงผ่าน LINE Messaging API
app.post('/api/line/send', requireAuth, async (req, res) => {
  try {
    var { rows: cfgRows } = await pool.query("SELECT key, value FROM config WHERE key IN ('line_token','line_group')");
    var cfg = {};
    cfgRows.forEach(function(r){ cfg[r.key] = r.value; });

    var token = req.body.token || cfg['line_token'];
    var groupId = req.body.groupId || cfg['line_group'];
    var message = req.body.message;      // text message
    var flexContent = req.body.flex;       // flex JSON content
    var altText = req.body.altText || 'ECOM Report';

    if (!token) return res.status(400).json({ error: 'LINE token not configured' });
    if (!groupId) return res.status(400).json({ error: 'LINE group ID not configured' });
    if (!message && !flexContent) return res.status(400).json({ error: 'message or flex required' });

    // Build LINE message object
    var lineMsg;
    if (flexContent) {
      // Flex Message
      lineMsg = { type: 'flex', altText: altText, contents: flexContent };
    } else {
      // Text Message
      lineMsg = { type: 'text', text: message };
    }

    // Call LINE Push Message API
    var https = require('https');
    var postData = JSON.stringify({
      to: groupId,
      messages: [lineMsg]
    });
    var result = await new Promise(function(resolve, reject) {
      var req2 = https.request({
        hostname: 'api.line.me',
        path: '/v2/bot/message/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, function(resp) {
        var body = '';
        resp.on('data', function(c) { body += c; });
        resp.on('end', function() { resolve({ status: resp.statusCode, body: body }); });
      });
      req2.on('error', reject);
      req2.write(postData);
      req2.end();
    });

    if (result.status === 200) {
      res.json({ success: true, message: 'ส่งสำเร็จ!' });
    } else {
      res.json({ success: false, status: result.status, error: result.body });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/line/send-report — ส่งข้อความ LINE ตามเวลาที่ตั้งในแดชบอร์ด
// แต่ละข้อความส่งแค่ 1 ครั้ง/วัน — ระบบจำว่าส่งไปแล้ววันไหน
// query: ?all=1 — ส่งทุกข้อความ (ไม่สน sent_today)
app.post('/api/line/send-report', async (req, res) => {
  try {
    var sendAll = req.query.all === '1' || req.body.all === '1';

    // เวลาปัจจุบัน (ไทย UTC+7)
    var now = new Date(Date.now() + 7*60*60*1000);
    var nowHH = now.getUTCHours();
    var nowMM = now.getUTCMinutes();
    var nowTime = String(nowHH).padStart(2,'0') + ':' + String(nowMM).padStart(2,'0');
    var todayStr = now.toISOString().substring(0, 10);

    // ดึง sent log จาก config table
    var sentLog = {};
    try {
      var { rows: sentRows } = await pool.query("SELECT value FROM config WHERE key = 'line_sent_log'");
      if (sentRows.length > 0) sentLog = JSON.parse(sentRows[0].value || '{}');
    } catch(e) {}

    // ดึง schedule data
    var http = require('http');
    var schedResp = await new Promise(function(resolve, reject) {
      http.get('http://localhost:' + PORT + '/api/line/schedule', function(resp) {
        var body = '';
        resp.on('data', function(c) { body += c; });
        resp.on('end', function() {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });

    var token = schedResp.lineToken;
    var groupId = schedResp.lineGroup;
    if (!token) return res.status(400).json({ error: 'LINE token not configured — ใส่ใน Config tab' });
    if (!groupId) return res.status(400).json({ error: 'LINE group ID not configured — ใส่ใน Config tab' });

    // ดึง reminder template + send time จาก config table
    var dbData = {};
    try {
      var { rows: rCfgRows } = await pool.query("SELECT key, value FROM config WHERE key IN ('line_reminder_send_time','reminder_template')");
      rCfgRows.forEach(function(r) {
        if (r.key === 'line_reminder_send_time') dbData.lineReminderSendTime = r.value;
        if (r.key === 'reminder_template') {
          try {
            var tpl = JSON.parse(r.value);
            dbData.reminderTitle = tpl.title;
            dbData.reminderItem1Title = tpl.item1Title;
            dbData.reminderItem1Desc = tpl.item1Desc;
            dbData.reminderItem2Title = tpl.item2Title;
            dbData.reminderItem2Desc = tpl.item2Desc;
            dbData.reminderThankMsg = tpl.thankMsg;
          } catch(e2) {}
        }
      });
    } catch(e) {}

    // เช็คว่าถึงเวลาส่งหรือยัง (current time >= sendTime)
    function isTimeToSend(sendTime) {
      if (sendAll) return true;
      if (!sendTime) return false;
      var parts = sendTime.split(':');
      var sHH = parseInt(parts[0]), sMM = parseInt(parts[1] || 0);
      // ถึงเวลาแล้ว = ชั่วโมงปัจจุบัน >= ชั่วโมงที่ตั้ง (ให้ tolerance ภายใน 30 นาที)
      var sMin = sHH * 60 + sMM;
      var nMin = nowHH * 60 + nowMM;
      return nMin >= sMin && nMin <= sMin + 29;
    }

    // เช็คว่าส่งไปแล้ววันนี้หรือยัง
    function alreadySentToday(msgId) {
      if (sendAll) return false;
      return sentLog[msgId] === todayStr;
    }

    var https = require('https');
    var results = [];
    var skipped = [];

    // Helper: ส่ง LINE Push
    async function pushLine(lineMsg) {
      var postData = JSON.stringify({ to: groupId, messages: [lineMsg] });
      return new Promise(function(resolve, reject) {
        var req2 = https.request({
          hostname: 'api.line.me', path: '/v2/bot/message/push', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(postData) }
        }, function(resp) {
          var body = '';
          resp.on('data', function(c) { body += c; });
          resp.on('end', function() { resolve({ status: resp.statusCode, body: body }); });
        });
        req2.on('error', reject);
        req2.write(postData);
        req2.end();
      });
    }

    // 1) ส่ง schedule messages (summary, brand, custom)
    for (var i = 0; i < schedResp.schedule.length; i++) {
      var item = schedResp.schedule[i];

      if (alreadySentToday(item.id)) {
        skipped.push({ id: item.id, name: item.name, reason: 'already_sent_today' });
        continue;
      }
      if (!isTimeToSend(item.sendTime)) {
        skipped.push({ id: item.id, name: item.name, sendTime: item.sendTime, reason: 'not_yet' });
        continue;
      }

      var lineMsg;
      if (item.messageType === 'flex' && item.flex) {
        lineMsg = { type: 'flex', altText: item.altText || item.name, contents: item.flex };
      } else if (item.message) {
        lineMsg = { type: 'text', text: item.message };
      } else { continue; }

      var result = await pushLine(lineMsg);
      console.log('[LINE] sent', item.id, '→', result.status);
      if (result.status === 200) sentLog[item.id] = todayStr;
      results.push({ id: item.id, name: item.name, status: result.status });
      await new Promise(function(r) { setTimeout(r, 500); });
    }

    // 2) ส่งข้อความเตือนทีม
    var reminderTime = dbData.lineReminderSendTime || '17:00';
    if (!alreadySentToday('team_reminder') && isTimeToSend(reminderTime)) {
      var rt = dbData.reminderTitle || 'JLC ALL';
      var t1 = dbData.reminderItem1Title || 'บันทึกสรุปงานวันนี้';
      var d1 = dbData.reminderItem1Desc || 'กรอกข้อมูล task งานต่างๆ ลง Dashboard ให้ครบ';
      var t2 = dbData.reminderItem2Title || 'เตรียมงานพรุ่งนี้';
      var d2 = dbData.reminderItem2Desc || 'วางแผนและเตรียมสิ่งที่ต้องทำ ให้พร้อมก่อนกลับบ้าน';
      var thk = dbData.reminderThankMsg || 'ขอบคุณทุกคนที่ตั้งใจทำงานในวันนี้ 💚';
      var reminderFlex = {
        type:'bubble',size:'mega',
        header:{type:'box',layout:'vertical',contents:[{type:'box',layout:'horizontal',contents:[
          {type:'text',text:'🏢',size:'xxl',flex:0},
          {type:'box',layout:'vertical',contents:[
            {type:'text',text:rt,color:'#FFFFFF',size:'xl',weight:'bold'},
            {type:'text',text:'Daily Reminder',color:'#B8E6C8',size:'xs'}
          ],paddingStart:'md'}
        ],alignItems:'center'}],background:{type:'linearGradient',angle:'135deg',startColor:'#1B5E20',endColor:'#388E3C'},paddingAll:'20px'},
        body:{type:'box',layout:'vertical',contents:[
          {type:'text',text:'📋 สรุปงานก่อนกลับบ้าน',weight:'bold',size:'md',color:'#1B5E20'},
          {type:'separator',margin:'lg',color:'#E8F5E9'},
          {type:'box',layout:'horizontal',contents:[
            {type:'box',layout:'vertical',contents:[{type:'text',text:'✅',size:'md',align:'center'}],width:'32px',height:'32px',backgroundColor:'#E8F5E9',cornerRadius:'16px',justifyContent:'center',alignItems:'center',flex:0},
            {type:'box',layout:'vertical',contents:[{type:'text',text:t1,weight:'bold',size:'sm',color:'#333333'},{type:'text',text:d1,size:'xs',color:'#888888',wrap:true}],paddingStart:'md'}
          ],alignItems:'center',margin:'xl'},
          {type:'box',layout:'horizontal',contents:[
            {type:'box',layout:'vertical',contents:[{type:'text',text:'📌',size:'md',align:'center'}],width:'32px',height:'32px',backgroundColor:'#FFF3E0',cornerRadius:'16px',justifyContent:'center',alignItems:'center',flex:0},
            {type:'box',layout:'vertical',contents:[{type:'text',text:t2,weight:'bold',size:'sm',color:'#333333'},{type:'text',text:d2,size:'xs',color:'#888888',wrap:true}],paddingStart:'md'}
          ],alignItems:'center',margin:'xl'},
          {type:'separator',margin:'xl',color:'#E8F5E9'},
          {type:'box',layout:'vertical',contents:[
            {type:'text',text:thk,size:'sm',color:'#FFFFFF',align:'center',weight:'bold',wrap:true}
          ],background:{type:'linearGradient',angle:'90deg',startColor:'#2E7D32',endColor:'#43A047'},cornerRadius:'lg',paddingAll:'lg',margin:'xl'}
        ],paddingAll:'20px',backgroundColor:'#FFFFFF'},
        footer:{type:'box',layout:'vertical',contents:[{
          type:'button',action:{type:'uri',label:'📊 เปิด Dashboard',uri:'https://ecom-dashboard.wejlc.com'},
          style:'primary',color:'#1B5E20',height:'sm'
        }],paddingAll:'16px',backgroundColor:'#F1F8E9'},
        styles:{header:{separator:false},footer:{separator:false}}
      };
      var reminderResult = await pushLine({ type:'flex', altText:'📋 '+rt+' — สรุปงานก่อนกลับบ้าน', contents:reminderFlex });
      console.log('[LINE] reminder →', reminderResult.status);
      if (reminderResult.status === 200) sentLog['team_reminder'] = todayStr;
      results.push({ id: 'team_reminder', name: 'Team Reminder', status: reminderResult.status });
    } else {
      var reason = alreadySentToday('team_reminder') ? 'already_sent_today' : 'not_yet';
      skipped.push({ id: 'team_reminder', sendTime: reminderTime, reason: reason });
    }

    // บันทึก sent log ลง DB
    await pool.query(
      "INSERT INTO config (key, value) VALUES ('line_sent_log', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(sentLog)]
    );

    res.json({ success: true, currentTime: nowTime, today: todayStr, sent: results, skipped: skipped });
  } catch (err) {
    console.error('[LINE REPORT] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/line/send-reminder — ส่งข้อความเตือนทีม (Flex gradient)
app.post('/api/line/send-reminder', requireAuth, async (req, res) => {
  try {
    var { rows: cfgRows } = await pool.query("SELECT key, value FROM config WHERE key IN ('line_token','line_group')");
    var cfg = {};
    cfgRows.forEach(function(r){ cfg[r.key] = r.value; });

    var token = cfg['line_token'];
    var groupId = cfg['line_group'];
    if (!token) return res.status(400).json({ error: 'LINE token not configured — ใส่ใน Config tab' });
    if (!groupId) return res.status(400).json({ error: 'LINE group ID not configured — ใส่ใน Config tab' });

    var flexContent = {
      "type": "bubble",
      "size": "mega",
      "header": {
        "type": "box", "layout": "vertical",
        "contents": [{
          "type": "box", "layout": "horizontal",
          "contents": [
            { "type": "text", "text": "🏢", "size": "xxl", "flex": 0 },
            { "type": "box", "layout": "vertical", "contents": [
              { "type": "text", "text": "JLC ALL", "color": "#FFFFFF", "size": "xl", "weight": "bold" },
              { "type": "text", "text": "Daily Reminder", "color": "#B8E6C8", "size": "xs" }
            ], "paddingStart": "md" }
          ],
          "alignItems": "center"
        }],
        "background": { "type": "linearGradient", "angle": "135deg", "startColor": "#1B5E20", "endColor": "#388E3C" },
        "paddingAll": "20px"
      },
      "body": {
        "type": "box", "layout": "vertical",
        "contents": [
          { "type": "text", "text": "📋 สรุปงานก่อนกลับบ้าน", "weight": "bold", "size": "md", "color": "#1B5E20" },
          { "type": "separator", "margin": "lg", "color": "#E8F5E9" },
          { "type": "box", "layout": "horizontal", "contents": [
            { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "✅", "size": "md", "align": "center" }], "width": "32px", "height": "32px", "backgroundColor": "#E8F5E9", "cornerRadius": "16px", "justifyContent": "center", "alignItems": "center", "flex": 0 },
            { "type": "box", "layout": "vertical", "contents": [
              { "type": "text", "text": "บันทึกสรุปงานวันนี้", "weight": "bold", "size": "sm", "color": "#333333" },
              { "type": "text", "text": "กรอกข้อมูล task งานต่างๆ ลง Dashboard ให้ครบ", "size": "xs", "color": "#888888", "wrap": true }
            ], "paddingStart": "md" }
          ], "alignItems": "center", "margin": "xl" },
          { "type": "box", "layout": "horizontal", "contents": [
            { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "📌", "size": "md", "align": "center" }], "width": "32px", "height": "32px", "backgroundColor": "#FFF3E0", "cornerRadius": "16px", "justifyContent": "center", "alignItems": "center", "flex": 0 },
            { "type": "box", "layout": "vertical", "contents": [
              { "type": "text", "text": "เตรียมงานพรุ่งนี้", "weight": "bold", "size": "sm", "color": "#333333" },
              { "type": "text", "text": "วางแผนและเตรียมสิ่งที่ต้องทำ ให้พร้อมก่อนกลับบ้าน", "size": "xs", "color": "#888888", "wrap": true }
            ], "paddingStart": "md" }
          ], "alignItems": "center", "margin": "xl" },
          { "type": "separator", "margin": "xl", "color": "#E8F5E9" },
          { "type": "box", "layout": "vertical", "contents": [
            { "type": "text", "text": "ขอบคุณทุกคนที่ตั้งใจทำงานในวันนี้ 💚", "size": "sm", "color": "#FFFFFF", "align": "center", "weight": "bold", "wrap": true }
          ], "background": { "type": "linearGradient", "angle": "90deg", "startColor": "#2E7D32", "endColor": "#43A047" }, "cornerRadius": "lg", "paddingAll": "lg", "margin": "xl" }
        ],
        "paddingAll": "20px", "backgroundColor": "#FFFFFF"
      },
      "footer": {
        "type": "box", "layout": "vertical",
        "contents": [{
          "type": "button",
          "action": { "type": "uri", "label": "📊 เปิด Dashboard", "uri": "https://ecom-dashboard.wejlc.com" },
          "style": "primary", "color": "#1B5E20", "height": "sm"
        }],
        "paddingAll": "16px", "backgroundColor": "#F1F8E9"
      },
      "styles": { "header": { "separator": false }, "footer": { "separator": false } }
    };

    var lineMsg = { type: 'flex', altText: '📋 JLC ALL — สรุปงานก่อนกลับบ้าน', contents: flexContent };

    var https = require('https');
    var postData = JSON.stringify({ to: groupId, messages: [lineMsg] });
    var result = await new Promise(function(resolve, reject) {
      var req2 = https.request({
        hostname: 'api.line.me', path: '/v2/bot/message/push', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(postData) }
      }, function(resp) {
        var body = '';
        resp.on('data', function(c) { body += c; });
        resp.on('end', function() { resolve({ status: resp.statusCode, body: body }); });
      });
      req2.on('error', reject);
      req2.write(postData);
      req2.end();
    });

    console.log('[LINE REMINDER] status:', result.status, result.body);
    if (result.status === 200) {
      res.json({ success: true, message: 'ส่งเตือนทีมสำเร็จ!' });
    } else {
      res.json({ success: false, status: result.status, error: result.body });
    }
  } catch (err) {
    console.error('[LINE REMINDER] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/line/reminder-preview — ดู Flex JSON สำหรับ preview
app.get('/api/line/reminder-preview', function(req, res) {
  var fs = require('fs');
  var path = require('path');
  try {
    var json = fs.readFileSync(path.join(__dirname, 'flex-reminder.json'), 'utf8');
    res.json(JSON.parse(json));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Config endpoints — LINE templates & custom messages
// ============================================================
app.get('/api/config/line_templates', requireAuth, async function(req, res) {
  try {
    var { rows } = await pool.query("SELECT value FROM config WHERE key = 'line_templates'");
    res.json({ value: rows.length > 0 ? rows[0].value : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config/line_templates', requireAuth, async function(req, res) {
  try {
    var value = req.body.value || '';
    await pool.query("INSERT INTO config (key, value) VALUES ('line_templates', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [value]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config/line_custom_msgs', requireAuth, async function(req, res) {
  try {
    var { rows } = await pool.query("SELECT value FROM config WHERE key = 'line_custom_msgs'");
    res.json({ value: rows.length > 0 ? rows[0].value : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config/line_custom_msgs', requireAuth, async function(req, res) {
  try {
    var value = req.body.value || '';
    await pool.query("INSERT INTO config (key, value) VALUES ('line_custom_msgs', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [value]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Health check
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', version: SERVER_VERSION });
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
// Auto-migrate: add sort_order column and set initial order
(async function(){
  try {
    await pool.query("ALTER TABLE brands ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0");
    // Set desired order for existing brands (one-time: only if all are 0)
    var { rows } = await pool.query("SELECT COUNT(*) as c FROM brands WHERE sort_order != 0");
    if(parseInt(rows[0].c) === 0){
      var order = {'JH-ECOM':0,'J-DENT':1,'JNIS':2,'JARVIT':3,'BEAUTERRY':4};
      for(var [code, idx] of Object.entries(order)){
        await pool.query("UPDATE brands SET sort_order = $1 WHERE UPPER(code) = $2", [idx, code]);
      }
      console.log('[MIGRATE] Brand sort_order initialized');
    }
  } catch(e){ console.warn('brands migration:', e.message); }
})();

// Auto-migrate: add can_view column to employees
(async function(){
  try {
    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_view TEXT DEFAULT ''");
    console.log('[MIGRATE] employees.can_view column ready');
  } catch(e){ console.warn('employees can_view migration:', e.message); }
})();

app.listen(PORT, function() {
  console.log('ECOM Dashboard API running on port ' + PORT + ' | version: ' + SERVER_VERSION + ' | AUTO_APPROVE=' + AUTO_APPROVE_USERS);

  // === AUTO LINE BROADCAST — เช็คทุก 1 นาที ===
  setInterval(function(){
    var http = require('http');
    var postReq = http.request({
      hostname: 'localhost', port: PORT, path: '/api/line/send-report', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, function(resp){
      var body = '';
      resp.on('data', function(c){ body += c; });
      resp.on('end', function(){
        try {
          var r = JSON.parse(body);
          if(r.results && r.results.length > 0) console.log('[AUTO-LINE] sent:', r.results.map(function(x){ return x.id+'→'+x.status; }).join(', '));
          if(r.skipped && r.skipped.length > 0) {
            var notYet = r.skipped.filter(function(x){ return x.reason==='not_yet'; });
            if(notYet.length > 0) console.log('[AUTO-LINE] waiting:', notYet.map(function(x){ return x.id+'@'+x.sendTime; }).join(', '));
          }
        } catch(e){}
      });
    });
    postReq.on('error', function(e){ /* server not ready yet */ });
    postReq.write('{}');
    postReq.end();
  }, 60000); // ทุก 60 วินาที
  console.log('[AUTO-LINE] Timer started — checking every 60 seconds');
});
