const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Fix line 227: missing $ in placeholder — only the first occurrence in PUT /api/data
// The broken one is inside "Re-insert platform data" block
c = c.replace(
  "// --- Re-insert platform data ---\n    for (const plat of ['tt', 'sp', 'lz']) {\n      if (!Array.isArray(db[plat])) continue;\n      const table = TABLE_MAP[plat];\n      const cols  = PLAT_COLS[plat];\n      for (const row of db[plat]) {\n        const snake = rowToSnake(row);\n        const vals  = cols.map(c => cleanVal(c, snake[c]));\n        const ph    = cols.map((_, i) => `${i + 1}`).join(',');",
  "// --- Re-insert platform data ---\n    for (const plat of ['tt', 'sp', 'lz']) {\n      if (!Array.isArray(db[plat])) continue;\n      const table = TABLE_MAP[plat];\n      const cols  = PLAT_COLS[plat];\n      for (const row of db[plat]) {\n        const snake = rowToSnake(row);\n        const vals  = cols.map(c => cleanVal(c, snake[c]));\n        const ph    = cols.map((_, i) => `$${i + 1}`).join(',');"
);

fs.writeFileSync('server.js', c);

// Verify — all 3 occurrences should have $
const fixed = fs.readFileSync('server.js', 'utf8');
const matches = fixed.match(/cols\.map\(\(_, i\) => `\$\$\{i \+ 1\}`\)/g);
const bad = fixed.match(/cols\.map\(\(_, i\) => `\{i \+ 1\}`\)/g);
console.log(matches && matches.length === 3 ? '✅' : '❌', `Found ${matches?.length||0}/3 correct placeholders`);
console.log(!bad ? '✅' : '❌', `No broken placeholders: ${bad?.length||0} found`);
console.log('\n✅ Patch placeholder complete!');
