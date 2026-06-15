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
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp({ storageBucket: "seoulfirst-ba9d4.firebasestorage.app" });

const TELEGRAM_TOKEN = defineSecret("TELEGRAM_TOKEN");
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");

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
