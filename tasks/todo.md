# Todo

สถานะ: รอผู้ใช้ยืนยันแผนก่อนดำเนินการต่อ

- [x] อ่านไฟล์ที่เกี่ยวข้องกับสิทธิ์ของ `admin` และการอนุมัติผู้ใช้เบื้องต้น
- [ ] สรุปโครงสร้างสิทธิ์ปัจจุบันว่าใช้ field/config อะไรบ้าง เช่น `is_admin`, `status`, `visible_tabs`, `editable_tabs`
- [ ] ตรวจสอบช่องทางที่ใช้ตั้งค่า `admin` ในระบบตอนนี้ ทั้งจาก script, API, และหน้าจอจัดการผู้ใช้
- [ ] ตรวจสอบว่า backend บังคับสิทธิ์ `admin` จริงหรืออาศัยแค่การซ่อนหน้า UI
- [ ] สรุปผลให้ผู้ใช้แบบ high-level ว่าตอนนี้ `admin` ทำอะไรได้บ้าง และมีจุดเสี่ยงอะไรบ้าง
- [ ] Review: สรุปสิ่งที่ตรวจพบและสิ่งที่เปลี่ยนแปลงหลังจบงาน

## Deploy Issue: Missing `build` Script

- [x] ตรวจสาเหตุ error deploy ว่า `npm run build` หา script `build` ไม่เจอใน `package.json`
- [x] เลือกแนวทางแก้ที่เล็กที่สุดระหว่างเพิ่ม script `build` หรือปรับค่า build command ในระบบ deploy
- [x] ถ้าผู้ใช้ยืนยันให้แก้ใน repo: เพิ่ม script ที่เข้ากับ flow ปัจจุบันมากที่สุดโดยกระทบโค้ดให้น้อยที่สุด
- [x] ทดสอบคำสั่ง build ที่เกี่ยวข้องในเครื่อง
- [x] Review: สรุปสาเหตุ ปรับอะไรไป และสิ่งที่ควรตั้งค่าเพิ่มในระบบ deploy

### Review

- สาเหตุหลักคือ We-Platform เรียก `npm run build` แต่ใน repo เดิมไม่มี script `build`
- ระหว่างแก้พบเพิ่มว่า script `deploy` เดิมใช้ `cp` ซึ่งใช้ไม่ได้ใน environment Windows ของเครื่องนี้
- ได้เพิ่ม `build` ให้เรียก flow เดิมผ่าน `deploy`
- ได้เปลี่ยน `deploy` ให้ใช้ `node scripts/copy-build-output.js` แทน `cp` เพื่อให้ copy `dist/index.html` และ `dist/assets` กลับมาที่ root ได้บน Windows
- ทดสอบแล้ว `npm run build` ผ่านสำเร็จ
- ถ้า We-Platform มีช่องกำหนด Build Command แนะนำใช้ `npm run build`
- จากการตรวจ repo ไม่พบ `.github/workflows` ดังนั้น auto deploy ปัจจุบันน่าจะเกิดจาก We-Platform รับ webhook หลัง `push` แล้วค่อยดึงโค้ดไป deploy เอง
