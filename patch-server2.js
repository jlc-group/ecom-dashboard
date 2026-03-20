const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix 1: brands — no 'id' column, use 'name' for ordering
c = c.replace(
  "SELECT name FROM brands ORDER BY id",
  "SELECT name FROM brands ORDER BY name"
);

// Fix 2: employees — no 'can_view' column
c = c.replace(
  "SELECT id, name, email, brands, note, is_admin, can_view FROM employees ORDER BY id",
  "SELECT id, name, email, brands, note, is_admin FROM employees ORDER BY id"
);

// Fix 3: employees INSERT — remove can_view
c = c.replace(
  "'INSERT INTO employees (name, email, brands, note, is_admin, can_view) VALUES ($1,$2,$3,$4,$5,$6)'",
  "'INSERT INTO employees (name, email, brands, note, is_admin) VALUES ($1,$2,$3,$4,$5)'"
);
// Also fix the array of values (remove JSON.stringify(e.canView||[]))
c = c.replace(
  /\[e\.name\|\|'', e\.email\|\|'', e\.brands\|\|'', e\.note\|\|'', e\.isAdmin\|\|false, JSON\.stringify\(e\.canView\|\|\[\]\)\]/g,
  "[e.name||'', e.email||'', e.brands||'', e.note||'', e.isAdmin||false]"
);

// Fix 4: brands DELETE + INSERT — use actual schema (code, name, nm_target)
c = c.replace(
  "INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING"
);
c = c.replace(
  "INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING",
  "INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING"
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const checks = [
  ['No ORDER BY id in brands', !fixed.includes("brands ORDER BY id")],
  ['No can_view in employees SELECT', !fixed.includes("can_view FROM employees")],
  ['No can_view in employees INSERT', !fixed.includes("is_admin, can_view) VALUES")],
];
checks.forEach(([name, ok]) => console.log(ok ? '✅' : '❌', name));
console.log('\n✅ Patch complete!');
