// Supabase Postgres 를 저장소로 쓰는 todo 서버 (JWT 인증 포함)
// 표준 http 모듈 + pg(node-postgres) 만 사용 (그 외 외부 의존성 없음)
// 인증(회원가입/로그인/JWT/비밀번호 해싱)은 Node 내장 crypto 로 직접 구현

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const crypto = require('node:crypto')
const { Pool } = require('pg')

// .env 로드: Node 내장 기능 사용 (외부 패키지 없이)
// .env 가 없거나 형식이 잘못돼도 서버는 계속 진행
try {
  process.loadEnvFile()
} catch (err) {
  console.warn('.env 파일을 불러오지 못했습니다 (무시하고 진행):', err.message)
}

const PORT = 3000
const connectionString = process.env.DATABASE_URL

// JWT 서명 비밀키: .env 의 JWT_SECRET 을 쓰되, 없으면 개발용 기본값으로 대체
// ⚠️ 실제 배포 시에는 반드시 .env 에 강력한 JWT_SECRET 을 설정할 것
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me'
if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET 이 .env 에 없어 개발용 기본값을 사용합니다 (배포 전 반드시 설정)')
}
// 토큰 유효기간: 7일 (초 단위)
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7

// DB 연결 풀
// Supabase 풀러는 SSL 이 필요하므로 ssl 옵션을 반드시 지정
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

// ========================================
// 🔐 비밀번호 해싱 (scrypt)
// ========================================
// 저장 형식: "salt(hex):hash(hex)"  — salt 는 랜덤 16바이트
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

// 저장된 해시와 입력 비밀번호 비교 (타이밍 공격 방지 위해 timingSafeEqual)
function verifyPassword(password, stored) {
  const [salt, originalHex] = String(stored).split(':')
  if (!salt || !originalHex) return false
  const original = Buffer.from(originalHex, 'hex')
  const derived = crypto.scryptSync(password, salt, 64)
  // 길이가 다르면 비교 자체가 불가하므로 먼저 차단
  if (original.length !== derived.length) return false
  return crypto.timingSafeEqual(original, derived)
}

// ========================================
// 🎫 JWT (HMAC-SHA256, 외부 패키지 없이 직접 구현)
// ========================================
// base64url 인코딩/디코딩 헬퍼
function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(input) {
  // base64url -> base64 로 되돌린 뒤 디코드
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

// HMAC-SHA256 서명 계산 (base64url 형태로 반환)
function hmacSign(data) {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// payload 객체로 JWT 문자열 생성 (header.payload.signature)
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' }
  // exp(만료), iat(발급시각) 을 payload 에 포함 — 시간은 초 단위 UNIX time
  const nowSec = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: nowSec, exp: nowSec + TOKEN_TTL_SECONDS }

  const encodedHeader = base64urlEncode(JSON.stringify(header))
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload))
  const data = `${encodedHeader}.${encodedPayload}`
  const signature = hmacSign(data)

  return `${data}.${signature}`
}

// JWT 검증: 서명이 맞고 만료 전이면 payload 반환, 아니면 null
function verifyToken(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [encodedHeader, encodedPayload, signature] = parts
  const data = `${encodedHeader}.${encodedPayload}`

  // 서명 재계산 후 일치 여부 확인 (타이밍 안전 비교)
  const expected = hmacSign(data)
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null

  // payload 파싱 + 만료 확인
  let payload
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload))
  } catch {
    return null
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number' && payload.exp < nowSec) return null

  return payload
}

// 요청 헤더에서 Bearer 토큰을 꺼내 검증 → 유효하면 payload, 아니면 null
function getAuthUser(req) {
  const header = req.headers['authorization'] || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  return verifyToken(match[1])
}

