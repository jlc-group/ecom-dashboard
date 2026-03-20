const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix: brands INSERT — add code column (use name as code)
// There are 2 places: PUT /api/brands and PUT /api/data

// Fix 1: PUT /api/brands (standalone endpoint)
c = c.replace(
  "INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]",
  "INSERT INTO brands (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [name]"
);

// Fix 2: PUT /api/data (bulk save)  — same pattern, second occurrence
c = c.replace(
  "INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]",
  "INSERT INTO brands (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [name]"
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const count = (fixed.match(/INSERT INTO brands \(code, name\)/g) || []).length;
const noOld = !fixed.includes("INSERT INTO brands (name)");
console.log(count === 2 ? '✅' : '❌', `brands INSERT has code,name (found ${count}/2)`);
console.log(noOld ? '✅' : '❌', 'No old INSERT INTO brands (name) remaining');
console.log('\n✅ Patch 6 complete!');
