# ecom-dashboard
ECOM TEAM Dashboard - E-commerce data management

## 🚀 Quick Start

### Development (Local)

```bash
npm install
npm run dev
```

ค่าเริ่มต้นรันที่พอร์ต **8080** (กำหนดได้ด้วย `PORT` ใน `.env`)

### Production บนเครื่อง (เหมือน PDDocument)

- ซิงค์จาก DEV → `D:\AI_WORKSPACE\Production\ecom-dashboard` ผ่าน **We-Platform** (`deploy.ps1` + webhook)
- PM2: **`ecom-dashboard-prod`** — `node server.js` (แนะนำ `PORT=8080` ใน env ของ PM2 ถ้าต้องการให้ตรงกับ tunnel)

### Tunnel / Cloudflare (ถ้าใช้)

ไฟล์ `config.yml`, `cloudflare-tunnel.bat`, `wrangler.toml` ใช้สำหรับ tunnel หรือ Pages แยกต่างหาก

## 📁 Project Structure

```
ecom-dashboard/
├── index.html          # Main HTML file
├── server.js           # Express API + static
├── schema.sql          # DB schema
├── config.yml          # Cloudflare Tunnel (optional)
├── wrangler.toml       # Cloudflare Pages (optional)
├── cloudflare-tunnel.bat
└── package.json
```

## 🔧 Configuration Files

### Cloudflare Tunnel (`config.yml`)
- Tunnel ID: `4d48b950-0a4b-4382-8698-6acc6735c9ff`
- Domain: `ecom-dashboard.wejlc.com`
- Local: `localhost:8080`

### Cloudflare Pages (`wrangler.toml`)
- Project: `ecom-dashboard`
- Build output: Current directory (static HTML)
