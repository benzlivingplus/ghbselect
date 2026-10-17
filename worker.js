/**
 * THE LIVING PLUS — ตัวกลางอ่านสลิป/เครดิตบูโร (Cloudflare Worker)
 *
 * ทำไมต้องมี: ห้ามใส่ API key ไว้ในหน้าเว็บ (ใครเปิด Inspect ก็เห็น)
 * หน้าแชทจะส่งไฟล์มาที่ Worker นี้ แล้ว Worker เป็นคนเรียก Claude API ด้วย key ที่เก็บเป็นความลับ
 * คำสั่ง (prompt) อยู่ที่ฝั่งนี้ทั้งหมด หน้าเว็บแก้คำสั่งไม่ได้
 *
 * วิธีติดตั้ง
 * 1) Cloudflare Dashboard → Workers & Pages → Create → Hello World → วางโค้ดไฟล์นี้ → Deploy
 * 2) Settings → Variables and Secrets
 *      ANTHROPIC_API_KEY  (Secret)  = key จาก console.anthropic.com
 *      ALLOWED_ORIGIN     (Text)    = https://benzlivingplus.github.io   (โดเมนที่โฮสต์หน้าแชท)
 *      MODEL              (Text, ไม่บังคับ) = claude-sonnet-5-5
 *      FIREBASE_PROJECT_ID (Text, แนะนำ) = Project ID ของ Firebase ที่ใช้ล็อกอิน
 *                          ตั้งค่านี้แล้ว Worker จะรับเฉพาะคำขอจากผู้ที่ล็อกอินแล้วเท่านั้น (กันคนนอกใช้เครดิต AI)
 *      ALLOWED_USERS      (Text, ไม่บังคับ) = รายชื่ออีเมลที่อนุญาต คั่นด้วยจุลภาค เช่น somchai@thelivingplus.com,benz@thelivingplus.com
 *                          ถ้าไม่ตั้ง = ทุกบัญชีใน Firebase ใช้ได้
 * 3) คัดลอก URL ของ Worker ไปใส่ CONFIG.AI_ENDPOINT ในไฟล์ index.html
 *
 * ไม่มีการบันทึกไฟล์หรือข้อมูลลูกค้าใน Worker นี้ (ไม่ใช้ KV/R2/D1 และไม่ log เนื้อหา)
 */

const LIMITS = {
  payslips: { maxFiles: 12 },
  bureau:   { maxFiles: 6 },
};
const MAX_BODY_BYTES = 28 * 1024 * 1024; // Claude API รับ request ได้ไม่เกิน 32 MB

const PROMPTS = {
  payslips: `คุณคือผู้ช่วยอ่านสลิปเงินเดือนของไทย รูป/ไฟล์ที่แนบมาคือสลิปเงินเดือนย้อนหลังหลายเดือน
สรุป "แต่ละเดือน" เป็นตัวเลขบาท (ไม่ใส่ลูกน้ำ) ถ้าไม่มีรายการนั้นให้ใส่ 0

ฟิลด์ต่อเดือน:
- period: "YYYY-MM" เป็นปี ค.ศ. (ถ้าสลิปเป็น พ.ศ. ให้ลบ 543)
- base_salary: เงินเดือนฐาน
- overtime: โอที / ค่าล่วงเวลา
- commission: ค่าคอมมิชชั่น / คอมมิชชัน / อินเซนทีฟ / โบนัสขาย
- shift_allowance: ค่ากะ
- position_allowance: ค่าตำแหน่ง
- professional_allowance: ค่าวิชาชีพ
- total_deductions: ยอดรวมรายการหักทั้งหมดในสลิปของเดือนนั้น "ทุกรายการ" ไม่ว่าจะเป็นอะไร
  เช่น ประกันสังคม ภาษี กองทุนสำรองเลี้ยงชีพ เบี้ยประกัน เงินกู้สหกรณ์ กยศ. ผ่อนชำระสินเชื่อ ผ่อนรถ
  ถ้าสลิปมีช่อง "รวมรายการหัก/รวมเงินหัก" ให้ใช้ค่านั้น ถ้าไม่มีให้บวกทุกรายการหักเอง

กติกา:
- ห้ามรวม ค่าที่พัก ค่าเดินทาง ค่าอาหาร ค่าโทรศัพท์ หรือเงินช่วยเหลืออื่นที่ไม่อยู่ในฟิลด์ข้างต้น
- ถ้าเดือนเดียวกันมีหลายรูป (หน้า-หลัง) ให้รวมเป็นเดือนเดียว
- อ่านไม่ออกหรือไม่แน่ใจให้ใส่ 0 และอธิบายใน notes
- ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น ไม่มี markdown

รูปแบบ:
{"months":[{"period":"2026-09","base_salary":0,"overtime":0,"commission":0,"shift_allowance":0,"position_allowance":0,"professional_allowance":0,"total_deductions":0}],"notes":""}`,

  bureau: `คุณคือผู้ช่วยอ่านรายงานเครดิตบูโร (NCB) ของไทย ไฟล์/รูปที่แนบมาคือรายงานของผู้กู้หนึ่งคน
ดึงเฉพาะ "บัญชีที่ยังเปิดอยู่และยังมีภาระ" (ไม่เอาบัญชีที่ปิดแล้ว/ชำระครบแล้ว)

ต่อบัญชี:
- creditor: ชื่อสถาบันการเงิน/ผู้ให้สินเชื่อ
- account_type: ประเภท เช่น บัตรเครดิต สินเชื่อส่วนบุคคล เช่าซื้อรถ สินเชื่อบ้าน
- monthly_installment: ยอดผ่อนชำระต่อเดือนตามที่ระบุในรายงาน (ตัวเลข) ถ้าไม่ระบุให้ใส่ null
- outstanding_balance: ยอดเงินต้นคงเหลือ/ยอดหนี้คงเหลือ (ตัวเลข) ถ้าไม่ระบุให้ใส่ null

กติกา:
- ตัวเลขเป็นบาท ไม่ใส่ลูกน้ำ
- ห้ามคำนวณหรือเดายอดผ่อนเอง ถ้ารายงานไม่ระบุให้ใส่ null
- ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น ไม่มี markdown

รูปแบบ:
{"accounts":[{"creditor":"","account_type":"","monthly_installment":null,"outstanding_balance":null}],"notes":""}`,
};

