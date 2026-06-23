/**
 * 서울퍼스트내과 — 텔레그램 거래명세서 수신 함수
 *
 * 직원이 텔레그램 봇에게 명세서 사진을 보내면:
 *  1) 텔레그램에서 사진 다운로드
 *  2) Firebase Storage에 저장
 *  3) Claude(Opus)로 업체·품목(품명/수량/단가/금액)·합계 자동 추출
 *  4) Firestore invoices 컬렉션에 저장
 * → 관리 페이지(admin-invoices.html)에 실시간으로 나타남. PC를 켜둘 필요 없음.
 */
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp({ storageBucket: "seoulfirst-ba9d4.firebasestorage.app" });

const TELEGRAM_TOKEN = defineSecret("TELEGRAM_TOKEN");
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");
const LUNCH_TELEGRAM_TOKEN = defineSecret("LUNCH_TELEGRAM_TOKEN");
const SOLAPI_API_KEY = defineSecret("SOLAPI_API_KEY");
const SOLAPI_API_SECRET = defineSecret("SOLAPI_API_SECRET");

const PROMPT = `이 이미지는 거래명세서 또는 세금계산서입니다. 표에 적힌 품목들을 정확히 읽어 JSON으로만 답하세요. 설명·코드블록 없이 순수 JSON만 출력합니다.
{
  "date": "거래일자 YYYY-MM-DD, 없으면 빈 문자열",
  "vendor": "공급자(판매처) 상호명",
  "items": [
    { "name": "품명(규격 포함, 표기 그대로)", "qty": 수량숫자, "unitPrice": 단가숫자, "amount": 공급가액 또는 금액숫자 }
  ],
  "totalAmount": 합계금액숫자(총액, 부가세 포함 최종 청구금액)
}
규칙: 숫자는 콤마·원 없이 숫자만. 칸이 비었으면 0. 품목은 표에 있는 행 순서대로 모두 포함. 품명을 임의로 바꾸거나 요약하지 말 것.`;

function num(v) {
  const x = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(x) ? 0 : x;
}

async function parseWithClaude(apiKey, b64, mediaType) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json();
  const txt = (j.content && j.content[0] && j.content[0].text) || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("파싱 결과 해석 불가");
  const p = JSON.parse(m[0]);
  const items = Array.isArray(p.items) ? p.items.map((it) => ({
    name: String(it.name || "").trim(),
    qty: num(it.qty), unitPrice: num(it.unitPrice), amount: num(it.amount),
  })) : [];
  return {
    date: p.date || "", vendor: String(p.vendor || "").trim(),
    items, totalAmount: num(p.totalAmount),
  };
}

