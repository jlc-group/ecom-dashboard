const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix: brands ORDER BY id → ORDER BY name (brands table has no id column)
c = c.replace(
  "SELECT name FROM brands ORDER BY id",
  "SELECT name FROM brands ORDER BY name"
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const ok = fixed.includes("ORDER BY name") && !fixed.includes("ORDER BY id");
console.log(ok ? '✅' : '❌', 'brands ORDER BY name');
console.log('\n✅ Patch 4 complete!');
