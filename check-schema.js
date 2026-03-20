const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres:postgres123@localhost:15432/ecom_dashboard', ssl: false });

async function run() {
  const tables = ['audit_log', 'apm_tasks', 'config', 'forecast_gmv', 'employee_permissions'];
  for (const t of tables) {
    try {
      const { rows } = await p.query(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position", [t]
      );
      console.log(`\n=== ${t} ===`);
      rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type}, ${r.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'})`));
      if (rows.length === 0) console.log('  (table not found)');
    } catch(e) { console.error(`  Error: ${e.message}`); }
  }
  await p.end();
}
run();
