const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// ==============================================
// Fix 1: Wrap GET /api/brands in try/catch
// ==============================================
c = c.replace(
  `app.get('/api/brands', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM brands ORDER BY name');
  res.json(rows.map(r => r.name));
});`,
  `app.get('/api/brands', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT name FROM brands ORDER BY name');
    res.json(rows.map(r => r.name));
  } catch (err) {
    console.error('GET /api/brands error:', err.message);
    res.status(500).json({ error: err.message });
  }
});`
);

// ==============================================
// Fix 2: Wrap GET /api/employees in try/catch
// ==============================================
c = c.replace(
  `app.get('/api/employees', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, brands, note, is_admin FROM employees ORDER BY id');
  res.json(rows.map(rowToCamel));
});`,
  `app.get('/api/employees', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, brands, note, is_admin FROM employees ORDER BY id');
    res.json(rows.map(rowToCamel));
  } catch (err) {
    console.error('GET /api/employees error:', err.message);
    res.status(500).json({ error: err.message });
  }
});`
);

// ==============================================
// Fix 3: Add global error handlers BEFORE app.listen
// ==============================================
c = c.replace(
  `// ============================================================
// Start
// ============================================================
app.listen(PORT, () => {`,
  `// ============================================================
// Global error handling — prevent server crash
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught Exception (server still running):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('⚠️  Unhandled Rejection (server still running):', err.message || err);
});

// ============================================================
// Start
// ============================================================
app.listen(PORT, () => {`
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const checks = [
  ['GET /api/brands has try/catch', fixed.includes("GET /api/brands error")],
  ['GET /api/employees has try/catch', fixed.includes("GET /api/employees error")],
  ['Global uncaughtException handler', fixed.includes("uncaughtException")],
  ['Global unhandledRejection handler', fixed.includes("unhandledRejection")],
];
checks.forEach(([name, ok]) => console.log(ok ? '✅' : '❌', name));
console.log('\n✅ Patch 5 complete!');
