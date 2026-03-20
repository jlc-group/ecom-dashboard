# คู่มือทีมพัฒนา — ecom-dashboard (Tunnel + DB ให้ตรงกัน)

เอกสารนี้สำหรับทีมที่ clone repo นี้ไปพัฒนาต่อ โดยให้ **พอร์ตแอป**, **Cloudflare Tunnel**, และ **การต่อ PostgreSQL** สอดคล้องกันทุกเครื่อง

---

## 1. ดึงโค้ด

```bash
git clone https://github.com/jlc-group/ecom-dashboard.git
cd ecom-dashboard
git checkout main
git pull
```

---

## 2. ติดตั้ง dependencies

```bash
npm install
```

---

## 3. ฐานข้อมูล (PostgreSQL)

### 3.1 ตั้งค่า `DATABASE_URL`

```bash
cp .env.example .env
```

แก้ใน `.env`:

- `DATABASE_URL` — connection string ไปยัง PostgreSQL ที่เครื่องคุณ**เข้าถึงได้จริง** (localhost, IP ภายใน หรือ host ที่องค์กรเปิดให้)
- `DB_SSL=true` — ถ้า DB บังคับ SSL (เช่น cloud managed)

### 3.2 สร้าง schema (ครั้งแรก)

**แนะนำ (ตรงกับ `server.js` ปัจจุบัน — ตาราง `daily_*`, `brands.code`):**

```bash
# ตั้ง ADMIN_URL (postgres ที่มีสิทธิ์สร้าง DB) และชื่อ DB ถ้าต้องการ
npm run init-db
```

สคริปต์ `scripts/init-production-db.js` จะสร้าง database `ecom_dashboard` (ถ้ายังไม่มี) + ตารางทั้งหมด

ทางเลือกเดิม: `schema.sql` + `psql` (อาจไม่ตรงกับชื่อตารางใน `server.js` ถ้า repoยังมี schema เก่า)

---

## 4. รันแอป (ต้องตรงพอร์ตกับ Tunnel)

ค่าเริ่มต้นในโปรเจกต์นี้คือพอร์ต **8088**

ใน `.env`:

```env
PORT=8088
```

รัน dev:

```bash
npm run dev
```

ตรวจว่าเปิดได้: `http://localhost:8088`

> **สำคัญ:** ไฟล์ `config.yml` ของ Tunnel ชี้ไปที่ `http://localhost:8088` — ถ้าเปลี่ยน `PORT` ใน `.env` ต้องแก้ `ingress` ใน `config.yml` ให้ตรงกันทุกคน (หรือใช้ `config.example.yml` เป็นแม่แบบแล้วปรับเฉพาะเครื่อง)

---

## 5. Cloudflare Tunnel (ให้ทีมใช้แนวเดียวกัน)

Tunnel ใช้เพื่อให้เข้าแอปจากภายนอก (เช่น `*.wejlc.com`) โดย forward มาที่แอปบนเครื่อง dev

### 5.1 สิ่งที่ต้องมี

