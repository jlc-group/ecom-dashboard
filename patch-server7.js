const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix: PUT /api/data — reorder operations to respect FK constraints
// Must delete daily tables BEFORE deleting brands (FK: daily_tiktok.brand → brands.code)
const oldBlock = `    const db = req.body;

    // --- Brands ---
    if (Array.isArray(db.brands)) {
      await client.query('DELETE FROM brands');
      for (const name of db.brands) {
        await client.query('INSERT INTO brands (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [name]);
      }
    }

    // --- Employees ---
    if (Array.isArray(db.employees)) {
      await client.query('DELETE FROM employees');
      for (const e of db.employees) {
        await client.query(
          'INSERT INTO employees (name, email, brands, note, is_admin) VALUES ($1,$2,$3,$4,$5)',
          [e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false]
        );
      }
    }

    // --- Platform data ---
    for (const plat of ['tt', 'sp', 'lz']) {
      if (!Array.isArray(db[plat])) continue;
      const table = TABLE_MAP[plat];
      const cols  = PLAT_COLS[plat];
      await client.query(\`DELETE FROM \${table}\`);

      for (const row of db[plat]) {
        const snake = rowToSnake(row);
        const vals  = cols.map(c => cleanVal(c, snake[c]));
        const ph    = cols.map((_, i) => \`$\${i + 1}\`).join(',');
        await client.query(
          \`INSERT INTO \${table} (\${cols.join(',')}) VALUES (\${ph})\`,
          vals
        );
      }
    }`;

const newBlock = `    const db = req.body;

    // --- Platform data FIRST (FK: daily_*.brand → brands.code) ---
    for (const plat of ['tt', 'sp', 'lz']) {
      const table = TABLE_MAP[plat];
      await client.query(\`DELETE FROM \${table}\`);
    }

    // --- Brands (safe to delete now that daily tables are empty) ---
    if (Array.isArray(db.brands)) {
      await client.query('DELETE FROM brands');
      for (const name of db.brands) {
        await client.query('INSERT INTO brands (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [name]);
      }
    }

    // --- Employees ---
    if (Array.isArray(db.employees)) {
      await client.query('DELETE FROM employees');
      for (const e of db.employees) {
        await client.query(
          'INSERT INTO employees (name, email, brands, note, is_admin) VALUES ($1,$2,$3,$4,$5)',
          [e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false]
        );
      }
    }

    // --- Re-insert platform data ---
    for (const plat of ['tt', 'sp', 'lz']) {
      if (!Array.isArray(db[plat])) continue;
      const table = TABLE_MAP[plat];
      const cols  = PLAT_COLS[plat];
      for (const row of db[plat]) {
        const snake = rowToSnake(row);
        const vals  = cols.map(c => cleanVal(c, snake[c]));
        const ph    = cols.map((_, i) => \`$\${i + 1}\`).join(',');
        await client.query(
          \`INSERT INTO \${table} (\${cols.join(',')}) VALUES (\${ph})\`,
          vals
        );
      }
    }`;

c = c.replace(oldBlock, newBlock);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const checks = [
  ['Platform DELETE comes first', fixed.indexOf('Platform data FIRST') < fixed.indexOf('safe to delete now')],
  ['Brands INSERT after platform DELETE', fixed.indexOf('safe to delete now') < fixed.indexOf('Re-insert platform')],
  ['Platform re-insert at end', fixed.includes('Re-insert platform data')],
];
checks.forEach(([name, ok]) => console.log(ok ? '✅' : '❌', name));
console.log('\n✅ Patch 7 complete!');