/* ---------- ตรวจ Firebase ID token (RS256) ---------- */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, at: 0 };

async function getJwks(force) {
  const now = Date.now();
  if (!force && jwksCache.keys && now - jwksCache.at < 3600 * 1000) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('jwks');
  const j = await r.json();
  jwksCache = { keys: j.keys || [], at: now };
  return jwksCache.keys;
}
function b64uBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function verifyFirebaseToken(token, projectId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64uBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64uBytes(parts[1])));
  } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) return null;
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) return null;
  if (!payload.sub || typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 300) return null;

  let jwk = (await getJwks(false)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await getJwks(true)).find(k => k.kid === header.kid); // กุญแจอาจเพิ่งหมุนเวียน
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return ok ? payload : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    const corsOrigin = allowed === '*' ? '*' : (origin === allowed ? origin : '');
    const cors = {
      'Access-Control-Allow-Origin': corsOrigin || 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
    if (!corsOrigin) return json({ ok: false, error: 'origin not allowed' }, 403);
    if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: 'server not configured' }, 500);

    // ต้องล็อกอินก่อน (เมื่อตั้ง FIREBASE_PROJECT_ID)
    if (env.FIREBASE_PROJECT_ID) {
      const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
      let claims = null;
      try { claims = m ? await verifyFirebaseToken(m[1], env.FIREBASE_PROJECT_ID) : null; } catch { claims = null; }
      if (!claims) return json({ ok: false, error: 'unauthorized' }, 401);
      if (env.ALLOWED_USERS) {
        const allow = env.ALLOWED_USERS.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        if (!allow.includes(String(claims.email || '').toLowerCase())) return json({ ok: false, error: 'forbidden' }, 403);
      }
    }

    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY_BYTES) return json({ ok: false, error: 'ไฟล์รวมกันใหญ่เกินไป ลองลดจำนวนไฟล์' }, 413);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }

    const task = body && body.task;
    const files = body && body.files;
    if (!LIMITS[task]) return json({ ok: false, error: 'unknown task' }, 400);
    if (!Array.isArray(files) || files.length === 0 || files.length > LIMITS[task].maxFiles)
      return json({ ok: false, error: 'จำนวนไฟล์ไม่ถูกต้อง' }, 400);

    const content = [];
    for (const f of files) {
      if (!f || typeof f.data !== 'string') return json({ ok: false, error: 'bad file' }, 400);
      if (f.type === 'pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
      } else if (f.type === 'image' && ['image/jpeg', 'image/png', 'image/webp'].includes(f.media_type)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
      } else {
        return json({ ok: false, error: 'รองรับเฉพาะรูปภาพและ PDF' }, 400);
      }
    }
    content.push({ type: 'text', text: PROMPTS[task] });

    let apiRes;
    try {
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          ...(env.WORKSPACE_ID ? { 'anthropic-workspace-id': env.WORKSPACE_ID } : {}),
        },
        body: JSON.stringify({
          model: env.MODEL || 'claude-sonnet-5-5',
          max_tokens: 4096,
          messages: [{ role: 'user', content }],
        }),
      });
    } catch {
      return json({ ok: false, error: 'เชื่อมต่อระบบอ่านเอกสารไม่ได้' }, 502);
    }
    if (!apiRes.ok) {
      let detail = '';
      try { const ej = await apiRes.json(); detail = String((ej.error && (ej.error.type + ': ' + ej.error.message)) || '').slice(0, 300); } catch {}
      return json({ ok: false, error: 'อ่านเอกสารไม่สำเร็จ (' + apiRes.status + ') ' + detail }, 502);
    }

    const out = await apiRes.json();
    const text = (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let data;
    try { data = JSON.parse(cleaned); } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
    }
    if (!data) return json({ ok: false, error: 'อ่านผลลัพธ์ไม่ได้ ลองใหม่อีกครั้ง' }, 502);
    return json({ ok: true, data });
  },
};
