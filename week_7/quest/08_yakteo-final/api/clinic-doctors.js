// ========================================
// GET /api/clinic-doctors?region=<시도 시군구>  — Vercel 서버리스 함수
// ----------------------------------------
// HIRA(심평원) 병원정보에서 해당 구의 의원별 의사수를 모아 { map } 으로 내려준다.
// 프론트가 행안부 신규 의원과 이름으로 매칭해 "의사 N명" 보강에 사용.
// 구가 선택되지 않았거나(시/도 전체) 매핑 불가 지역이면 빈 맵({}) 반환 — 본 기능엔 무영향.
// 응답: { map: { 정규화된의원명: { drTotCnt, sdrCnt } } }
// ========================================
const { fetchHiraDoctorMap, getServiceKey, sendJson, getRegion } = require('./_lib')

module.exports = async (req, res) => {
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'GET 메서드만 지원합니다' })
  }
  if (!getServiceKey()) {
    return sendJson(res, 500, { error: 'SERVICE_KEY가 설정되지 않았습니다 (환경변수 확인)' })
  }
  const region = getRegion(req)
  // "시도 시군구" 형태일 때만 보강 — 시/도 전체(공백 없음)면 빈 맵.
  const sp = region.indexOf(' ')
  if (sp <= 0) return sendJson(res, 200, { map: {} })
  const sido = region.slice(0, sp)
  const sigungu = region.slice(sp + 1)
  try {
    const map = await fetchHiraDoctorMap(sido, sigungu)
    sendJson(res, 200, { map })
  } catch (e) {
    console.error('[clinic-doctors] 보강 실패:', e.message)
    sendJson(res, 200, { map: {} }) // 보강 실패는 빈 맵(본 의원 기능에 영향 없음)
  }
}
