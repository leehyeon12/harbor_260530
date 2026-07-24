// ========================================
// Supabase 공유 모듈 (favorites 서버 저장용)
// ----------------------------------------
// 아키텍처: Data API OFF(강사 지침) → DB 접근은 서버가 pg 로 직접,
// 인증(카카오 로그인)만 Supabase Auth 를 쓰는 하이브리드.
//  - getPool  : Supabase Postgres 연결 풀 (DATABASE_URL, Transaction pooler)
//  - verifyUser: 클라이언트가 보낸 Supabase Auth 토큰(Authorization: Bearer)을
//                Supabase Auth API 로 검증해 사용자 정보를 얻는다
// ========================================
const { Pool } = require('pg')

let pool = null
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase 풀러는 SSL 필수
      max: 3, // 서버리스 환경 — 커넥션 최소화
    })
  }
  return pool
}

// Authorization 헤더의 토큰을 Supabase Auth 로 검증 → user 객체({ id, ... }) 또는 null
async function verifyUser(req) {
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: anonKey, Authorization: 'Bearer ' + token },
    })
    if (!r.ok) return null
    const user = await r.json()
    return user && user.id ? user : null
  } catch (e) {
    console.error('[auth] 토큰 검증 실패:', e.message)
    return null
  }
}

module.exports = { getPool, verifyUser }
