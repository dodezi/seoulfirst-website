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
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
const MEDS_TELEGRAM_TOKEN = defineSecret("MEDS_TELEGRAM_TOKEN");

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
      allowed = !!(u && u.active !== false && (perms.checkup || perms.invoice || perms.lunch || perms.meds));
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
async function solapiReq(method, path, bodyObj, apiKey, apiSecret) {
  const r = await fetch("https://api.solapi.com" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: solapiAuthHeader(apiKey, apiSecret),
    },
    body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
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
    let templateKey = String(data.templateKey || "");
    const variables = (data.variables && typeof data.variables === "object") ? data.variables : {};
    if (!to) throw new HttpsError("invalid-argument", "수신 번호가 없습니다.");

    const cfgSnap = await admin.firestore().collection("crm_config").doc("solapi").get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : null;
    console.log("sendKakao req", JSON.stringify({
      templateKey,
      hasCfg: !!cfg,
      pfId: cfg && cfg.pfId ? "set" : "missing",
      from: cfg && cfg.from ? "set" : "missing",
      tplKeys: cfg && cfg.templates ? Object.keys(cfg.templates) : [],
      tplForKey: cfg && cfg.templates && cfg.templates[templateKey] ? "set" : "missing",
    }));
    // 대장내시경 전용 템플릿이 아직 등록 안 됐으면 일반 검사 전 안내로 대체
    if (templateKey === "reminder_colono" && cfg && cfg.templates && !cfg.templates.reminder_colono) {
      templateKey = "reminder";
    }
    if (!cfg || !cfg.pfId || !cfg.templates || !cfg.templates[templateKey]) {
      throw new HttpsError("failed-precondition", "발송 설정이 준비되지 않았습니다 — 관리자 ⚙️ 발송 설정에서 pfId·발신번호·템플릿 ID를 저장하세요.");
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

    const apiKey = SOLAPI_API_KEY.value();
    const apiSecret = SOLAPI_API_SECRET.value();
    const scheduledDate =
      data.scheduledDate && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\+09:00)?$/.test(String(data.scheduledDate))
        ? String(data.scheduledDate)
        : null;

    if (scheduledDate) {
      // 예약 발송: 그룹 생성 → 메시지 추가 → 예약 (단일 send 엔드포인트는 예약 미지원)
      const g = await solapiReq("POST", "/messages/v4/groups", {}, apiKey, apiSecret);
      const groupId = g.j && g.j.groupId;
      if (!g.ok || !groupId) {
        console.error("group create fail", JSON.stringify(g.j).slice(0, 400));
        throw new HttpsError("internal", (g.j && g.j.errorMessage) || "예약 그룹 생성 실패");
      }
      const add = await solapiReq("PUT", `/messages/v4/groups/${groupId}/messages`, { messages: [message] }, apiKey, apiSecret);
      const addErr = add.j && add.j.resultList && add.j.resultList.find((x) => x && x.statusCode && x.statusCode !== "2000");
      if (!add.ok || (add.j && add.j.errorCount > 0) || addErr) {
        console.error("group add fail", JSON.stringify(add.j).slice(0, 600));
        throw new HttpsError("internal", (addErr && addErr.statusMessage) || (add.j && add.j.errorMessage) || "예약 메시지 등록 실패");
      }
      const sch = await solapiReq("POST", `/messages/v4/groups/${groupId}/schedule`, { scheduledDate }, apiKey, apiSecret);
      if (!sch.ok) {
        console.error("schedule fail", JSON.stringify(sch.j).slice(0, 400));
        throw new HttpsError("internal", (sch.j && sch.j.errorMessage) || "예약 설정 실패");
      }
      console.log("solapi scheduled ok", groupId, scheduledDate);
      return Object.assign({ groupId, scheduled: true }, sch.j || {});
    }

    // 즉시 발송
    const send = await solapiReq("POST", "/messages/v4/send", { message }, apiKey, apiSecret);
    const j = send.j;
    if (!send.ok) {
      console.error("solapi http error", send.status, JSON.stringify(j).slice(0, 600));
      throw new HttpsError("internal", j.errorMessage || j.message || `solapi ${send.status}`);
    }
    if (Array.isArray(j.failedMessageList) && j.failedMessageList.length) {
      const f = j.failedMessageList[0] || {};
      console.error("solapi msg fail", JSON.stringify(j).slice(0, 600));
      throw new HttpsError("internal", `${f.statusMessage || "발송 실패"} (${f.statusCode || ""})`);
    }
    if (j.statusCode && j.statusCode !== "2000") {
      console.error("solapi msg fail", JSON.stringify(j).slice(0, 600));
      throw new HttpsError("internal", `${j.statusMessage || "발송 실패"} (${j.statusCode})`);
    }
    console.log("solapi ok", JSON.stringify(j).slice(0, 300));
    return j;
  }
);

