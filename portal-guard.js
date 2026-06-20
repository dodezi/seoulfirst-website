/* 포털 페이지 접근 가드 (공용)
 * 사용법: 각 페이지에서 firebase 초기화 뒤에
 *   <script>window.PORTAL_PAGE_KEY='leaves';</script>
 *   <script src="portal-guard.js"></script>
 * 를 추가한다.
 *
 * 동작:
 *  - 비로그인 → 아무것도 안 함(각 페이지의 로그인 화면이 처리)
 *  - 원장(최고관리자) → 통과
 *  - 직원 → users 문서에서 active && perms[PAGE_KEY] 면 통과, 아니면 전체 화면 차단 오버레이
 */
(function () {
  var SUPER = ['dodezi82@gmail.com', 'seoulfirst2023@gmail.com'];

  function overlay(state, msg, email) {
    var id = 'portalGuardOverlay';
    var el = document.getElementById(id);
    if (state === 'hide') { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f4f6f9;display:flex;align-items:center;justify-content:center;padding:30px;font-family:\'Noto Sans KR\',sans-serif;';
      el.innerHTML =
        '<div style="background:#fff;border-radius:16px;padding:40px;max-width:430px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.12);">' +
          '<div style="font-size:48px;margin-bottom:8px;" id="pgIcon">🚫</div>' +
          '<h2 id="pgTitle" style="color:#c0392b;font-size:20px;margin-bottom:10px;">접근 권한이 없습니다</h2>' +
          '<p id="pgMsg" style="color:#5a6b7a;font-size:14px;line-height:1.7;"></p>' +
          '<p style="color:#aab4bd;font-size:12px;margin-top:8px;">현재 계정: <span id="pgEmail"></span></p>' +
          '<div id="pgActions" style="margin-top:18px;">' +
            '<a href="admin.html" style="display:inline-block;background:#0d7377;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700;">🏠 관리홈으로</a>' +
            '<div style="margin-top:12px;"><button id="pgLogout" style="background:#eef1f5;color:#51606e;border:none;padding:8px 16px;border-radius:7px;font-weight:600;cursor:pointer;font-family:inherit;">로그아웃</button></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(el);
      document.getElementById('pgLogout').onclick = function () { firebase.auth().signOut(); };
    }
    var loading = (state === 'loading');
    document.getElementById('pgIcon').textContent = loading ? '⏳' : '🚫';
    document.getElementById('pgTitle').textContent = loading ? '권한 확인 중…' : '접근 권한이 없습니다';
    document.getElementById('pgTitle').style.color = loading ? '#0d7377' : '#c0392b';
    document.getElementById('pgMsg').textContent = msg || '';
    document.getElementById('pgEmail').textContent = email || '';
    document.getElementById('pgActions').style.display = loading ? 'none' : 'block';
  }

  firebase.auth().onAuthStateChanged(function (user) {
    if (!user) { overlay('hide'); return; }
    var email = (user.email || '').toLowerCase();
    if (SUPER.indexOf(email) >= 0) { overlay('hide'); return; }
    // 직원 — 확인 중에는 내용이 잠깐도 안 보이도록 즉시 로딩 오버레이
    overlay('loading', '', user.email);
    firebase.firestore().collection('users').doc(email).get().then(function (doc) {
      var u = doc.exists ? doc.data() : null;
      var key = window.PORTAL_PAGE_KEY;
      if (u && u.active !== false && u.perms && u.perms[key] === true) {
        overlay('hide');
      } else {
        var msg = '이 페이지에 대한 접근 권한이 없습니다. 원장에게 권한을 요청하세요.';
        if (u && u.status === 'pending') msg = '가입 신청이 아직 승인되지 않았습니다. 원장 승인 후 이용할 수 있습니다.';
        else if (u && u.active === false) msg = '계정이 비활성 상태입니다. 원장에게 문의하세요.';
        overlay('deny', msg, user.email);
      }
    }).catch(function () {
      overlay('deny', '권한 확인 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.', user.email);
    });
  });
})();