exports.telegramWebhook = onRequest(
  { secrets: [TELEGRAM_TOKEN, ANTHROPIC_KEY, WEBHOOK_SECRET], region: "asia-northeast3" },
  async (req, res) => {
    // 텔레그램이 보낸 요청인지 비밀 토큰으로 확인
    const expected = WEBHOOK_SECRET.value();
    if (expected && req.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
      res.status(401).send("unauthorized");
      return;
    }
    try {
      const update = req.body || {};
      const msg = update.message || update.channel_post;
      if (!msg) { res.status(200).send("ok"); return; }

      let fileId = null;
      let fname = `tg_${Date.now()}.jpg`;
      if (msg.photo && msg.photo.length) {
        fileId = msg.photo[msg.photo.length - 1].file_id; // 가장 큰 해상도
      } else if (msg.document && (msg.document.mime_type || "").startsWith("image/")) {
        fileId = msg.document.file_id;
        fname = msg.document.file_name || fname;
      }
      if (!fileId) { res.status(200).send("ok"); return; }

      const token = TELEGRAM_TOKEN.value();

      // 1) 텔레그램에서 사진 다운로드
      const gf = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
      if (!gf.ok) throw new Error("getFile 실패");
      const filePath = gf.result.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const buf = Buffer.from(await fr.arrayBuffer());
      // Claude는 image/jpeg|png|gif|webp만 허용 → 헤더가 부정확하면 확장자로 보정
      let contentType = fr.headers.get("content-type") || "";
      if (!/^image\/(jpeg|png|gif|webp)$/.test(contentType)) {
        const ext = (filePath.split(".").pop() || "").toLowerCase();
        contentType = ext === "png" ? "image/png"
          : ext === "webp" ? "image/webp"
          : ext === "gif" ? "image/gif"
          : "image/jpeg";
      }

      // 2) Storage 저장
      const db = admin.firestore();
      const id = db.collection("invoices").doc().id;
      const spath = `invoices/${id}_${fname}`;
      const dlToken = crypto.randomUUID();
      const bucket = admin.storage().bucket();
      await bucket.file(spath).save(buf, {
        metadata: { contentType, metadata: { firebaseStorageDownloadTokens: dlToken } },
      });
      const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(spath)}?alt=media&token=${dlToken}`;

      // 3) Claude 파싱 (실패해도 사진은 등록)
      const base = {
        date: new Date().toISOString().slice(0, 10),
        vendor: "", items: [], totalAmount: "",
        memo: msg.caption || "", imageUrl, imagePath: spath,
        source: "telegram",
        tgFrom: (msg.from && (msg.from.first_name || msg.from.username)) || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      let okParse = false;
      try {
        const p = await parseWithClaude(ANTHROPIC_KEY.value(), buf.toString("base64"), contentType);
        base.date = p.date || base.date;
        base.vendor = p.vendor;
        base.items = p.items;
        base.totalAmount = p.totalAmount;
        base.source = "parsed";
        base.tgFrom = (msg.from && (msg.from.first_name || msg.from.username)) || "";
        base.parsedAt = admin.firestore.FieldValue.serverTimestamp();
        okParse = true;
      } catch (e) {
        console.error("claude parse error", e);
      }

      // 4) Firestore 저장
      await db.collection("invoices").doc(id).set(base);

      // 5) 보낸 사람에게 확인 메시지
      try {
        const reply = okParse
          ? `✅ 명세서 등록 완료\n업체: ${base.vendor || "(인식 실패)"}\n합계: ${base.totalAmount ? base.totalAmount.toLocaleString("ko-KR") + "원" : "-"}\n품목 ${base.items.length}건`
          : "✅ 사진을 받았습니다. (자동 인식은 실패했어요 — 관리 페이지에서 확인해 주세요)";
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: msg.chat.id, text: reply }),
        });
      } catch (_) { /* 무시 */ }

      res.status(200).send("ok");
    } catch (err) {
      console.error("webhook error", err);
      res.status(200).send("ok"); // 200으로 응답해 텔레그램 재시도 폭주 방지
    }
  }
);

// ───────────────────────────────────────────────────────────
// Claude 프록시 (브라우저에 API 키 노출 방지)
//  - 검진·거래명세서·점심영수증 페이지가 직접 api.anthropic.com을 호출하지 않고
//    이 함수를 통해 요청 → API 키는 서버(Secret Manager)에만 존재.
//  - 로그인 + (관리자 또는 checkup/invoice/lunch 권한) 확인 후에만 호출 허용.
// ───────────────────────────────────────────────────────────
const SUPER_ADMINS = ["dodezi82@gmail.com", "seoulfirst2023@gmail.com"];
const ALLOWED_MODELS = ["claude-opus-4-8", "claude-haiku-4-5", "claude-sonnet-4-6"];

exports.claudeProxy = onCall(
  { secrets: [ANTHROPIC_KEY], region: "asia-northeast3", memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const email = (auth.token && auth.token.email || "").toLowerCase();

    let allowed = SUPER_ADMINS.includes(email);
    if (!allowed && email) {
      const snap = await admin.firestore().collection("users").doc(email).get();
      const u = snap.exists ? snap.data() : null;
      const perms = (u && u.perms) || {};
      allowed = !!(u && u.active !== false && (perms.checkup || perms.invoice || perms.lunch));
    }
    if (!allowed) throw new HttpsError("permission-denied", "AI 사용 권한이 없습니다.");

    const data = request.data || {};
    const model = ALLOWED_MODELS.includes(data.model) ? data.model : "claude-haiku-4-5";
    const maxTokens = Math.min(Math.max(parseInt(data.max_tokens, 10) || 1024, 1), 4096);
    if (!Array.isArray(data.messages) || !data.messages.length) {
      throw new HttpsError("invalid-argument", "messages가 필요합니다.");
    }

    const body = { model, max_tokens: maxTokens, messages: data.messages };
    if (data.system) body.system = String(data.system);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY.value(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || `anthropic ${r.status}`;
      throw new HttpsError("internal", m);
    }
    return j; // { content: [{ text }], ... } — 클라이언트는 기존과 동일하게 content[0].text 사용
  }
);

// ───────────────────────────────────────────────────────────
// 카카오 알림톡 발송 (솔라피) — 검진 안내·안부 CRM
//  - 로그인 + (관리자/crm/booking 권한) 확인 후 발송.
//  - 발신프로필 키·템플릿 ID·발신번호는 Firestore crm_config/solapi(관리자 전용)에서 읽음.
//  - 솔라피 API 키/시크릿은 Secret Manager에만 존재.
// ───────────────────────────────────────────────────────────
function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

exports.sendKakao = onCall(
  { secrets: [SOLAPI_API_KEY, SOLAPI_API_SECRET], region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const email = (auth.token && auth.token.email || "").toLowerCase();

    let allowed = SUPER_ADMINS.includes(email);
    if (!allowed && email) {
      const snap = await admin.firestore().collection("users").doc(email).get();
      const u = snap.exists ? snap.data() : null;
      const perms = (u && u.perms) || {};
      allowed = !!(u && u.active !== false && (perms.crm || perms.booking));
    }
    if (!allowed) throw new HttpsError("permission-denied", "발송 권한이 없습니다.");

    const data = request.data || {};
    const to = String(data.to || "").replace(/[^0-9]/g, "");
    const templateKey = String(data.templateKey || "");
    const variables = (data.variables && typeof data.variables === "object") ? data.variables : {};
    if (!to) throw new HttpsError("invalid-argument", "수신 번호가 없습니다.");

    const cfgSnap = await admin.firestore().collection("crm_config").doc("solapi").get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : null;
    if (!cfg || !cfg.pfId || !cfg.templates || !cfg.templates[templateKey]) {
      throw new HttpsError("failed-precondition", "발송 설정(pfId/템플릿)이 아직 준비되지 않았습니다.");
    }

    const kakaoOptions = {
      pfId: cfg.pfId,
      templateId: cfg.templates[templateKey],
      variables,
      // 발신번호가 등록돼 있으면 실패 시 문자 대체발송 허용, 없으면 비활성화
      disableSms: cfg.from ? false : true,
    };
    const message = { to, kakaoOptions };
    if (cfg.from) message.from = String(cfg.from).replace(/[^0-9]/g, "");

    const r = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: solapiAuthHeader(SOLAPI_API_KEY.value(), SOLAPI_API_SECRET.value()),
      },
      body: JSON.stringify({ message }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("solapi http error", r.status, JSON.stringify(j).slice(0, 600));
      throw new HttpsError("internal", j.errorMessage || j.message || `solapi ${r.status}`);
    }
    // 솔라피는 HTTP 200이어도 메시지 단위로 실패할 수 있음 (statusCode 2000 = 성공 접수)
    if (j.statusCode && j.statusCode !== "2000") {
      console.error("solapi msg fail", JSON.stringify(j).slice(0, 600));
      throw new HttpsError("internal", `${j.statusMessage || "발송 실패"} (${j.statusCode})`);
    }
    console.log("solapi ok", JSON.stringify(j).slice(0, 300));
    return j;
  }
);

// ───────────────────────────────────────────────────────────
// 점심 영수증 수신 함수 (별도 봇)
// ───────────────────────────────────────────────────────────
const LUNCH_PROMPT = `이 이미지는 음식점 결제 영수증(신용카드 매출전표/간이영수증)입니다. 보이는 항목을 최대한 정확히 추출해 JSON으로만 답하세요. 설명·코드블록 없이 순수 JSON만.
{
  "date": "결제일자 YYYY-MM-DD, 없으면 빈 문자열",
  "store": "가맹점(상호)명",
  "bizNo": "사업자등록번호(예 000-00-00000), 없으면 빈 문자열",
  "address": "가맹점 주소, 없으면 빈 문자열",
  "items": "구매 품목/메뉴를 쉼표로 나열(수량 있으면 포함), 없으면 빈 문자열",
  "supplyAmount": 공급가액 숫자(없으면 0),
  "vat": 부가세 숫자(없으면 0),
  "amount": 총 결제(합계)금액 숫자,
  "payMethod": "결제수단(예: 신용카드, 삼성카드 일시불, 현금 등), 없으면 빈 문자열",
  "approvalNo": "카드 승인번호, 없으면 빈 문자열",
  "people": 인원수 숫자(인원·테이블 표기 있으면, 없으면 0),
  "memo": "승인번호·인원·단가 등 부가정보를 한 문장으로 요약(없으면 빈 문자열)"
}
규칙: 숫자는 콤마·원 없이 숫자만. 안 보이는 항목은 0 또는 빈 문자열.`;

async function parseLunch(apiKey, b64, mediaType) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-opus-4-8", max_tokens: 1500,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
        { type: "text", text: LUNCH_PROMPT },
      ]}],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json();
  const txt = (j.content && j.content[0] && j.content[0].text) || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("파싱 결과 해석 불가");
  const p = JSON.parse(m[0]);
  return {
    date: p.date || "", store: String(p.store || "").trim(),
    bizNo: String(p.bizNo || "").trim(), address: String(p.address || "").trim(),
    items: String(p.items || "").trim(),
    supplyAmount: num(p.supplyAmount), vat: num(p.vat), amount: num(p.amount),
    payMethod: String(p.payMethod || "").trim(), approvalNo: String(p.approvalNo || "").trim(),
    people: num(p.people), memo: String(p.memo || "").trim(),
  };
}

exports.lunchWebhook = onRequest(
  { secrets: [LUNCH_TELEGRAM_TOKEN, ANTHROPIC_KEY, WEBHOOK_SECRET], region: "asia-northeast3" },
  async (req, res) => {
    const expected = WEBHOOK_SECRET.value();
    if (expected && req.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
      res.status(401).send("unauthorized");
      return;
    }
    try {
      const update = req.body || {};
      const msg = update.message || update.channel_post;
      if (!msg) { res.status(200).send("ok"); return; }

      let fileId = null;
      let fname = `lunch_${Date.now()}.jpg`;
      if (msg.photo && msg.photo.length) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.document && (msg.document.mime_type || "").startsWith("image/")) {
        fileId = msg.document.file_id;
        fname = msg.document.file_name || fname;
      }
      if (!fileId) { res.status(200).send("ok"); return; }

      const token = LUNCH_TELEGRAM_TOKEN.value();
      const gf = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
      if (!gf.ok) throw new Error("getFile 실패");
      const filePath = gf.result.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const buf = Buffer.from(await fr.arrayBuffer());
      let contentType = fr.headers.get("content-type") || "";
      if (!/^image\/(jpeg|png|gif|webp)$/.test(contentType)) {
        const ext = (filePath.split(".").pop() || "").toLowerCase();
        contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      }

      const db = admin.firestore();
      const id = db.collection("lunch_receipts").doc().id;
      const spath = `lunch_receipts/${id}_${fname}`;
      const dlToken = crypto.randomUUID();
      const bucket = admin.storage().bucket();
      await bucket.file(spath).save(buf, { metadata: { contentType, metadata: { firebaseStorageDownloadTokens: dlToken } } });
      const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(spath)}?alt=media&token=${dlToken}`;

      const base = {
        date: new Date().toISOString().slice(0, 10),
        store: "", bizNo: "", address: "", items: "",
        supplyAmount: "", vat: "", amount: "",
        payMethod: "", approvalNo: "", people: "",
        category: "식비",
        memo: msg.caption || "", imageUrl, imagePath: spath, fileName: fname,
        source: "telegram",
        tgFrom: (msg.from && (msg.from.first_name || msg.from.username)) || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      let okParse = false;
      try {
        const p = await parseLunch(ANTHROPIC_KEY.value(), buf.toString("base64"), contentType);
        base.date = p.date || base.date;
        base.store = p.store; base.bizNo = p.bizNo; base.address = p.address; base.items = p.items;
        base.supplyAmount = p.supplyAmount; base.vat = p.vat; base.amount = p.amount;
        base.payMethod = p.payMethod; base.approvalNo = p.approvalNo; base.people = p.people;
        if (!base.memo) base.memo = p.memo;
        base.source = "parsed";
        base.parsedAt = admin.firestore.FieldValue.serverTimestamp();
        okParse = true;
      } catch (e) { console.error("lunch claude error", e); }

      await db.collection("lunch_receipts").doc(id).set(base);

      try {
        const reply = okParse
          ? `🍚 점심 영수증 등록 완료\n식당: ${base.store || "(인식 실패)"}\n금액: ${base.amount ? base.amount.toLocaleString("ko-KR") + "원" : "-"}\n날짜: ${base.date}`
          : "🍚 영수증을 받았습니다. (자동 인식은 실패 — 관리 페이지에서 확인해 주세요)";
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: msg.chat.id, text: reply }),
        });
      } catch (_) { /* 무시 */ }

      res.status(200).send("ok");
    } catch (err) {
      console.error("lunch webhook error", err);
      res.status(200).send("ok");
    }
  }
);
