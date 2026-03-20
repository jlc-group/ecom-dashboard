const fs = require('fs');

// ========================================
// PART 1: Add config API to server.js
// ========================================
let srv = fs.readFileSync('server.js', 'utf8');

// Add GET/PUT /api/config/templates endpoint before the health check
const healthBlock = `// ============================================================
// Health check
// ============================================================`;

const configAPI = `// ============================================================
// Config key-value store (for LINE templates etc.)
// ============================================================
app.get('/api/config/:key', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT value FROM config WHERE key = $1', [req.params.key]);
    res.json({ value: rows.length > 0 ? rows[0].value : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config/:key', requireAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    await pool.query(
      'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

${healthBlock}`;

srv = srv.replace(healthBlock, configAPI);
fs.writeFileSync('server.js', srv);
console.log('✅ server.js: Added config API endpoints');

// ========================================
// PART 2: Modify index.html — LINE page
// ========================================
let html = fs.readFileSync('index.html', 'utf8');

// Replace the LINE page section
const oldLinePage = `<div id="page-line" class="page">
  <div style="font-size:14px;font-weight:700;margin-bottom:16px;">💬 LINE_Data — ตัวอย่างข้อความ LINE</div>
  <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;">
    <select class="sel" id="lineDate" onchange="renderLINE()">
      <option value="today">วันนี้</option>
      <option value="all">ทั้งเดือน</option>
    </select>
    <select class="sel" id="lineBrandSel" onchange="renderLINE()">
      <option value="all">ทุกแบรนด์</option>
    </select>
    <button class="btn btn-primary btn-sm" onclick="renderLINE()">🔄 อัพเดต</button>
  </div>
  <div class="g2">
    <div class="card">
      <div class="card-title" style="margin-bottom:10px;">📊 Summary Report</div>
      <pre id="lineSum" style="background:#0d1f0d;border:1px solid #1d4a1d;border-radius:8px;padding:14px;font-size:12px;line-height:1.8;color:#90ee90;white-space:pre-wrap;font-family:'Courier New',monospace;"></pre>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:10px;">🏷️ Per-Brand Report</div>
      <pre id="lineBrandMsg" style="background:#0d1f0d;border:1px solid #1d4a1d;border-radius:8px;padding:14px;font-size:12px;line-height:1.8;color:#90ee90;white-space:pre-wrap;font-family:'Courier New',monospace;"></pre>
    </div>
  </div>
</div>`;

