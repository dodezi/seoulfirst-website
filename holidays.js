/* 대한민국 공휴일 데이터 + 조회 함수 (예약명단·직원연차 캘린더 공용)
   - 양력 고정 공휴일은 매년 자동
   - 음력 기반(설날·추석·부처님오신날)·대체공휴일은 연도별로 명시
   - 부정확하거나 누락된 날은 각 프로그램의 "임시공휴일"로 보정
*/
(function (global) {
  // 양력 고정 (MM-DD : 이름)
  var FIXED = {
    '01-01': '신정',
    '03-01': '3·1절',
    '05-05': '어린이날',
    '06-06': '현충일',
    '08-15': '광복절',
    '10-03': '개천절',
    '10-09': '한글날',
    '12-25': '성탄절'
  };
  // 연도별(음력·대체 등) — 공식 관보 기준
  var YEARLY = {
    '2025': {
      '2025-01-27': '설날 대체', '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
      '2025-03-03': '3·1절 대체',
      '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일',
      '2025-10-06': '추석 연휴', '2025-10-07': '추석', '2025-10-08': '추석 연휴'
    },
    '2026': {
      '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
      '2026-03-02': '3·1절 대체',
      '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
      '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴'
    },
    '2027': {
      '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '설날 대체',
      '2027-05-13': '부처님오신날',
      '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴'
    }
  };

  // 법정공휴일 이름 (없으면 null)
  function legalHolidayName(dateStr) {
    if (!dateStr || dateStr.length < 10) return null;
    var md = dateStr.slice(5);
    if (FIXED[md]) return FIXED[md];
    var y = dateStr.slice(0, 4);
    if (YEARLY[y] && YEARLY[y][dateStr]) return YEARLY[y][dateStr];
    return null;
  }

  // 법정 + 임시(customMap: {dateStr:name}) 통합 조회
  // 반환: { name, custom(bool) } 또는 null
  function holidayInfo(dateStr, customMap) {
    if (customMap && customMap[dateStr]) return { name: customMap[dateStr], custom: true };
    var n = legalHolidayName(dateStr);
    return n ? { name: n, custom: false } : null;
  }

  global.SF_HOLIDAYS = { legalHolidayName: legalHolidayName, holidayInfo: holidayInfo };
})(window);
