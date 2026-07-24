// ========================================
// GET /api/config — 클라이언트 공개 설정 (Vercel 서버리스 함수)
// ----------------------------------------
// SUPABASE_URL/ANON_KEY 는 클라이언트에 노출돼도 되는 공개값이지만,
// index.html 에 하드코딩하지 않고 환경변수 한 곳(.env / Vercel)에서 관리하려고
// 이 엔드포인트로 내려준다.
// ⚠️ secret 류(SERVICE_KEY·DATABASE_URL)는 절대 여기로 내리지 않는다.
// ========================================
const { sendJson } = require('./_lib')

module.exports = (req, res) => {
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'GET 메서드만 지원합니다' })
  }
  sendJson(res, 200, {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  })
}
