// yakteo_favorites 테이블 내용 조회 (검증·데모용)
// 실행: node --env-file=.env scripts/show-favorites.mjs
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

try {
  const { rows } = await pool.query(`
    select left(user_id::text, 8) || '…' as user_id,
           clinic_id, name, subject,
           to_char(open_date, 'YYYY-MM-DD') as open_date,
           score, score_detail,
           to_char(created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as saved_at
      from public.yakteo_favorites
     order by created_at desc
  `)
  if (!rows.length) console.log('(저장된 즐겨찾기 없음)')
  else {
    console.log(`✅ yakteo_favorites: ${rows.length}건\n`)
    for (const r of rows) {
      console.log(`  ★ ${r.name} (${r.subject || '-'}) · 개원 ${r.open_date || '-'} · 임장 ${r.score ?? '-'}점`)
      console.log(`    clinic_id=${r.clinic_id} · user=${r.user_id} · 저장 ${r.saved_at}`)
      if (r.score_detail) console.log(`    점수근거: ${JSON.stringify(r.score_detail)}`)
    }
  }
} catch (e) {
  console.error('❌ 조회 실패:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