const newLinePage = `<div id="page-line" class="page">
  <div style="font-size:14px;font-weight:700;margin-bottom:16px;">💬 LINE_Data — ตัวอย่างข้อความ LINE</div>
  <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap;">
    <select class="sel" id="lineDate" onchange="renderLINE()">
      <option value="today">วันนี้</option>
      <option value="all">ทั้งเดือน</option>
    </select>
    <select class="sel" id="lineBrandSel" onchange="renderLINE()">
      <option value="all">ทุกแบรนด์</option>
    </select>
    <button class="btn btn-primary btn-sm" onclick="renderLINE()">🔄 อัพเดต</button>
    <button class="btn btn-sm" id="btnToggleLineEdit" onclick="toggleLineEditor()" style="background:var(--surface2);color:var(--muted);border:1px solid var(--border);">✏️ แก้ไข Template</button>
  </div>

  <!-- Editor Mode (hidden by default) -->
  <div id="lineEditorPanel" style="display:none;margin-bottom:20px;">
    <div class="card" style="border:1px solid var(--accent);">
      <div class="card-title" style="margin-bottom:8px;">✏️ แก้ไข Template รายงาน</div>
      <div style="color:var(--muted);font-size:11px;margin-bottom:12px;">
        ตัวแปรที่ใช้ได้: <code>{date}</code> <code>{gmv}</code> <code>{orders}</code> <code>{nm_pct}</code> <code>{ads}</code> <code>{roas}</code> <code>{tt_gmv}</code> <code>{sp_gmv}</code> <code>{lz_gmv}</code> <code>{nm_target}</code> <code>{roas_target}</code><br>
        Per-Brand: <code>{brand_rows}</code> = แต่ละแบรนด์ (ใช้ <code>{b_name}</code> <code>{b_gmv}</code> <code>{b_nm_pct}</code> <code>{b_icon}</code> ใน brand_row_template)<br>
        <code>{warnings}</code> = แบรนด์ที่ NM ต่ำกว่าเป้า
      </div>
      <div class="g2">
        <div>
          <label style="color:var(--muted);font-size:11px;">Summary Template:</label>
          <textarea id="lineSumTpl" rows="14" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px;font-family:'Courier New',monospace;font-size:11px;resize:vertical;"></textarea>
        </div>
        <div>
          <label style="color:var(--muted);font-size:11px;">Per-Brand Template:</label>
          <textarea id="lineBrandTpl" rows="10" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px;font-family:'Courier New',monospace;font-size:11px;resize:vertical;margin-bottom:8px;"></textarea>
          <label style="color:var(--muted);font-size:11px;">Brand Row Template (แต่ละแบรนด์):</label>
          <textarea id="lineBrandRowTpl" rows="2" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px;font-family:'Courier New',monospace;font-size:11px;resize:vertical;"></textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-success btn-sm" onclick="saveLineTemplates()">💾 บันทึก Template</button>
        <button class="btn btn-primary btn-sm" onclick="renderLINE()">👁️ Preview</button>
        <button class="btn btn-sm" onclick="resetLineTemplates()" style="background:var(--surface2);color:var(--muted);border:1px solid var(--border);">🔄 คืนค่าเดิม</button>
      </div>
    </div>
  </div>

  <!-- Preview (always visible) -->
  <div class="g2">
    <div class="card">
      <div class="card-title" style="margin-bottom:10px;">📊 Summary Report</div>
      <pre id="lineSum" style="background:#0d1f0d;border:1px solid #1d4a1d;border-radius:8px;padding:14px;font-size:12px;line-height:1.8;color:#90ee90;white-space:pre-wrap;font-family:'Courier New',monospace;"></pre>
      <button class="btn btn-sm" style="margin-top:8px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);" onclick="copyLineText('lineSum')">📋 Copy</button>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:10px;">🏷️ Per-Brand Report</div>
      <pre id="lineBrandMsg" style="background:#0d1f0d;border:1px solid #1d4a1d;border-radius:8px;padding:14px;font-size:12px;line-height:1.8;color:#90ee90;white-space:pre-wrap;font-family:'Courier New',monospace;"></pre>
      <button class="btn btn-sm" style="margin-top:8px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);" onclick="copyLineText('lineBrandMsg')">📋 Copy</button>
    </div>
  </div>
</div>`;

html = html.replace(oldLinePage, newLinePage);
console.log('✅ index.html: Replaced LINE page with editor UI');

