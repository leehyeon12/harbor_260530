// Supabase Postgres 를 저장소로 쓰는 가계부(수입/지출) 서버
// 표준 http 모듈 + pg(node-postgres) 만 사용 (그 외 외부 의존성 없음)

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { Pool } = require('pg')

// .env 로드: repo 루트(harbor_260530/.env)를 먼저 시도하고, 없으면 로컬 폴백
// __dirname = .../week_5/quest/01_ledger-app 이므로 3단계 위가 repo 루트
try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'))
} catch {
  try {
    process.loadEnvFile()
  } catch {}
}

const PORT = 3000
// 환경변수 끝의 개행/공백이 붙어오는 경우가 있어 .trim() 으로 정리
const connectionString = (process.env.DATABASE_URL || '').trim()

// DB 연결 풀
// Supabase 풀러는 SSL 이 필요하므로 ssl 옵션을 반드시 지정
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

// 시드 데이터 (테이블이 비어 있을 때 한 번만 입력)
// 수입/지출을 섞은 최근 거래 5건
const seedTransactions = [
  { type: 'income', category: '월급', amount: 3200000, memo: '6월 급여', date: '2026-07-01' },
  { type: 'expense', category: '식비', amount: 45000, memo: '점심 외식', date: '2026-07-02' },
  { type: 'expense', category: '교통', amount: 12000, memo: '지하철 충전', date: '2026-07-03' },
  { type: 'expense', category: '주거', amount: 800000, memo: '월세', date: '2026-07-05' },
  { type: 'expense', category: '구독료', amount: 13900, memo: '스트리밍 구독', date: '2026-07-06' },
]

// 테이블 생성 + (비어 있으면) 시드 입력
async function initDB() {
  // 거래 테이블이 없으면 생성
  // type 은 income/expense 만 허용, amount 는 0 이상, date 는 DATE 타입
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_ledger_transactions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      category TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      memo TEXT NOT NULL DEFAULT '',
      date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // 데이터가 0건이면 시드 5개 입력 (한 번만)
  // created_at 은 DEFAULT now() 에 맡긴다
  const countResult = await pool.query('SELECT count(*) AS cnt FROM harbor_w5_ledger_transactions')
  const count = Number(countResult.rows[0].cnt)
  if (count === 0) {
    for (const tx of seedTransactions) {
      await pool.query(
        'INSERT INTO harbor_w5_ledger_transactions (type, category, amount, memo, date) VALUES ($1, $2, $3, $4, $5)',
        [tx.type, tx.category, tx.amount, tx.memo, tx.date]
      )
    }
    console.log(`시드 데이터 ${seedTransactions.length}건을 입력했습니다`)
  }

  // 월별 예산 테이블이 없으면 생성
  // month 는 'YYYY-MM' 형식 문자열을 PK 로, amount 는 0 이상
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_ledger_budgets (
      month TEXT PRIMARY KEY,
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // 예산이 0건이면 데모용 시드 1건 입력 (초과 알림 화면 확인용, 최초 1회만)
  const budgetCountResult = await pool.query('SELECT count(*) AS cnt FROM harbor_w5_ledger_budgets')
  const budgetCount = Number(budgetCountResult.rows[0].cnt)
  if (budgetCount === 0) {
    await pool.query(
      'INSERT INTO harbor_w5_ledger_budgets (month, amount) VALUES ($1, $2)',
      ['2026-07', 2000000]
    )
    console.log('예산 시드 데이터 1건을 입력했습니다')
  }
}

// JSON 응답 헬퍼
function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

// 요청 본문(JSON) 파싱: 청크를 모아 JSON.parse
// 성공 시 객체 반환, 잘못된 JSON 이면 에러를 throw
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim()
      // 본문이 비어 있으면 빈 객체로 처리
      if (raw === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', (err) => reject(err))
  })
}

// index.html 정적 서빙
function serveIndex(res) {
  const filePath = path.join(__dirname, 'index.html')
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('index.html 을 찾을 수 없습니다')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(content)
  })
}

// DB row 를 API 응답 형태로 정규화
// - amount: pg 가 NUMERIC 을 문자열로 주므로 Number 로 변환
// - date: DATE 타입이 Date 객체로 오므로 YYYY-MM-DD 문자열로 변환
function formatRow(row) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    amount: Number(row.amount),
    memo: row.memo,
    date: formatDate(row.date),
    created_at: row.created_at,
  }
}

