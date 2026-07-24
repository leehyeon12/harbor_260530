// DATABASE_URL 구조 진단 — 비밀번호 값은 절대 출력하지 않음.
// 실행: node --env-file=.env scripts/diag-db.mjs
import { createHash } from 'node:crypto'
const raw = process.env.DATABASE_URL || ''
if (!raw) { console.log('DATABASE_URL 비어있음'); process.exit(1) }

try {
  const url = new URL(raw)
  const pw = url.password || ''
  console.log('protocol :', url.protocol)
  console.log('username :', url.username, '(postgres.<ref> 형태여야 정상)')
  console.log('host     :', url.hostname)
  console.log('port     :', url.port)
  console.log('database :', url.pathname)
  const fp = pw ? createHash('sha256').update(decodeURIComponent(pw)).digest('hex').slice(0, 10) : '(없음)'
  console.log('password : len', pw.length, '| 지문', fp,
    '| 자리표시자([·YOUR-PASSWORD)?', /\[|\]|your-?password/i.test(decodeURIComponent(pw)),
    '| URL인코딩안된특수문자?', /[^A-Za-z0-9%._-]/.test(pw))
} catch (e) {
  console.log('URL 파싱 실패:', e.message, '→ 비밀번호에 특수문자가 인코딩 안 됐을 수 있음')
}