// ========================================
// 🗄️ DB 초기화 (테이블 생성 + 마이그레이션)
// ========================================
async function initDB() {
  // users 테이블: 회원가입 계정 저장
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_todo_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // todos 테이블이 없으면 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w4_todo_todos (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false
    )
  `)

  // 기존 todos 테이블에 user_id 컬럼이 없으면 추가 (사용자별 분리용 마이그레이션)
  // 기존(주인 없는) todo 데이터는 user_id 가 NULL 로 남아 어떤 사용자에게도 보이지 않는다.
  await pool.query(`
    ALTER TABLE harbor_w4_todo_todos ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES harbor_w5_todo_users(id)
  `)
}

// ========================================
// 🌐 HTTP 헬퍼
// ========================================
function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

// 요청 본문(JSON) 파싱: 청크를 모아 JSON.parse
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim()
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

// ========================================
// 🔑 인증 API 핸들러
// ========================================
// 아이디/비밀번호 기본 검증 규칙
function validateCredentials(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (username.length < 3) return { error: '아이디는 3자 이상이어야 합니다' }
  if (password.length < 4) return { error: '비밀번호는 4자 이상이어야 합니다' }
  return { username, password }
}

// POST /api/auth/register -> 계정 생성 후 토큰 발급
async function handleRegister(req, res) {
  let body
  try {
    body = await parseBody(req)
  } catch {
    sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
    return
  }
  const cred = validateCredentials(body)
  if (cred.error) {
    sendJson(res, 400, { error: cred.error })
    return
  }

  const passwordHash = hashPassword(cred.password)
  try {
    const result = await pool.query(
      'INSERT INTO harbor_w5_todo_users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [cred.username, passwordHash]
    )
    const user = result.rows[0]
    const token = signToken({ sub: user.id, username: user.username })
    sendJson(res, 201, { token, user })
  } catch (err) {
    // UNIQUE 제약 위반(중복 아이디) -> 409
    if (err.code === '23505') {
      sendJson(res, 409, { error: '이미 사용 중인 아이디입니다' })
      return
    }
    throw err
  }
}

// POST /api/auth/login -> 자격 확인 후 토큰 발급
async function handleLogin(req, res) {
  let body
  try {
    body = await parseBody(req)
  } catch {
    sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
    return
  }
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (username === '' || password === '') {
    sendJson(res, 400, { error: '아이디와 비밀번호를 입력하세요' })
    return
  }

  const result = await pool.query(
    'SELECT id, username, password_hash FROM harbor_w5_todo_users WHERE username = $1',
    [username]
  )
  const user = result.rows[0]
  // 아이디가 없거나 비밀번호가 틀리면 동일한 메시지로 응답 (계정 존재 여부 노출 방지)
  if (!user || !verifyPassword(password, user.password_hash)) {
    sendJson(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다' })
    return
  }

  const token = signToken({ sub: user.id, username: user.username })
  sendJson(res, 200, { token, user: { id: user.id, username: user.username } })
}

// ========================================
// 🧭 라우팅
// ========================================
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // ---- 인증 API (토큰 불필요) ----
  if (method === 'POST' && pathname === '/api/auth/register') {
    await handleRegister(req, res)
    return
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    await handleLogin(req, res)
    return
  }

  // ---- todo API: 모두 인증 필요 ----
  if (pathname === '/api/todos' || pathname.startsWith('/api/todos/')) {
    const authUser = getAuthUser(req)
    if (!authUser) {
      sendJson(res, 401, { error: '로그인이 필요합니다' })
      return
    }
    const userId = authUser.sub

    // 1. GET /api/todos -> 본인 todo 만 id 오름차순
    if (method === 'GET' && pathname === '/api/todos') {
      const result = await pool.query(
        'SELECT id, text, done FROM harbor_w4_todo_todos WHERE user_id = $1 ORDER BY id',
        [userId]
      )
      sendJson(res, 200, result.rows)
      return
    }

    // 2. POST /api/todos -> 본인 소유로 새 todo 생성
    if (method === 'POST' && pathname === '/api/todos') {
      let body
      try {
        body = await parseBody(req)
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return
      }
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '') {
        sendJson(res, 400, { error: 'text 는 필수이며 공백일 수 없습니다' })
        return
      }
      const result = await pool.query(
        'INSERT INTO harbor_w4_todo_todos (text, done, user_id) VALUES ($1, $2, $3) RETURNING id, text, done',
        [text, false, userId]
      )
      sendJson(res, 201, result.rows[0])
      return
    }

    // /api/todos/:id (PATCH, DELETE) — 본인 소유만 조작 가능
    const todoIdMatch = pathname.match(/^\/api\/todos\/(.+)$/)
    if (todoIdMatch) {
      const rawId = todoIdMatch[1]
      if (!/^\d+$/.test(rawId)) {
        sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
        return
      }
      const id = Number(rawId)

      // 3. PATCH /api/todos/:id -> done 갱신 (본인 것만)
      if (method === 'PATCH') {
        let body
        try {
          body = await parseBody(req)
        } catch {
          sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
          return
        }
        if (typeof body.done !== 'boolean') {
          sendJson(res, 400, { error: 'done 은 boolean 이어야 합니다' })
          return
        }
        const result = await pool.query(
          'UPDATE harbor_w4_todo_todos SET done = $1 WHERE id = $2 AND user_id = $3 RETURNING id, text, done',
          [body.done, id, userId]
        )
        if (result.rowCount === 0) {
          sendJson(res, 404, { error: '해당 todo 를 찾을 수 없습니다' })
          return
        }
        sendJson(res, 200, result.rows[0])
        return
      }

      // 4. DELETE /api/todos/:id -> 삭제 (본인 것만)
      if (method === 'DELETE') {
        const result = await pool.query(
          'DELETE FROM harbor_w4_todo_todos WHERE id = $1 AND user_id = $2',
          [id, userId]
        )
        if (result.rowCount === 0) {
          sendJson(res, 404, { error: '해당 todo 를 찾을 수 없습니다' })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // todo 경로지만 매칭 안 되는 메서드
    sendJson(res, 404, { error: '요청한 경로를 찾을 수 없습니다' })
    return
  }

  // 5. 그 외 GET -> index.html 정적 서빙
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

// 초기화(테이블 생성 + 마이그레이션)가 끝난 뒤 listen 시작
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
