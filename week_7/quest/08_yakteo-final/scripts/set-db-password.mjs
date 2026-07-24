// .env 의 DATABASE_URL "비밀번호 부분만" 교체한다.
// 새 비번은 ./newpass.txt 에서 읽는다 (채팅 노출 방지 · 손편집 실패 회피).
// 사용: 1) Supabase에서 새 비번 Copy  2) `pbpaste > newpass.txt`  3) `node scripts/set-db-password.mjs`
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

let pw
try { pw = readFileSync('newpass.txt', 'utf8').trim() }
catch { console.error('❌ newpass.txt 없음. 새 비번 복사 후 `pbpaste > newpass.txt` 실행하세요.'); process.exit(1) }
if (!pw) { console.error('❌ newpass.txt 비어있음'); process.exit(1) }

const env = readFileSync('.env', 'utf8')
let changed = false
const out = env.split(/\r?\n/).map((l) => {
  if (!l.startsWith('DATABASE_URL=')) return l
  const val = l.slice('DATABASE_URL='.length)
  try {
    const u = new URL(val)
    u.password = pw               // WHATWG URL 직렬화가 특수문자 자동 인코딩
    changed = true
    return 'DATABASE_URL=' + u.toString()
  } catch {
    const m = val.match(/^(postgres(?:ql)?:\/\/[^:]+:)([^@]*)(@.*)$/)
    if (m) { changed = true; return 'DATABASE_URL=' + m[1] + encodeURIComponent(pw) + m[3] }
    return l
  }
}).join('\n')

if (!changed) { console.error('❌ .env 에서 DATABASE_URL 줄을 못 찾음'); process.exit(1) }
writeFileSync('.env', out)
const fp = createHash('sha256').update(pw).digest('hex').slice(0, 10)
console.log('✅ .env DATABASE_URL 비번 교체됨. 새 지문:', fp, '(len ' + pw.length + ')')
console.log('   (이전 지문 c2a8db0b57 와 다르면 성공. 이후 newpass.txt 는 삭제 예정)')
