const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// The linter keeps stripping $ from template literals
// Use string concatenation instead: '$' + (i + 1)
// Find the broken line in "Re-insert platform data" block (line ~227)
c = c.replace(
  /\/\/ --- Re-insert platform data ---[\s\S]*?const ph\s*=\s*cols\.map\(\(_, i\) => `\$?\{i \+ 1\}`\)\.join\(','\);/,
  `// --- Re-insert platform data ---
    for (const plat of ['tt', 'sp', 'lz']) {
      if (!Array.isArray(db[plat])) continue;
      const table = TABLE_MAP[plat];
      const cols  = PLAT_COLS[plat];
      for (const row of db[plat]) {
        const snake = rowToSnake(row);
        const vals  = cols.map(c => cleanVal(c, snake[c]));
        const ph    = cols.map((_, i) => ('$' + (i + 1))).join(',');`
);

fs.writeFileSync('server.js', c);

// Verify
const fixed = fs.readFileSync('server.js', 'utf8');
const hasConcat = fixed.includes("('$' + (i + 1))");
console.log(hasConcat ? '✅' : '❌', 'Uses string concatenation for placeholder');
console.log('\n✅ Patch placeholder2 complete!');
