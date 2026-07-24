// ========================================
// /api/favorites — 즐겨찾기 서버 저장 (Vercel 서버리스 함수)
// ----------------------------------------
// 인증: Supabase Auth 토큰(Authorization: Bearer) → verifyUser 로 검증 후
//       user.id 로 범위를 강제한다 (Data API OFF 라 RLS 대신 서버가 담당).
// 저장: yakteo_favorites 테이블 — 저장 시점 스냅샷(점수·좌표 포함).
//   GET             → 내 즐겨찾기 목록
//   POST   (body)   → 추가 (이미 있으면 무시 — 멱등)
//   DELETE ?id=...  → clinic_id 로 삭제
// ========================================
const { sendJson } = require('./_lib')
const { getPool, verifyUser } = require('./_supabase')

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))

module.exports = async (req, res) => {
  const user = await verifyUser(req)
  if (!user) return sendJson(res, 401, { error: '로그인이 필요합니다' })
  const pool = getPool()

  try {
    if (!req.method || req.method === 'GET') {
      const { rows } = await pool.query(
        `select clinic_id, name, addr, subject,
                to_char(open_date, 'YYYY-MM-DD') as open_date,
                tel, lat, lng, score, score_detail
           from public.yakteo_favorites
          where user_id = $1
          order by created_at desc`,
        [user.id]
      )
      return sendJson(res, 200, {
        items: rows.map((r) => ({
          id: r.clinic_id,
          name: r.name,
          addr: r.addr,
          subject: r.subject,
          openDate: r.open_date,
          tel: r.tel,
          lat: r.lat,
          lng: r.lng,
          score: r.score != null ? Number(r.score) : null,
          scoreDetail: r.score_detail || null,
        })),
      })
    }

    if (req.method === 'POST') {
      const b = req.body || {}
      if (!b.id) return sendJson(res, 400, { error: 'id(clinic_id)가 필요합니다' })
      const openDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.openDate || '')) ? b.openDate : null
      await pool.query(
        `insert into public.yakteo_favorites
           (user_id, clinic_id, name, addr, subject, open_date, tel, lat, lng, score, score_detail, region)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (user_id, clinic_id) do nothing`,
        [
          user.id, String(b.id), b.name || null, b.addr || null, b.subject || null,
          openDate, b.tel || null, num(b.lat), num(b.lng), num(b.score),
          b.scoreDetail ? JSON.stringify(b.scoreDetail) : null, b.region || null,
        ]
      )
      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || ''
      if (!id) return sendJson(res, 400, { error: 'id(clinic_id) 쿼리가 필요합니다' })
      await pool.query(
        'delete from public.yakteo_favorites where user_id = $1 and clinic_id = $2',
        [user.id, String(id)]
      )
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 405, { error: 'GET/POST/DELETE 만 지원합니다' })
  } catch (e) {
    console.error('[favorites] 처리 실패:', e.message)
    return sendJson(res, 500, { error: '즐겨찾기 처리 실패' })
  }
}