// date 값을 YYYY-MM-DD 문자열로 정규화
// pg 는 DATE 를 Date 객체(로컬 자정)로 반환하는데, toISOString 은 UTC 로 밀릴 수 있어
// 로컬 기준 연/월/일을 직접 조합한다. 이미 문자열이면 앞 10자리만 사용.
function formatDate(value) {
  if (value == null) {
    return null
  }
  if (typeof value === 'string') {
    return value.slice(0, 10)
  }
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 거래 입력값 검증
// 유효하면 { ok: true, value: {...} }, 아니면 { ok: false, error: '...' } 반환
function validateTransaction(body) {
  // type: 'income' | 'expense'
  const type = typeof body.type === 'string' ? body.type.trim() : ''
  if (type !== 'income' && type !== 'expense') {
    return { ok: false, error: "type 은 'income' 또는 'expense' 여야 합니다" }
  }
  // category: 비어있지 않은 문자열
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  if (category === '') {
    return { ok: false, error: 'category 는 필수이며 공백일 수 없습니다' }
  }
  // amount: 0 이상 숫자 (숫자 형태 문자열도 허용)
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'amount 는 0 이상의 숫자여야 합니다' }
  }
  // date: YYYY-MM-DD 형식
  const date = typeof body.date === 'string' ? body.date.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'date 는 YYYY-MM-DD 형식이어야 합니다' }
  }
  // memo: 선택값, 문자열이 아니면 빈 문자열
  const memo = typeof body.memo === 'string' ? body.memo : ''

  return { ok: true, value: { type, category, amount, memo, date } }
}

