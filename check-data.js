const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres:postgres123@localhost:15432/ecom_dashboard', ssl: false });

async function run() {
  const queries = [
    ['brands', 'SELECT * FROM brands ORDER BY name'],
    ['employees', 'SELECT * FROM employees ORDER BY id'],
    ['daily_tiktok', 'SELECT date, brand, gmv, orders FROM daily_tiktok ORDER BY date DESC, brand LIMIT 10'],
    ['daily_shopee', 'SELECT date, brand, gmv, orders FROM daily_shopee ORDER BY date DESC, brand LIMIT 10'],
    ['daily_lazada', 'SELECT date, brand, gmv, orders FROM daily_lazada ORDER BY date DESC, brand LIMIT 10'],
    ['apm_tasks', 'SELECT * FROM apm_tasks ORDER BY id DESC LIMIT 5'],
    ['audit_log', 'SELECT id, ts, user_name, action, brand FROM audit_log ORDER BY id DESC LIMIT 5'],
  ];
  for (const [name, sql] of queries) {
    try {
      const { rows } = await p.query(sql);
      console.log(`\n=== ${name} (${rows.length} rows) ===`);
      if (rows.length === 0) console.log('  (empty)');
      else rows.forEach(r => console.log(' ', JSON.stringify(r)));
    } catch(e) { console.error(`  ${name} Error: ${e.message}`); }
  }
  await p.end();
}
run();
