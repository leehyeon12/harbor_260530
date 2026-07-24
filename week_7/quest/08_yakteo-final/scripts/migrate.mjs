// 약터 테이블 생성/갱신 (idempotent).
// 실행: node --env-file=.env scripts/migrate.mjs
// db/schema.sql 을 읽어 Supabase Postgres(pg, Transaction pooler)에 적용한다.
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 없음. `node --env-file=.env scripts/migrate.mjs` 로 실행하세요.')
  process.exit(1)
}

const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase 풀러는 SSL 필수
})

try {
  await pool.query(sql)
  const { rows } = await pool.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'yakteo_%'
    order by table_name
  `)
  console.log('✅ 마이그레이션 완료. public 스키마의 yakteo_ 테이블:')
  for (const r of rows) console.log('   -', r.table_name)
} catch (e) {
  console.error('❌ 마이그레이션 실패:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
