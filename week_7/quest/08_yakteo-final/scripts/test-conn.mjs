// 연결 원인 격리: 비번을 URL에 안 끼우고, newpass.txt의 raw 값을 pg 분리 필드로 넘겨 테스트.
// 인코딩 문제라면 이건 성공한다. 그래도 실패하면 비번 자체가 틀린 것.
// 실행: node --env-file=.env scripts/test-conn.mjs
import pg from 'pg'
import { readFileSync } from 'node:fs'

const url = new URL(process.env.DATABASE_URL)
let pw = ''
try { pw = readFileSync('newpass.txt', 'utf8').trim() } catch {}
if (!pw) { console.log('newpass.txt 없음/빈값 → DATABASE_URL의 비번 사용'); pw = decodeURIComponent(url.password) }

// MODE=direct 면 풀러 대신 DB 직접 연결로 테스트 (풀러 전파 지연 격리용)
const direct = process.env.MODE === 'direct'
const ref = decodeURIComponent(url.username).split('.')[1] || ''
const cfg = direct ? {
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: 'postgres',
  database: 'postgres',
  password: pw,
  ssl: { rejectUnauthorized: false },
} : {
  host: url.hostname,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  password: pw,                       // raw, 인코딩 없음
  ssl: { rejectUnauthorized: false },
}
console.log(`연결 시도: user=${cfg.user} host=${cfg.host}:${cfg.port} db=${cfg.database} pw_len=${cfg.password.length}`)

const client = new pg.Client(cfg)
try {
  await client.connect()
  const r = await client.query('select current_user, current_database()')
  console.log('✅ 연결 성공:', r.rows[0])
} catch (e) {
  console.log('❌ 연결 실패:', e.message)
} finally {
  await client.end().catch(() => {})
}
