const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix 1: GET /api/employees — remove can_view from SELECT
c = c.replace(
  "SELECT id, name, email, brands, note, is_admin, can_view FROM employees ORDER BY id",
  "SELECT id, name, email, brands, note, is_admin FROM employees ORDER BY id"
);

// Fix 2: PUT /api/employees — remove can_view from INSERT
c = c.replace(
  "INSERT INTO employees (name, email, brands, note, is_admin, can_view) VALUES ($1,$2,$3,$4,$5,$6)",
  "INSERT INTO employees (name, email, brands, note, is_admin) VALUES ($1,$2,$3,$4,$5)"
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const checks = [
  ['No can_view in employees SELECT', !fixed.includes('can_view FROM employees')],
  ['No can_view in employees INSERT', !fixed.includes('is_admin, can_view)')],
  ['employees SELECT correct', fixed.includes('is_admin FROM employees ORDER BY id')],
  ['employees INSERT correct', fixed.includes('is_admin) VALUES ($1,$2,$3,$4,$5)')],
];
checks.forEach(([name, ok]) => console.log(ok ? '✅' : '❌', name));
console.log('\n✅ Patch 3 complete!');
