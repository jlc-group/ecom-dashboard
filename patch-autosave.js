const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Add debounced auto-save for daily tables — insert before the renderLINE section
const autosaveCode = `// === Auto-save on cell blur (debounced 2s) ===
let _autoSaveTimer = null;
function triggerAutoSave(){
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  setSaveStatus('saving','⏳ รอบันทึก...');
  _autoSaveTimer = setTimeout(async ()=>{
    _autoSaveTimer = null;
    if(!IS_API) { saveDB(); return; }
    // Sync current table to DB object
    ['tt','sp','lz'].forEach(plat=>{
      const tbody=document.getElementById('tbody-'+plat);
      if(tbody&&tbody.querySelector('tr[data-row]')) DB[plat]=getTableRows(plat);
    });
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

// Attach blur listener to all daily table bodies (event delegation)
document.addEventListener('DOMContentLoaded', ()=>{
  ['tt','sp','lz'].forEach(plat=>{
    const tbody = document.getElementById('tbody-'+plat);
    if(!tbody) return;
    tbody.addEventListener('blur', (e)=>{
      if(e.target.matches('input[type="number"], input[type="date"]')){
        triggerAutoSave();
      }
    }, true); // use capture phase for blur
  });
});

`;

// Insert before the LINE Templates section
html = html.replace(
  '// === LINE Templates (editable) ===',
  autosaveCode + '// === LINE Templates (editable) ==='
);

fs.writeFileSync('index.html', html);
console.log('✅ Added auto-save on cell blur (2s debounce)');
