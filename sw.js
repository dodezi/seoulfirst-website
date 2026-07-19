/* 서울퍼스트내과 관리시스템 Service Worker
 * 전략: 네트워크 우선(Network-first).
 *   · HTML 문서(페이지 이동)는 '네트워크 전용' — 절대 캐시에서 주지 않는다.
 *     => 옛 페이지(예: 지난 휴진 팝업)가 캐시에 남아 계속 뜨는 사고를 원천 차단.
 *   · CSS·이미지 등 정적 자원만 네트워크 우선 + 오프라인 대비 캐시 백업.
 * git push로 배포한 변경이 항상 즉시 반영된다.
 */
const CACHE = 'seoulfirst-admin-v3';   // 버전 올리면 activate 때 이전 캐시 전부 삭제

self.addEventListener('install', () => {
  self.skipWaiting();   // 새 SW 즉시 활성화
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 이전 버전 캐시 전부 삭제(옛 팝업·옛 HTML 잔여 정리)
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    // 혹시 현재 캐시에 남아있을 수 있는 옛 HTML 문서도 제거
    try {
      const cache = await caches.open(CACHE);
      const reqs = await cache.keys();
      await Promise.all(reqs.map(async (r) => {
        if (r.mode === 'navigate' || /\.html($|\?)/.test(r.url)) await cache.delete(r);
      }));
    } catch (_) {}
    await self.clients.claim();
  })());
});

// 페이지 이동(문서 요청)인지 판별
function isHtmlRequest(req) {
  return req.mode === 'navigate' ||
    (req.destination === 'document') ||
    (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST 등은 통과
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 외부(Firebase 등)는 통과

  // HTML 문서: 네트워크 전용(캐시에 저장/대체 안 함) — 항상 최신 페이지
  if (isHtmlRequest(req)) {
    e.respondWith(fetch(req));
    return;
  }

  // 정적 자원: 네트워크 우선, 실패 시에만 캐시 대체
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