// month 값 검증: 'YYYY-MM' 형식 문자열인지 확인
function isValidMonth(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

// 라우팅
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // 1. GET /api/transactions -> 목록 조회 (date DESC, id DESC)
  // 선택 쿼리파라미터 month=YYYY-MM 이 있으면 해당 월만 필터링
  if (method === 'GET' && pathname === '/api/transactions') {
    const month = url.searchParams.get('month')
    // month 가 넘어온 경우에만 형식 검증 (없으면 전체 조회)
    if (month !== null && !isValidMonth(month)) {
      sendJson(res, 400, { error: 'month 는 YYYY-MM 형식이어야 합니다' })
      return
    }
    // month 유무에 따라 WHERE 절과 바인딩 파라미터를 구성
    const where = month ? "WHERE to_char(date, 'YYYY-MM') = $1" : ''
    const params = month ? [month] : []
    const result = await pool.query(
      `SELECT id, type, category, amount, memo, date, created_at FROM harbor_w5_ledger_transactions ${where} ORDER BY date DESC, id DESC`,
      params
    )
    sendJson(res, 200, result.rows.map(formatRow))
    return
  }

  // 2. POST /api/transactions -> 새 거래 생성
  if (method === 'POST' && pathname === '/api/transactions') {
    let body
    try {
      body = await parseBody(req)
    } catch (err) {
      sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
      return
    }
    const check = validateTransaction(body)
    if (!check.ok) {
      sendJson(res, 400, { error: check.error })
      return
    }
    const { type, category, amount, memo, date } = check.value
    const result = await pool.query(
      'INSERT INTO harbor_w5_ledger_transactions (type, category, amount, memo, date) VALUES ($1, $2, $3, $4, $5) RETURNING id, type, category, amount, memo, date, created_at',
      [type, category, amount, memo, date]
    )
    sendJson(res, 201, formatRow(result.rows[0]))
    return
  }

  // 3. GET /api/stats -> 통계 (수입/지출 합계, 잔액, 카테고리별 집계)
  // 선택 쿼리파라미터 month=YYYY-MM 이 있으면 합계/카테고리 집계 모두 해당 월로 필터링
  if (method === 'GET' && pathname === '/api/stats') {
    const month = url.searchParams.get('month')
    // month 가 넘어온 경우에만 형식 검증 (없으면 전체 집계)
    if (month !== null && !isValidMonth(month)) {
      sendJson(res, 400, { error: 'month 는 YYYY-MM 형식이어야 합니다' })
      return
    }
    // 두 쿼리에 동일하게 적용할 WHERE 절과 바인딩 파라미터
    const where = month ? "WHERE to_char(date, 'YYYY-MM') = $1" : ''
    const params = month ? [month] : []

    // 수입/지출 합계
    const totalResult = await pool.query(
      `
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income_total,
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense_total
      FROM harbor_w5_ledger_transactions
      ${where}
    `,
      params
    )
    const incomeTotal = Number(totalResult.rows[0].income_total)
    const expenseTotal = Number(totalResult.rows[0].expense_total)

    // 타입+카테고리별 집계 (합계 큰 순)
    const byCategoryResult = await pool.query(
      `
      SELECT type, category, SUM(amount) AS total, COUNT(*) AS cnt
      FROM harbor_w5_ledger_transactions
      ${where}
      GROUP BY type, category
      ORDER BY total DESC
    `,
      params
    )
    const byCategory = byCategoryResult.rows.map((row) => ({
      type: row.type,
      category: row.category,
      total: Number(row.total),
      cnt: Number(row.cnt),
    }))

    sendJson(res, 200, {
      income_total: incomeTotal,
      expense_total: expenseTotal,
      balance: incomeTotal - expenseTotal,
      by_category: byCategory,
    })
    return
  }

  // 7. GET /api/months -> 거래가 존재하는 월 목록 (최신순 문자열 배열)
  if (method === 'GET' && pathname === '/api/months') {
    const result = await pool.query(
      "SELECT DISTINCT to_char(date, 'YYYY-MM') AS month FROM harbor_w5_ledger_transactions ORDER BY month DESC"
    )
    sendJson(res, 200, result.rows.map((row) => row.month))
    return
  }

  // 8. GET /api/budget?month=YYYY-MM -> 해당 월 예산 조회
  // month 는 필수이며 YYYY-MM 형식이어야 한다. 행이 없으면 amount 0 으로 응답
  if (method === 'GET' && pathname === '/api/budget') {
    const month = url.searchParams.get('month')
    if (!isValidMonth(month)) {
      sendJson(res, 400, { error: 'month 는 YYYY-MM 형식이어야 합니다' })
      return
    }
    const result = await pool.query(
      'SELECT month, amount FROM harbor_w5_ledger_budgets WHERE month = $1',
      [month]
    )
    if (result.rowCount === 0) {
      sendJson(res, 200, { month, amount: 0 })
      return
    }
    const row = result.rows[0]
    sendJson(res, 200, { month: row.month, amount: Number(row.amount) })
    return
  }

  // 9. PUT /api/budget -> 월 예산 upsert (있으면 갱신, 없으면 생성)
  if (method === 'PUT' && pathname === '/api/budget') {
    let body
    try {
      body = await parseBody(req)
    } catch (err) {
      sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
      return
    }
    // month: 'YYYY-MM' 형식 검증
    const month = typeof body.month === 'string' ? body.month.trim() : ''
    if (!isValidMonth(month)) {
      sendJson(res, 400, { error: 'month 는 YYYY-MM 형식이어야 합니다' })
      return
    }
    // amount: 0 이상 숫자 (숫자 형태 문자열도 허용)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      sendJson(res, 400, { error: 'amount 는 0 이상의 숫자여야 합니다' })
      return
    }
    const result = await pool.query(
      `
      INSERT INTO harbor_w5_ledger_budgets (month, amount) VALUES ($1, $2)
      ON CONFLICT (month) DO UPDATE SET amount = $2, updated_at = now()
      RETURNING month, amount
    `,
      [month, amount]
    )
    const row = result.rows[0]
    sendJson(res, 200, { month: row.month, amount: Number(row.amount) })
    return
  }

  // /api/transactions/:id 형태 매칭 (PUT, DELETE)
  const idMatch = pathname.match(/^\/api\/transactions\/(.+)$/)
  if (idMatch) {
    const rawId = idMatch[1]
    // :id 는 숫자만 허용
    if (!/^\d+$/.test(rawId)) {
      sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
      return
    }
    const id = Number(rawId)

    // 4. PUT /api/transactions/:id -> 거래 수정
    if (method === 'PUT') {
      let body
      try {
        body = await parseBody(req)
      } catch (err) {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return
      }
      const check = validateTransaction(body)
      if (!check.ok) {
        sendJson(res, 400, { error: check.error })
        return
      }
      const { type, category, amount, memo, date } = check.value
      const result = await pool.query(
        'UPDATE harbor_w5_ledger_transactions SET type = $1, category = $2, amount = $3, memo = $4, date = $5 WHERE id = $6 RETURNING id, type, category, amount, memo, date, created_at',
        [type, category, amount, memo, date, id]
      )
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 거래를 찾을 수 없습니다' })
        return
      }
      sendJson(res, 200, formatRow(result.rows[0]))
      return
    }

    // 5. DELETE /api/transactions/:id -> 삭제
    if (method === 'DELETE') {
      const result = await pool.query('DELETE FROM harbor_w5_ledger_transactions WHERE id = $1', [id])
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 거래를 찾을 수 없습니다' })
        return
      }
      sendJson(res, 200, { ok: true })
      return
    }
  }

  // 6. 그 외 GET -> index.html 정적 서빙
  if (method === 'GET') {
    serveIndex(res)
    return
  }

  // 매칭되지 않는 요청
  sendJson(res, 404, { error: '요청한 경로를 찾을 수 없습니다' })
}

// 서버 생성: 모든 핸들러를 try/catch 로 감싸 DB 에러 시 500 응답
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('요청 처리 중 오류:', err)
    if (!res.headersSent) {
      sendJson(res, 500, { error: '서버 내부 오류가 발생했습니다' })
    } else {
      res.end()
    }
  })
})

// 초기화(테이블 생성 + 시드)가 끝난 뒤 listen 시작
initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`서버 실행 중: http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('DB 초기화 실패. 서버를 시작하지 못했습니다:', err)
    process.exit(1)
  })
