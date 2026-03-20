# ecom-dashboard
ECOM TEAM Dashboard - E-commerce data management

## 🚀 Quick Start

### Development (Local)

```bash
npm install
npm run dev
```

ค่าเริ่มต้นรันที่พอร์ต **8088** — กำหนดได้ด้วย `PORT` ใน `.env` — ดู `tasks/PORT-REGISTRY.md`

### Production บนเครื่อง (เหมือน PDDocument)

- ซิงค์จาก DEV → `D:\AI_WORKSPACE\Production\ecom-dashboard` ผ่าน **We-Platform** (`deploy.ps1` + webhook)
- PM2: **`ecom-dashboard-prod`** — `node server.js` — แนะนำ `PORT=8088` ให้ตรงกับ tunnel (`config.yml`)

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
- Local: `localhost:8088` (ต้องตรงกับ `PORT` ของ `server.js`)

### Cloudflare Pages (`wrangler.toml`)
- ใช้เฉพาะกรณี deploy static แยก — production หลักผ่าน PM2 + tunnel ไปที่พอร์ตด้านบน
