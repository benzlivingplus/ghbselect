# THE LIVING PLUS — ประเมินวงเงินกู้ ธอส. (คู่มือติดตั้ง)

## ไฟล์ในชุดนี้

| ไฟล์ | ใช้ทำอะไร | ไปไว้ที่ไหน |
|---|---|---|
| `index.html` | หน้าเว็บทั้งหมด (แชทคำนวณ + หน้าล็อกอิน) คำนวณในเบราว์เซอร์แบบเรียลไทม์ | GitHub Pages |
| `worker.js` | ตัวกลางให้ AI อ่านสลิป/เครดิตบูโร (ไม่บังคับ) | Cloudflare Workers |

ไม่ต้องใช้ฐานข้อมูล (ไม่ใช้ Firestore) ใช้ Firebase เฉพาะส่วน **Authentication** เพื่อเก็บชื่อผู้ใช้/รหัสผ่านและตรวจสอบตอนล็อกอิน

---

## 1) GitHub Pages

1. สร้าง repo แล้วอัปโหลด `index.html` ไว้ที่ราก (root)
2. Settings → Pages → Branch: `main` / `/ (root)` → Save
3. รอสักครู่ จะได้ลิงก์ `https://<ชื่อ>.github.io/<repo>/`

## 2) Firebase — ระบบล็อกอิน

1. เข้า console.firebase.google.com → **Add project** (ปิด Google Analytics ได้)
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**
3. **Authentication → Users → Add user**
   - อีเมล: `ชื่อผู้ใช้@thelivingplus.com` เช่น `somchai@thelivingplus.com`
   - รหัสผ่าน: ตั้งตามต้องการ
   - ตอนล็อกอิน ผู้ใช้พิมพ์แค่ `somchai` กับรหัสผ่าน (ระบบต่อ `@thelivingplus.com` ให้เอง)
   - เปลี่ยนโดเมนได้ที่ `CONFIG.LOGIN_DOMAIN` ใน `index.html`
   - ถ้าใช้อีเมลจริง ให้ผู้ใช้พิมพ์อีเมลเต็มตอนล็อกอิน และรีเซ็ตรหัสทางอีเมลได้
4. **Project settings (รูปฟันเฟือง) → General → Your apps → เพิ่ม Web app (`</>`)** แล้วคัดลอกค่า `firebaseConfig` ไปใส่ใน `index.html`:
   ```js
   FIREBASE: { apiKey:'...', authDomain:'...', projectId:'...', appId:'...' },
   ```
   ถ้า `apiKey` ว่าง ระบบล็อกอินจะปิด และใครเปิดหน้าเว็บก็ใช้ได้
5. **Authentication → Settings → Authorized domains** → เพิ่มโดเมนที่ใช้จริง เช่น `benzlivingplus.github.io`
6. ป้องกันคนสมัครเอง: ในหน้า Authentication → Settings ให้หาตัวเลือกปิดการสมัครสมาชิกเอง (User actions) แล้วปิดไว้ ให้มีแค่คุณที่เพิ่มผู้ใช้ได้ (ชื่อเมนูอาจต่างไปตามเวอร์ชัน ตรวจในคอนโซลอีกครั้ง)
7. แนะนำ: Google Cloud Console → APIs & Services → Credentials → จำกัด API key ให้ใช้ได้เฉพาะโดเมนของคุณ (HTTP referrers)

**จัดการผู้ใช้** อยู่ที่ Authentication → Users: เพิ่ม / ปิดใช้งาน (Disable) / ลบ ได้เลย
ถ้าลืมรหัสและใช้อีเมลสมมุติ (`@thelivingplus.com`) ให้ลบบัญชีแล้วสร้างใหม่ด้วยรหัสใหม่

## 3) Cloudflare Worker — อ่านสลิป/เครดิตบูโร (ไม่บังคับ)

1. Cloudflare Dashboard → Workers & Pages → Create → Hello World → วางโค้ดจาก `worker.js` → Deploy
2. Settings → Variables and Secrets

   | ชื่อ | ชนิด | ค่า |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Secret | key จาก console.anthropic.com |
   | `ALLOWED_ORIGIN` | Text | `https://benzlivingplus.github.io` (โดเมนที่โฮสต์หน้าเว็บ ไม่มี `/` ท้าย) |
   | `FIREBASE_PROJECT_ID` | Text | Project ID ของ Firebase (ตัวเดียวกับข้อ 2) |
   | `ALLOWED_USERS` | Text (ไม่บังคับ) | อีเมลที่อนุญาต คั่นด้วย `,` ถ้าไม่ตั้ง ทุกบัญชีใน Firebase ใช้ได้ |
   | `MODEL` | Text (ไม่บังคับ) | ค่าเริ่มต้น `claude-sonnet-5-5` |

3. คัดลอก URL ของ Worker ไปใส่ `CONFIG.AI_ENDPOINT` ใน `index.html`

เมื่อตั้ง `FIREBASE_PROJECT_ID` แล้ว Worker จะรับเฉพาะคำขอที่ล็อกอินแล้วเท่านั้น คนนอกจะใช้เครดิต AI ของคุณไม่ได้

## ข้อควรรู้ด้านความปลอดภัย

- หน้าเว็บบน GitHub Pages เป็นสาธารณะ สูตรคำนวณอยู่ในโค้ดฝั่งเบราว์เซอร์ ผู้ที่มีความรู้เปิดดูโค้ดได้ ระบบล็อกอินคุมทางเข้าปกติและคุมการใช้ AI (ฝั่ง Worker) ได้จริง แต่ไม่ได้ซ่อนสูตร ถ้าต้องการซ่อนสูตรจริง ต้องย้ายการคำนวณไปไว้ใน Worker
- ค่า `firebaseConfig` ไม่ใช่ความลับ (ออกแบบมาให้อยู่ในหน้าเว็บ) ส่วน `ANTHROPIC_API_KEY` ห้ามใส่ในหน้าเว็บเด็ดขาด ให้อยู่ใน Worker เท่านั้น
- สลิปและเครดิตบูโรเป็นข้อมูลส่วนบุคคล ควรมีข้อความขอความยินยอมตาม PDPA ก่อนให้ลูกค้าอัปโหลด
