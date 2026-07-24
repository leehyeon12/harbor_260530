// ========================================
// GET /api/pharmacies?region=<지역>  — Vercel 서버리스 함수
// ----------------------------------------
// 영업중 약국 목록을 조회한다. 약국 데이터 활용신청 전이면 403이 흔함 →
// 503 + needsApply:true 로 변환해 프론트가 "신청 필요"를 구분하게 한다.
// 응답: { items: [...], totalCount: N }
// ========================================
const { getPharmacies, getPharmaciesPage, getServiceKey, sendJson, getRegion } = require('./_lib')

module.exports = async (req, res) => {
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'GET 메서드만 지원합니다' })
  }
  if (!getServiceKey()) {
    return sendJson(res, 500, { error: 'SERVICE_KEY가 설정되지 않았습니다 (환경변수 확인)' })
  }
  const region = getRegion(req)
  // pageNo 가 주어지면 단일 페이지만 반환(프론트 점진 로딩) — 없으면 기존처럼 전체.
  const pageNo = parseInt((req.query || {}).pageNo, 10)
  try {
    if (Number.isFinite(pageNo) && pageNo >= 1) {
      const page = await getPharmaciesPage(region, pageNo)
      return sendJson(res, 200, page) // { items, totalCount, pageNo, totalPages }
    }
    const { items, totalCount } = await getPharmacies(region)
    sendJson(res, 200, { items, totalCount })
  } catch (e) {
    console.error('[pharmacies] 호출 실패:', e.message)
    // 약국 데이터 활용신청 전이면 403(Forbidden)이 흔함 → 명확한 신호로 변환
    if (e.status === 403) {
      return sendJson(res, 503, {
        error: '약국 데이터 활용신청이 필요합니다(공공데이터포털)',
        needsApply: true,
      })
    }
    sendJson(res, e.status && e.status >= 400 ? e.status : 502, {
      error: e.message || '약국 데이터 조회 실패',
    })
  }
}
