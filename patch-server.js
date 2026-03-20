const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// 1. Add TABLE_MAP if not present
if (!c.includes('TABLE_MAP')) {
  c = c.replace(
    'const PLAT_COLS',
    "// Table name mapping\nconst TABLE_MAP = { tt: 'daily_tiktok', sp: 'daily_shopee', lz: 'daily_lazada' };\n\nconst PLAT_COLS"
  );
}

// 2. Replace platform_ table references
c = c.replace(/const table = `platform_\$\{plat\}`;/g, 'const table = TABLE_MAP[plat];');
c = c.replace(/platform_tt/g, 'daily_tiktok');
c = c.replace(/platform_sp/g, 'daily_shopee');
c = c.replace(/platform_lz/g, 'daily_lazada');

// 3. Update PLAT_COLS to include total_exp, nm, nm_pct, roas (if not already)
if (!c.includes("'total_exp'")) {
  c = c.replace(
    "'cost_gmv_ads','cost_gmv_live']",
    "'cost_gmv_ads','cost_gmv_live','total_exp','nm','nm_pct','roas']"
  );
  c = c.replace(
    "'search_ads','shop_ads','product_ads']",
    "'search_ads','shop_ads','product_ads','total_exp','nm','nm_pct','roas']"
  );
  c = c.replace(
    "'lzsd','lz_gmv_max','aff_lz']",
    "'lzsd','lz_gmv_max','aff_lz','total_exp','nm','nm_pct','roas']"
  );
}

fs.writeFileSync('server.js', c);
console.log('✅ Patched! TABLE_MAP + columns updated');