// 예약(스케줄) 발송 취소 — 솔라피 그룹의 예약을 해제한다.
exports.cancelKakao = onCall(
  { secrets: [SOLAPI_API_KEY, SOLAPI_API_SECRET], region: "asia-northeast3", timeoutSeconds: 30 },
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
    if (!allowed) throw new HttpsError("permission-denied", "권한이 없습니다.");

    const groupId = String((request.data && request.data.groupId) || "").trim();
    if (!groupId) throw new HttpsError("invalid-argument", "예약 그룹 ID가 없습니다.");

    const apiKey = SOLAPI_API_KEY.value();
    const apiSecret = SOLAPI_API_SECRET.value();
    // 예약 취소 (스케줄 해제)
    const r = await solapiReq("DELETE", `/messages/v4/groups/${groupId}/schedule`, {}, apiKey, apiSecret);
    if (!r.ok) {
      console.error("cancel schedule fail", groupId, JSON.stringify(r.j).slice(0, 400));
      throw new HttpsError("internal", (r.j && (r.j.errorMessage || r.j.message)) || `취소 실패 (${r.status}) — 이미 발송됐을 수 있습니다.`);
    }
    console.log("solapi schedule canceled", groupId);
    return r.j || { ok: true };
  }
);

// ───────────────────────────────────────────────────────────
// 검사 전 안내 자동 발송 (스케줄): 매일 한국시간 오전 10시
//  - 내일 검사가 '확정'된 환자에게 안내 알림톡 자동 발송
//  - 직원이 별도 확인/조작할 필요 없음 (예약명단에서 확정만 해두면 됨)
//  - 결과를 예약 문서(crmReminderAt/crmReminderStatus)와 일별 로그(crm_auto_log)에 기록
// ───────────────────────────────────────────────────────────
const CRM_DOW = ["일", "월", "화", "수", "목", "금", "토"];
function crmLabelOf(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${m}월 ${d}일 (${CRM_DOW[dt.getUTCDay()]})`;
}
function crmIsColono(s) {
  const x = String(s || "").replace(/\s/g, "");
  return ["대장내시경", "대장", "용종", "폴립", "대장암"].some((k) => x.includes(k));
}
async function solapiSendOne(to, templateId, pfId, from, variables, apiKey, apiSecret) {
  const kakaoOptions = { pfId, templateId, variables, disableSms: from ? false : true };
  const message = { to, kakaoOptions };
  if (from) message.from = String(from).replace(/[^0-9]/g, "");
  const send = await solapiReq("POST", "/messages/v4/send", { message }, apiKey, apiSecret);
  const j = send.j || {};
  if (!send.ok) throw new Error(j.errorMessage || j.message || `solapi ${send.status}`);
  if (Array.isArray(j.failedMessageList) && j.failedMessageList.length) {
    const f = j.failedMessageList[0] || {};
    throw new Error(`${f.statusMessage || "발송 실패"} (${f.statusCode || ""})`);
  }
  if (j.statusCode && j.statusCode !== "2000") throw new Error(`${j.statusMessage || "발송 실패"} (${j.statusCode})`);
  return j;
}

exports.autoReminder = onSchedule(
  { schedule: "0 10 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3", secrets: [SOLAPI_API_KEY, SOLAPI_API_SECRET], timeoutSeconds: 300 },
  async () => {
    const dbf = admin.firestore();
    // 한국시간 기준 '내일' 날짜
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    kst.setUTCDate(kst.getUTCDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    const tomorrow = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;

    const cfgSnap = await dbf.collection("crm_config").doc("solapi").get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : null;
    const apiKey = SOLAPI_API_KEY.value();
    const apiSecret = SOLAPI_API_SECRET.value();

    const snap = await dbf.collection("bookings").where("confirmedDate", "==", tomorrow).get();
    let sent = 0, failed = 0, skipped = 0;
    const errors = [];

    for (const docSnap of snap.docs) {
      const b = docSnap.data();
      if (b.deleted) continue;
      if (b.status !== "확정") continue;
      if (b.crmReminderSkip) { skipped++; continue; }
      if (b.crmReminderAt) { skipped++; continue; } // 이미 발송됨(수동 포함)

      const to = String(b.phone || "").replace(/[^0-9]/g, "");
      const FieldValue = admin.firestore.FieldValue;
      if (!to) {
        failed++; errors.push(`${b.name || "?"}: 연락처 없음`);
        await docSnap.ref.update({ crmReminderStatus: "발송오류", crmReminderError: "연락처 없음", crmReminderAuto: true });
        continue;
      }
      let key = crmIsColono(b.service) ? "reminder_colono" : "reminder";
      if (key === "reminder_colono" && !(cfg && cfg.templates && cfg.templates.reminder_colono)) key = "reminder";
      const variables = {
        "#{이름}": b.name || "",
        "#{검사명}": b.service || "검사",
        "#{검사일}": b.confirmedDate ? crmLabelOf(b.confirmedDate) : "",
        "#{시간}": b.confirmedTime || "",
      };
      try {
        if (!cfg || !cfg.pfId || !cfg.templates || !cfg.templates[key]) throw new Error("발송 설정 미완료(pfId/템플릿)");
        await solapiSendOne(to, cfg.templates[key], cfg.pfId, cfg.from, variables, apiKey, apiSecret);
        sent++;
        await docSnap.ref.update({
          crmReminderAt: FieldValue.serverTimestamp(),
          crmReminderAuto: true,
          crmReminderStatus: "발송완료",
          crmReminderError: FieldValue.delete(),
        });
      } catch (e) {
        failed++; errors.push(`${b.name || "?"}: ${e.message || e}`);
        await docSnap.ref.update({ crmReminderStatus: "발송오류", crmReminderError: String(e.message || e), crmReminderAuto: true });
      }
    }

    // 일별 자동발송 로그 (예약 시스템 경고 배너·CRM 표시용)
    await dbf.collection("crm_auto_log").doc(tomorrow).set({
      date: tomorrow,
      ranAt: admin.firestore.FieldValue.serverTimestamp(),
      sent, failed, skipped,
      errors: errors.slice(0, 50),
    }, { merge: true });
    console.log("autoReminder", tomorrow, "sent", sent, "failed", failed, "skipped", skipped);
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

// ───────────────────────────────────────────────────────────
// 처방전·약품조회 수신 함수 (의약품 식별 — 별도 봇)
//  직원이 봇에게 처방전/약품조회 사진을 보내면:
//  Storage 저장 → Claude로 약품명·용량·1일횟수·일수 정리 → meds_records 저장
//  → admin-meds.html에 실시간 표시. 차트에 복사해 붙여넣기.
// ───────────────────────────────────────────────────────────
const MEDS_PROMPT = `이 이미지는 처방전 또는 약품 조회 화면입니다. 환자가 복용 중인 약을 차트에 붙여넣을 수 있도록 정리하세요.
각 약을 보이는 순서대로 한 줄씩, 아래 형식으로만 출력합니다.

형식: 제품명 용량(성분명) - 1일 N회 - 총 N일분

규칙:
- 제품명을 우선 쓰고, 괄호 안에 성분명을 병기. 성분명만 있으면 성분명만.
- 용량은 1정/1회 용량(mg 등).
- "1일 N회"는 하루 투여 횟수. 화면에 1일 투여횟수가 있으면 그 값, 없으면 추정하지 말고 "1일 ?회"로.
- 투여일수가 보이면 "총 N일분", 없으면 그 부분 생략.
- 설명·머리말·표·마크다운 기호 없이 약 목록만 한국어로 출력.`;

async function parseMedsImage(apiKey, b64, mediaType) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-opus-4-8", max_tokens: 1500,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
        { type: "text", text: MEDS_PROMPT },
      ]}],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json();
  return ((j.content && j.content[0] && j.content[0].text) || "").trim();
}

exports.medsWebhook = onRequest(
  { secrets: [MEDS_TELEGRAM_TOKEN, ANTHROPIC_KEY, WEBHOOK_SECRET], region: "asia-northeast3" },
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
      let fname = `meds_${Date.now()}.jpg`;
      if (msg.photo && msg.photo.length) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.document && (msg.document.mime_type || "").startsWith("image/")) {
        fileId = msg.document.file_id;
        fname = msg.document.file_name || fname;
      }
      if (!fileId) { res.status(200).send("ok"); return; }

      const token = MEDS_TELEGRAM_TOKEN.value();
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
      const id = db.collection("meds_records").doc().id;
      const spath = `meds_records/${id}_${fname}`;
      const dlToken = crypto.randomUUID();
      const bucket = admin.storage().bucket();
      await bucket.file(spath).save(buf, { metadata: { contentType, metadata: { firebaseStorageDownloadTokens: dlToken } } });
      const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(spath)}?alt=media&token=${dlToken}`;

      const base = {
        text: "", memo: msg.caption || "", imageUrl, imagePath: spath, fileName: fname,
        source: "telegram",
        tgFrom: (msg.from && (msg.from.first_name || msg.from.username)) || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      let okParse = false;
      try {
        base.text = await parseMedsImage(ANTHROPIC_KEY.value(), buf.toString("base64"), contentType);
        base.source = "parsed";
        base.parsedAt = admin.firestore.FieldValue.serverTimestamp();
        okParse = !!base.text;
      } catch (e) { console.error("meds claude error", e); }

      await db.collection("meds_records").doc(id).set(base);

      try {
        const reply = okParse
          ? `💊 복약 정리 완료\n\n${base.text.slice(0, 600)}\n\n(의약품 식별 페이지에서도 확인·복사할 수 있어요)`
          : "💊 사진을 받았습니다. (자동 인식 실패 — 의약품 식별 페이지에서 확인해 주세요)";
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: msg.chat.id, text: reply }),
        });
      } catch (_) { /* 무시 */ }

      res.status(200).send("ok");
    } catch (err) {
      console.error("meds webhook error", err);
      res.status(200).send("ok");
    }
  }
);