// ========================================
// PART 3: Replace renderLINE function with template-based version
// ========================================
const oldRenderLINE = `function renderLINE(){
  // populate brand dropdown
  const sel=document.getElementById('lineBrandSel');
  if(sel.options.length<=1){
    BRANDS.forEach(b=>{ const o=document.createElement('option'); o.value=b; o.text=b; sel.appendChild(o); });
  }

  const allRows=aggregateData();
  const byBrand=aggregateByBrand(allRows);
  const brandKeys=Object.keys(byBrand);
  const totalGMV=allRows.reduce((s,r)=>s+p(r.gmv),0);
  const totalNM=allRows.reduce((s,r)=>s+p(r.nm),0);
  const totalAds=brandKeys.reduce((s,b)=>s+byBrand[b].ads,0);
  const totalOrders=allRows.reduce((s,r)=>s+p(r.orders),0);
  const nmPct=totalGMV>0?totalNM/totalGMV*100:0;
  const roas=totalAds>0?totalGMV/totalAds:0;

  const today=new Date();
  const d=today.getDate(), m=today.getMonth();
  const thMonths=['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const dateLabel=\`\${d} \${thMonths[m+1]} \${today.getFullYear()+543}\`;

  const byPlat=aggregateByPlat(allRows);

  document.getElementById('lineSum').textContent =
\`📊 ECOM รายวัน — \${dateLabel}
════════════════════
💰 GMV รวม     : ฿\${fmt(totalGMV)}
📦 Orders      : \${fmt(totalOrders)} orders
💹 Net Margin  : \${nmPct.toFixed(1)}% \${nmPct>=NM_TARGET?'✅':'⚠️'}
📢 Ads Spend   : ฿\${fmt(totalAds)}
🎯 ROAS        : \${roas.toFixed(1)}x \${roas>=ROAS_TARGET?'✅':'⚠️'}
════════════════════
🔴 TikTok  : ฿\${fmt(byPlat.tt.gmv)}
🟠 Shopee  : ฿\${fmt(byPlat.sp.gmv)}
🟣 Lazada  : ฿\${fmt(byPlat.lz.gmv)}
════════════════════
NM Target: \${NM_TARGET}% | ROAS Target: \${ROAS_TARGET}x\`;

  const warnings=brandKeys.filter(b=>byBrand[b].nm_pct<NM_TARGET);
  document.getElementById('lineBrandMsg').textContent =
\`🏷️ Brand Breakdown — \${dateLabel}
════════════════════
\${brandKeys.map(b=>{
  const d2=byBrand[b];
  const icon=d2.nm_pct>=NM_TARGET?'🟢':d2.nm_pct>=6?'🟡':'🔴';
  return \`\${icon} \${b}: ฿\${fmt(d2.gmv)} | NM \${d2.nm_pct.toFixed(1)}%\`;
}).join('\\n')}
════════════════════
\${warnings.length?'🚨 ต้องดูแลด่วน:\\n'+warnings.map(b=>\`⚠️ \${b} → NM \${byBrand[b].nm_pct.toFixed(1)}%\`).join('\\n'):'✅ ทุกแบรนด์ผ่านเป้า NM!'}\`;
}`;

