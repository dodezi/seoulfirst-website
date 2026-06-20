/* 변경·접속 이력 기록 (append-only)
 * firebase(app/auth/firestore compat) 초기화 뒤에 로드.
 * 사용: logAudit('booking', '예약 취소', '홍길동 6/17');
 * 실패해도 본래 기능에 영향 없도록 모든 오류를 삼킨다.
 */
window.logAudit = function (category, action, detail) {
  try {
    var u = firebase.auth().currentUser;
    return firebase.firestore().collection('audit_logs').add({
      actor:    u ? (u.email || '') : '(anonymous)',
      category: category || '',
      action:   action || '',
      detail:   detail || '',
      page:     (location.pathname.split('/').pop() || ''),
      at:       firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function () {});
  } catch (e) { /* ignore */ }
};
