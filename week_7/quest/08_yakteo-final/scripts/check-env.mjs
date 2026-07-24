// .env 값을 노출하지 않고 "채워졌는지 + 형식이 맞는지"만 검증하는 스크립트.
// 실행: node --env-file=.env scripts/check-env.mjs
// 출력은 전부 마스킹 — 실제 secret 값은 찍지 않는다.

const mask = (v) => (!v ? '' : v.length <= 8 ? '*'.repeat(v.length) : v.slice(0, 4) + '…' + '*'.repeat(6))

function line(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(18)} ${detail}`)
}

const {
  SERVICE_KEY,
  DATABASE_URL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} = process.env

console.log('── .env 검증 (값은 마스킹) ──\n')

// SERVICE_KEY (기존, 공공데이터)
line('SERVICE_KEY', !!SERVICE_KEY, SERVICE_KEY ? `설정됨 (len ${SERVICE_KEY.length})` : '비어있음')

// DATABASE_URL — postgresql:// + transaction pooler(:6543) 여부만 확인, 값·비번은 감춤
if (DATABASE_URL) {
  const isPg = DATABASE_URL.startsWith('postgresql://') || DATABASE_URL.startsWith('postgres://')
  const isPooler = /pooler\.supabase\.com/.test(DATABASE_URL)
  const port = (DATABASE_URL.match(/:(\d{4,5})\//) || [])[1] || '?'
  const hasPw = /:[^:@/]+@/.test(DATABASE_URL) // user:password@ 형태 존재
  const ok = isPg && isPooler && port === '6543' && hasPw
  line('DATABASE_URL', ok,
    `pg=${isPg} pooler=${isPooler} port=${port} 비번포함=${hasPw}` +
    (ok ? '' : '  ⚠️ Transaction pooler(:6543) URI 인지 확인'))
} else {
  line('DATABASE_URL', false, '비어있음 — connection string 붙여넣기 필요')
}

// SUPABASE_URL — 공개값이라 그대로 보여줘도 안전
if (SUPABASE_URL) {
  const ok = /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(SUPABASE_URL)
  line('SUPABASE_URL', ok, `${SUPABASE_URL}` + (ok ? '' : '  ⚠️ https://<ref>.supabase.co 형식인지 확인'))
} else {
  line('SUPABASE_URL', false, '비어있음')
}

// SUPABASE_ANON_KEY — publishable(sb_publishable_) 또는 legacy anon(eyJ) 접두어만 확인
if (SUPABASE_ANON_KEY) {
  const isPub = SUPABASE_ANON_KEY.startsWith('sb_publishable_')
  const isJwt = SUPABASE_ANON_KEY.startsWith('eyJ')
  const isSecret = SUPABASE_ANON_KEY.startsWith('sb_secret_') || SUPABASE_ANON_KEY.startsWith('service_role')
  const ok = (isPub || isJwt) && !isSecret
  const kind = isPub ? 'publishable' : isJwt ? 'legacy-anon(JWT)' : isSecret ? '⚠️SECRET!' : '알수없음'
  line('SUPABASE_ANON_KEY', ok, `종류=${kind} 미리보기=${mask(SUPABASE_ANON_KEY)} (len ${SUPABASE_ANON_KEY.length})` +
    (isSecret ? '  🚨 secret 키가 들어감! anon/publishable 로 교체' : ''))
} else {
  line('SUPABASE_ANON_KEY', false, '비어있음')
}

console.log('\n(모든 항목 ✅ 이면 다음 단계: 테이블 생성 + 구현)')
