// ========================================
// GET /api/clinics?region=<지역>  — Vercel 서버리스 함수
// ----------------------------------------
// 신규 개원 의원 목록을 공공데이터에서 조회해 그대로 내려준다(serviceKey 미포함).
// 응답: { items: [...원본 item 배열...], totalCount: N }
// ========================================
const { getClinics, getServiceKey, sendJson, getRegion, getSinceMonths } = require('./_lib')

module.exports = async (req, res) => {
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'GET 메서드만 지원합니다' })
  }
  if (!getServiceKey()) {
    return sendJson(res, 500, { error: 'SERVICE_KEY가 설정되지 않았습니다 (환경변수 확인)' })
  }
  const region = getRegion(req)
  const sinceMonths = getSinceMonths(req)
  try {
    const { items, totalCount, sinceDate } = await getClinics(region, sinceMonths)
    sendJson(res, 200, { items, totalCount, sinceMonths, sinceDate })
  } catch (e) {
    console.error('[clinics] 호출 실패:', e.message)
    sendJson(res, e.status && e.status >= 400 ? e.status : 502, {
      error: e.message || '의원 데이터 조회 실패',
    })
  }
}
