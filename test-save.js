// Test save flow: brands → daily TT → read back
const BASE = 'http://localhost:8088';

async function test() {
  // 1. Save brands
  console.log('--- Step 1: Save brands ---');
  let r = await fetch(`${BASE}/api/brands`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brands: ['TestBrand1', 'TestBrand2'] })
  });
  let j = await r.json();
  console.log('PUT /api/brands:', j);

  // 2. Read brands back
  r = await fetch(`${BASE}/api/brands`);
  j = await r.json();
  console.log('GET /api/brands:', j);

  // 3. Save daily TT data (one row)
  console.log('\n--- Step 2: Save daily TT ---');
  r = await fetch(`${BASE}/api/daily/tt/bulk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { date: '2025-03-20', brand: 'TestBrand1', gmv: 50000, orders: 120, saleAds: 10000, organic: 5000 }
    ])
  });
  j = await r.json();
  console.log('PUT /api/daily/tt/bulk:', j);

  // 4. Read daily TT back
  r = await fetch(`${BASE}/api/daily/tt`);
  j = await r.json();
  console.log('GET /api/daily/tt:', JSON.stringify(j, null, 2));

  // 5. Save employees
  console.log('\n--- Step 3: Save employees ---');
  r = await fetch(`${BASE}/api/employees`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employees: [
      { name: 'Admin Test', email: 'admin@test.com', brands: 'TestBrand1,TestBrand2', note: '', isAdmin: true }
    ]})
  });
  j = await r.json();
  console.log('PUT /api/employees:', j);

  // 6. Read employees back
  r = await fetch(`${BASE}/api/employees`);
  j = await r.json();
  console.log('GET /api/employees:', JSON.stringify(j, null, 2));

  console.log('\n✅ All tests done!');
}

test().catch(e => console.error('❌ Test failed:', e.message));
