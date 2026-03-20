const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const autosaveCode = `// === Global Auto-save — ทุก tab (debounced 2s) ===
let _autoSaveTimer = null;
function triggerAutoSave(){
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  setSaveStatus('saving','⏳ รอบันทึก...');
  _autoSaveTimer = setTimeout(async ()=>{
    _autoSaveTimer = null;
    // Sync all daily tables to DB object
    ['tt','sp','lz'].forEach(plat=>{
      const tbody=document.getElementById('tbody-'+plat);
      if(tbody&&tbody.querySelector('tr[data-row]')) DB[plat]=getTableRows(plat);
    });
    if(!IS_API) { saveDB(); setSaveStatus('ok','✅ บันทึกแล้ว'); return; }
    try {
      const resp = await apiFetch(API_BASE + '/api/data', {
        method: 'PUT',
        body: JSON.stringify(DB)
      });
      if(resp.ok) setSaveStatus('ok','✅ บันทึกแล้ว');
      else throw new Error('HTTP ' + resp.status);
    } catch(e) {
      console.warn('Auto-save failed:', e);
      setSaveStatus('err','⚠️ บันทึกไม่ได้');
    }
  }, 2000);
}

// Global event delegation: any input/select change triggers auto-save
document.addEventListener('DOMContentLoaded', ()=>{
  // blur on inputs (covers daily tables, config fields, APM, etc.)
  document.addEventListener('blur', (e)=>{
    const t = e.target;
    if(t.matches('.page input[type="number"], .page input[type="date"], .page input[type="text"]:not([readonly]), .page textarea')){
      triggerAutoSave();
    }
  }, true);
  // change on selects/checkboxes inside pages
  document.addEventListener('change', (e)=>{
    const t = e.target;
    if(t.matches('.page select, .page input[type="checkbox"]')){
      // skip filter selects (month, brand, etc.)
      if(t.id && (t.id.startsWith('sel') || t.id.startsWith('audit') || t.id.startsWith('apm') || t.id.startsWith('dd') || t.id.startsWith('line') || t.id.startsWith('fc'))) return;
      triggerAutoSave();
    }
  });
});

`;

// Insert before the LINE Templates section
html = html.replace(
  '// === LINE Templates (editable) ===',
  autosaveCode + '// === LINE Templates (editable) ==='
);

fs.writeFileSync('index.html', html);

// Verify
const fixed = fs.readFileSync('index.html', 'utf8');
const checks = [
  ['triggerAutoSave function exists', fixed.includes('function triggerAutoSave()')],
  ['Global blur listener', fixed.includes("document.addEventListener('blur'")],
  ['Global change listener', fixed.includes("document.addEventListener('change'")],
];
checks.forEach(([name, ok]) => console.log(ok ? '✅' : '❌', name));
console.log('\n✅ Patch auto-save (global) complete!');
