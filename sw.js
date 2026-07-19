/* 서울퍼스트내과 관리시스템 Service Worker
 * 전략: 네트워크 우선(Network-first). 관리자 도구는 항상 최신을 받아야 하므로
 *       먼저 서버에서 받아오고, 오프라인/네트워크 실패 시에만 캐시로 대체한다.
 *       => git push로 배포한 변경이 바로 반영된다(캐시에 발목 잡히지 않음).
 */
const CACHE = 'seoulfirst-admin-v2';   // 버전 올리면 activate 때 이전 캐시 전부 삭제(옛 팝업·파일 정리)

self.addEventListener('install', (e) => {
  self.skipWaiting();   // 새 SW 즉시 활성화 대기 없이 설치
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 이전 버전 캐시 정리
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GET 이외(POST 등)·외부 도메인(Firebase/구글 등)은 그대로 통과 — 캐시·간섭 없음
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);            // 1) 항상 네트워크 우선
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());           // 백업용으로 캐시에 저장
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);    // 2) 오프라인이면 캐시 대체
      if (cached) return cached;
      throw err;
    }
  })());
});