const newRenderLINE = `// === LINE Templates (editable) ===
const DEFAULT_LINE_SUM_TPL = \`📊 ECOM รายวัน — {date}
════════════════════
💰 GMV รวม     : ฿{gmv}
📦 Orders      : {orders} orders
💹 Net Margin  : {nm_pct}% {nm_status}
📢 Ads Spend   : ฿{ads}
🎯 ROAS        : {roas}x {roas_status}
════════════════════
🔴 TikTok  : ฿{tt_gmv}
🟠 Shopee  : ฿{sp_gmv}
🟣 Lazada  : ฿{lz_gmv}
════════════════════
NM Target: {nm_target}% | ROAS Target: {roas_target}x\`;

const DEFAULT_LINE_BRAND_TPL = \`🏷️ Brand Breakdown — {date}
════════════════════
{brand_rows}
════════════════════
{warnings}\`;

const DEFAULT_LINE_BRAND_ROW_TPL = \`{b_icon} {b_name}: ฿{b_gmv} | NM {b_nm_pct}%\`;

let LINE_SUM_TPL = DEFAULT_LINE_SUM_TPL;
let LINE_BRAND_TPL = DEFAULT_LINE_BRAND_TPL;
let LINE_BRAND_ROW_TPL = DEFAULT_LINE_BRAND_ROW_TPL;

function toggleLineEditor(){
  const panel = document.getElementById('lineEditorPanel');
  const btn = document.getElementById('btnToggleLineEdit');
  if(panel.style.display==='none'){
    panel.style.display='block';
    btn.style.background='var(--accent)'; btn.style.color='#fff'; btn.textContent='✏️ ซ่อน Editor';
    document.getElementById('lineSumTpl').value = LINE_SUM_TPL;
    document.getElementById('lineBrandTpl').value = LINE_BRAND_TPL;
    document.getElementById('lineBrandRowTpl').value = LINE_BRAND_ROW_TPL;
  } else {
    panel.style.display='none';
    btn.style.background='var(--surface2)'; btn.style.color='var(--muted)'; btn.textContent='✏️ แก้ไข Template';
  }
}

function copyLineText(id){
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(()=>showToast('📋 คัดลอกแล้ว!')).catch(()=>{});
}

async function saveLineTemplates(){
  LINE_SUM_TPL = document.getElementById('lineSumTpl').value;
  LINE_BRAND_TPL = document.getElementById('lineBrandTpl').value;
  LINE_BRAND_ROW_TPL = document.getElementById('lineBrandRowTpl').value;
  renderLINE();
  if(IS_API){
    try {
      await apiFetch(API_BASE+'/api/config/line_templates',{
        method:'PUT',
        body:JSON.stringify({value:JSON.stringify({sum:LINE_SUM_TPL,brand:LINE_BRAND_TPL,brandRow:LINE_BRAND_ROW_TPL})})
      });
      showToast('✅ บันทึก Template แล้ว!');
    } catch(e){ showToast('❌ บันทึกไม่ได้: '+e.message); }
  } else {
    localStorage.setItem('line_templates', JSON.stringify({sum:LINE_SUM_TPL,brand:LINE_BRAND_TPL,brandRow:LINE_BRAND_ROW_TPL}));
    showToast('✅ บันทึก Template แล้ว!');
  }
}

async function loadLineTemplates(){
  try {
    if(IS_API){
      const resp = await fetch(API_BASE+'/api/config/line_templates');
      const data = await resp.json();
      if(data.value){
        const t = JSON.parse(data.value);
        LINE_SUM_TPL = t.sum || DEFAULT_LINE_SUM_TPL;
        LINE_BRAND_TPL = t.brand || DEFAULT_LINE_BRAND_TPL;
        LINE_BRAND_ROW_TPL = t.brandRow || DEFAULT_LINE_BRAND_ROW_TPL;
      }
    } else {
      const saved = localStorage.getItem('line_templates');
      if(saved){
        const t = JSON.parse(saved);
        LINE_SUM_TPL = t.sum || DEFAULT_LINE_SUM_TPL;
        LINE_BRAND_TPL = t.brand || DEFAULT_LINE_BRAND_TPL;
        LINE_BRAND_ROW_TPL = t.brandRow || DEFAULT_LINE_BRAND_ROW_TPL;
      }
    }
  } catch(e){ console.warn('loadLineTemplates:', e); }
}

function resetLineTemplates(){
  LINE_SUM_TPL = DEFAULT_LINE_SUM_TPL;
  LINE_BRAND_TPL = DEFAULT_LINE_BRAND_TPL;
  LINE_BRAND_ROW_TPL = DEFAULT_LINE_BRAND_ROW_TPL;
  document.getElementById('lineSumTpl').value = LINE_SUM_TPL;
  document.getElementById('lineBrandTpl').value = LINE_BRAND_TPL;
  document.getElementById('lineBrandRowTpl').value = LINE_BRAND_ROW_TPL;
  renderLINE();
  showToast('🔄 คืนค่า Template เดิมแล้ว');
}

function renderLINE(){
  // populate brand dropdown
  const sel=document.getElementById('lineBrandSel');
  if(sel.options.length<=1){
    BRANDS.forEach(b=>{ const o=document.createElement('option'); o.value=b; o.text=b; sel.appendChild(o); });
  }

  const allRows=aggregateData();
  const byBrand=aggregateByBrand(allRows);
  const brandKeys=Object.keys(byBrand);
  const totalGMV=allRows.reduce((s,r)=>s+p(r.gmv),0);
  const totalNM=allRows.reduce((s,r)=>s+p(r.nm),0);
  const totalAds=brandKeys.reduce((s,b)=>s+byBrand[b].ads,0);
  const totalOrders=allRows.reduce((s,r)=>s+p(r.orders),0);
  const nmPct=totalGMV>0?totalNM/totalGMV*100:0;
  const roas=totalAds>0?totalGMV/totalAds:0;

  const today=new Date();
  const d=today.getDate(), m=today.getMonth();
  const thMonths=['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const dateLabel=\`\${d} \${thMonths[m+1]} \${today.getFullYear()+543}\`;
  const byPlat=aggregateByPlat(allRows);

  // Read from textarea if editor is open, otherwise use saved template
  const editorOpen = document.getElementById('lineEditorPanel')?.style.display !== 'none';
  const sumTpl = editorOpen ? (document.getElementById('lineSumTpl')?.value || LINE_SUM_TPL) : LINE_SUM_TPL;
  const brandTpl = editorOpen ? (document.getElementById('lineBrandTpl')?.value || LINE_BRAND_TPL) : LINE_BRAND_TPL;
  const brandRowTpl = editorOpen ? (document.getElementById('lineBrandRowTpl')?.value || LINE_BRAND_ROW_TPL) : LINE_BRAND_ROW_TPL;

  // Replace summary variables
  let sumText = sumTpl
    .replace(/{date}/g, dateLabel)
    .replace(/{gmv}/g, fmt(totalGMV))
    .replace(/{orders}/g, fmt(totalOrders))
    .replace(/{nm_pct}/g, nmPct.toFixed(1))
    .replace(/{nm_status}/g, nmPct>=NM_TARGET?'✅':'⚠️')
    .replace(/{ads}/g, fmt(totalAds))
    .replace(/{roas}/g, roas.toFixed(1))
    .replace(/{roas_status}/g, roas>=ROAS_TARGET?'✅':'⚠️')
    .replace(/{tt_gmv}/g, fmt(byPlat.tt.gmv))
    .replace(/{sp_gmv}/g, fmt(byPlat.sp.gmv))
    .replace(/{lz_gmv}/g, fmt(byPlat.lz.gmv))
    .replace(/{nm_target}/g, NM_TARGET)
    .replace(/{roas_target}/g, ROAS_TARGET);

  document.getElementById('lineSum').textContent = sumText;

  // Replace brand variables
  const brandRowsText = brandKeys.map(b=>{
    const d2=byBrand[b];
    const icon=d2.nm_pct>=NM_TARGET?'🟢':d2.nm_pct>=6?'🟡':'🔴';
    return brandRowTpl
      .replace(/{b_icon}/g, icon)
      .replace(/{b_name}/g, b)
      .replace(/{b_gmv}/g, fmt(d2.gmv))
      .replace(/{b_nm_pct}/g, d2.nm_pct.toFixed(1))
      .replace(/{b_orders}/g, fmt(d2.orders||0))
      .replace(/{b_roas}/g, (d2.ads>0?d2.gmv/d2.ads:0).toFixed(1))
      .replace(/{b_ads}/g, fmt(d2.ads||0));
  }).join('\\n');

  const warnings=brandKeys.filter(b=>byBrand[b].nm_pct<NM_TARGET);
  const warningsText = warnings.length
    ? '🚨 ต้องดูแลด่วน:\\n'+warnings.map(b=>\`⚠️ \${b} → NM \${byBrand[b].nm_pct.toFixed(1)}%\`).join('\\n')
    : '✅ ทุกแบรนด์ผ่านเป้า NM!';

  let brandText = brandTpl
    .replace(/{date}/g, dateLabel)
    .replace(/{brand_rows}/g, brandRowsText)
    .replace(/{warnings}/g, warningsText);

  document.getElementById('lineBrandMsg').textContent = brandText;
}`;

html = html.replace(oldRenderLINE, newRenderLINE);
console.log('✅ index.html: Replaced renderLINE with template-based version');

// ========================================
// PART 4: Add loadLineTemplates to initApp
// ========================================
html = html.replace(
  "setSaveStatus('ok','✅ โหลดข้อมูลจาก API แล้ว');",
  "setSaveStatus('ok','✅ โหลดข้อมูลจาก API แล้ว');\n      await loadLineTemplates();"
);
console.log('✅ index.html: Added loadLineTemplates to initApp');

fs.writeFileSync('index.html', html);
console.log('\n✅ All patches applied!');