1. ติดตั้ง [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
2. ไฟล์ credential ของ tunnel (JSON) — ได้จาก **ผู้ดูแลระบบ / ทีม Infra** (ไม่ commit ขึ้น Git)
3. วางไฟล์ตาม path ใน `config.yml` เช่น  
   `%USERPROFILE%\.cloudflared\<tunnel-id>.json`

### 5.2 ให้ “ตรงกัน” ระหว่างทีม

| รายการ | ค่าที่ต้องสอดคล้องกัน |
|--------|------------------------|
| พอร์ตแอป | **8088** (หรือค่าที่ทีมตกลงร่วม + แก้ `config.yml` พร้อมกัน) |
| `ingress` ใน `config.yml` | `service: http://localhost:<PORT>` ต้องตรงกับ `PORT` ใน `.env` |
| เวอร์ชัน `cloudflared` | แนะนำใช้เวอร์ชันล่าสุดหรือเวอร์ชันที่ทีมกำหนด |

### 5.3 รัน Tunnel

Windows: ดับเบิลคลิก `cloudflare-tunnel.bat` หรือ:

```bash
cloudflared tunnel --config config.yml run <ชื่อ-tunnel-ตามที่ตั้งใน Cloudflare>
```

(ชื่อ tunnel ใน Dashboard ต้องตรงกับที่ใช้ในคำสั่ง — ดูจากทีม Infra)

### 5.4 เรื่องการ “เข้าถึง DB” กับ Tunnel

- **แอป (Node)** ต่อ DB ผ่าน **`DATABASE_URL` ใน `.env` เท่านั้น** — Tunnel ไม่ได้แทนที่ connection string
- Tunnel ใน repo นี้ชี้ไปที่ **HTTP แอป** (`localhost:8088`) ไม่ใช่ PostgreSQL โดยตรง
- ถ้า DB อยู่หลังเครือข่ายส่วนตัว: ทีมต้องได้สิทธิ์เข้าถึง (VPN, Zero Trust, หรือ bastion) ตามนโยบายองค์กร แล้วตั้ง `DATABASE_URL` ให้ถูกต้องบนเครื่องแต่ละคน

---

## 6. ไฟล์อ้างอิงใน repo

| ไฟล์ | หน้าที่ |
|------|---------|
| `.env.example` | ตัวอย่างตัวแปร — **ห้าม**ใส่ secret จริง |
| `config.example.yml` | แม่แบบ Tunnel (ปรับ hostname/credential ตามทีม) |
| `config.yml` | ค่าจริงของทีมหลัก (อาจต้องปรับ hostname ถ้าแยก tunnel ต่อคน) |
| `schema.sql` | โครงสร้างตาราง |

---

## 6.1 Google OAuth — สิ่งที่ตรงกับโค้ดจริง

- `server.js` ใช้ **`google-auth-library` ตรวจ `credential` (ID token)** จาก frontend เท่านั้น → บน server ต้องมีแค่ **`GOOGLE_CLIENT_ID`** ใน `.env`
- **ไม่มีการใช้ Client Secret** ในโค้ดปัจจุบัน — ไม่ต้อง (และไม่ควร) ใส่ `GOCSPX-...` ใน `.env` ของแอปนี้
- ผู้ใช้ Sign-in ด้วย Google ครั้งแรกจะมีแถวใน `employees` (สร้างอัตโนมัติ)
- **`AUTO_APPROVE_USERS=true`** ใน `.env` → อนุมัติทันทีหลัง login **ไม่ต้องรอ Admin** (เหมาะถ้า Admin ไม่สะดวกคอยกดอนุมัติ)
- **`AUTO_APPROVE_USERS=false`** (หรือไม่ตั้ง) → โหมดเดิม: สถานะ `pending` จนกว่า Admin จะกดอนุมัติในแท็บ **Config → จัดการสิทธิ์เข้าใช้งาน**
- ถ้า **Client Secret ถูกส่งต่อในที่สาธารณะ** (แชท, ticket) ให้ถือว่ารั่วแล้ว — ไป **Credentials → OAuth client → Reset secret** ใน Google Cloud

## 6.2 สรุปจากทีม dev vs โค้ดบน `main` (ควรรู้ก่อน deploy)

| หัวข้อ | สรุปทีม dev | โค้ดใน repo ปัจจุบัน |
|--------|-------------|----------------------|
| **Forecast / `forecast_gmv`** | บอกว่ามี CRUD ตาราง | `GET /api/forecast` ใน `server.js` เป็น **placeholder คืน `[]` อย่างเดียว** — ยังไม่ผูกตาราง `forecast_gmv`; `PUT /api/data` **ไม่ได้** บันทึก `forecastGMV` ลง PostgreSQL (มีแค่ brands, employees, tt/sp/lz, apmTasks, auditLog) |
| **Tunnel Postgres `localhost:15432`** | dev ใช้ cloudflared ไป `postgres-db.wejlc.com` | บน server จริงควรใช้ **`DATABASE_URL` ชี้ Postgres โดยตรง** ตามที่ dev แนะนำ — ถูกทางแล้ว |
| **Port แอป** | 8088 | ตรงกับ `server.js` และ `PORT-REGISTRY` |

ไฟล์ `check-schema.js` อ้างถึงตาราง `forecast_gmv`, `employee_permissions` — อาจเป็นสคีมาที่วางแผนไว้หรือบน DB ของ dev แต่ **init script มาตรฐานใน repo (`scripts/init-production-db.js`) ยังไม่สร้างสองตารางนี้** ถ้าต้องใช้ต้องให้ dev ส่ง DDL หรือ sync จาก DB จริง

## 7. Checklist ก่อนเริ่มงาน

- [ ] `npm install` สำเร็จ
- [ ] มี `.env` และ `DATABASE_URL` ทดสอบต่อ DB ได้
- [ ] รัน `npm run dev` แล้ว `localhost:8088` ตอบได้
- [ ] มี credential Cloudflare Tunnel และ `config.yml` สอดคล้องกับพอร์ตแอป
- [ ] (ถ้าใช้ Google OAuth) ตั้ง `GOOGLE_CLIENT_ID` และ `JWT_SECRET` ใน `.env`

---

*อัปเดตตาม repo — พอร์ตมาตรฐานปัจจุบัน: **8088***
