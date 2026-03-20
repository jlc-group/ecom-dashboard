const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix 1: audit_log — "user" → user_name (appears in multiple places)
c = c.replace(/INSERT INTO audit_log \(ts, "user", action/g, 'INSERT INTO audit_log (ts, user_name, action');

// Fix 2: apm_tasks — due → due_date (INSERT statements)
c = c.replace(/status, start_date, due, note\)/g, 'status, start_date, due_date, note)');

// Fix 3: TEXT_COLS — add user_name, due_date; keep old ones for camelCase conversion
c = c.replace(
  "'data_date', 'field', 'old_val', 'new_val', 'user', 'ts'",
  "'data_date', 'field', 'old_val', 'new_val', 'user', 'user_name', 'ts', 'due_date'"
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const checks = [
  ['audit_log uses user_name', !fixed.includes('"user"') && fixed.includes('user_name, action')],
  ['apm_tasks uses due_date', fixed.includes('due_date, note)')],
  ['No old "user" in audit INSERT', (fixed.match(/INSERT INTO audit_log/g) || []).length === (fixed.match(/user_name, action/g) || []).length],
];
checks.forEach(([name, ok]) => console.log(ok ? '✅' : '❌', name));
console.log('\n✅ Patch 8 complete!');
