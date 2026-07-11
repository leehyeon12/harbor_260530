// 중고 전자기기 쇼핑몰 서버 (JWT 인증 + 장바구니)
// 표준 http 모듈 + pg(node-postgres) 만 사용 (그 외 외부 의존성 없음)
// 인증(회원가입/로그인/JWT/비밀번호 해싱)은 Node 내장 crypto 로 직접 구현
// Vercel 서버리스에서도 재사용할 수 있도록 handleRequest / ensureInit 를 export 한다

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const crypto = require('node:crypto')
const { Pool } = require('pg')

// .env 로드: 프로젝트 로컬 값(JWT_SECRET 등 개별 키)을 먼저 채우고,
// 없는 값은 repo 루트(harbor_260530/.env) 공통값(DATABASE_URL 등)으로 보완한다.
// loadEnvFile은 이미 설정된 process.env 값을 덮어쓰지 않으므로 로컬이 항상 우선한다.
try {
  process.loadEnvFile()
} catch {}
try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'))
} catch {}

const PORT = process.env.PORT || 3000
// 환경변수 끝의 개행/공백이 붙어오는 경우가 있어 .trim() 으로 정리
const connectionString = (process.env.DATABASE_URL || '').trim()

// JWT 서명 비밀키: .env 의 JWT_SECRET 을 쓰되, 없으면 개발용 기본값으로 대체
// ⚠️ 실제 배포 시에는 반드시 .env 에 강력한 JWT_SECRET 을 설정할 것
const JWT_SECRET = (process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me').trim()
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
// 🌱 시드 데이터 (중고 전자기기 10종)
// ========================================
// products 가 0건일 때만 최초 1회 입력한다.
// image_url 은 Unsplash 무료 이미지, price 는 중고 시세를 반영한 원(정수) 단위
const seedProducts = [
  {
    name: 'Apple iPhone 13 128GB',
    price: 620000,
    image_url: 'https://images.unsplash.com/photo-1632661674596-df8be070a5c5?w=600&q=80',
    description: '배터리 성능 89%, 잔기스 거의 없는 미드나이트 색상 중고',
  },
  {
    name: 'iPad Air 4세대 64GB',
    price: 480000,
    image_url: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&q=80',
    description: '스카이블루, 애플펜슬 2세대 호환 되는 깔끔한 상태',
  },
  {
    name: 'AirPods Pro 2세대',
    price: 210000,
    image_url: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&q=80',
    description: '충전 케이스 포함, 노이즈 캔슬링 정상 작동',
  },
  {
    name: 'MacBook Air M1 8GB 256GB',
    price: 780000,
    image_url: 'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=600&q=80',
    description: '스페이스그레이, 사이클 120회 미만의 가벼운 사용감',
  },
  {
    name: 'Samsung Galaxy S22 256GB',
    price: 430000,
    image_url: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=600&q=80',
    description: '팬텀블랙, 액정 무흠집 · 정품 케이스 함께 드립니다',
  },
  {
    name: 'Nintendo Switch OLED',
    price: 290000,
    image_url: 'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?w=600&q=80',
    description: '화이트 조이콘, 독·거치대 풀박스 구성',
  },
  {
    name: 'Sony WH-1000XM4 헤드폰',
    price: 240000,
    image_url: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=600&q=80',
    description: '업계 최고 노이즈 캔슬링, 이어패드 새것으로 교체 완료',
  },
  {
    name: '기계식 키보드 (갈축)',
    price: 65000,
    image_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&q=80',
    description: 'PBT 이중사출 키캡, 갈축 텐키리스 · 타건감 부드러움',
  },
  {
    name: 'Apple Watch Series 7 45mm',
    price: 320000,
    image_url: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=600&q=80',
    description: 'GPS 모델, 스포츠밴드 포함 · 배터리 최대용량 92%',
  },
  {
    name: 'Dyson V11 무선청소기',
    price: 350000,
    image_url: 'https://images.unsplash.com/photo-1558317374-067fb5f30001?w=600&q=80',
    description: '흡입력 정상, 헤드 3종 · 배터리 교체형으로 오래 사용 가능',
  },
]

// ========================================
// 🗄️ DB 초기화 (테이블 생성 + 시드)
// ========================================
async function initDB() {
  // 회원 계정 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_shop_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // 상품 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_shop_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT ''
    )
  `)

  // 장바구니 테이블
  // (user_id, product_id) 조합은 유일 — 같은 상품은 수량으로만 누적
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_shop_cart (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES harbor_w5_shop_users(id),
      product_id INTEGER NOT NULL REFERENCES harbor_w5_shop_products(id),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      UNIQUE (user_id, product_id)
    )
  `)

  // 상품이 0건이면 중고 전자기기 시드 10종 입력 (최초 1회만)
  const countResult = await pool.query('SELECT count(*) AS cnt FROM harbor_w5_shop_products')
  const count = Number(countResult.rows[0].cnt)
  if (count === 0) {
    for (const p of seedProducts) {
      await pool.query(
        'INSERT INTO harbor_w5_shop_products (name, price, image_url, description) VALUES ($1, $2, $3, $4)',
        [p.name, p.price, p.image_url, p.description]
      )
    }
    console.log(`상품 시드 데이터 ${seedProducts.length}건을 입력했습니다`)
  }
}

// DB 초기화를 프로세스 당 한 번만 실행하기 위한 캐시된 프라미스
// 서버리스(Vercel)에서 매 요청마다 initDB 가 중복 실행되는 것을 방지한다.
let initPromise
function ensureInit() {
  if (!initPromise) initPromise = initDB()
  return initPromise
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
// 성공 시 객체 반환, 잘못된 JSON 이면 에러를 throw
function parseBody(req) {
  // Vercel 서버리스 런타임은 JSON 본문을 미리 파싱해 req.body 에 넣고 스트림을 소비할 수 있다.
  // 그 경우 스트림 대신 이미 파싱된 객체를 그대로 사용한다.
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body)
  }
  if (typeof req.body === 'string' && req.body.trim() !== '') {
    try { return Promise.resolve(JSON.parse(req.body)) } catch (err) { return Promise.reject(err) }
  }
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

// ========================================
// 🔑 인증 API 핸들러
// ========================================
// 아이디/비밀번호 기본 검증 규칙 (username 2자 이상, password 4자 이상)
function validateCredentials(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (username.length < 2) return { error: '아이디는 2자 이상이어야 합니다' }
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
      'INSERT INTO harbor_w5_shop_users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
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
    'SELECT id, username, password_hash FROM harbor_w5_shop_users WHERE username = $1',
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
// 🛒 장바구니 헬퍼
// ========================================
// 장바구니 조인 조회 → 클라이언트가 쓰기 좋은 형태로 반환
// 각 항목에 subtotal(단가*수량)을 담고, 전체 total 합계도 함께 계산
async function fetchCart(userId) {
  const result = await pool.query(
    `
    SELECT
      c.id           AS cart_id,
      c.product_id   AS product_id,
      p.name         AS name,
      p.price        AS price,
      p.image_url    AS image_url,
      c.quantity     AS quantity
    FROM harbor_w5_shop_cart c
    JOIN harbor_w5_shop_products p ON p.id = c.product_id
    WHERE c.user_id = $1
    ORDER BY c.id
  `,
    [userId]
  )
  const items = result.rows.map((row) => ({
    cart_id: row.cart_id,
    product_id: row.product_id,
    name: row.name,
    price: row.price,
    image_url: row.image_url,
    quantity: row.quantity,
    subtotal: row.price * row.quantity,
  }))
  const total = items.reduce((sum, item) => sum + item.subtotal, 0)
  return { items, total }
}

// ========================================
// 🧭 라우팅
// ========================================
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // ---- 공개 API: 상품 목록 (인증 불필요) ----
  if (method === 'GET' && pathname === '/api/products') {
    const result = await pool.query(
      'SELECT id, name, price, image_url, description FROM harbor_w5_shop_products ORDER BY id'
    )
    sendJson(res, 200, result.rows)
    return
  }

  // ---- 인증 API (토큰 불필요) ----
  if (method === 'POST' && pathname === '/api/auth/register') {
    await handleRegister(req, res)
    return
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    await handleLogin(req, res)
    return
  }

  // ---- 장바구니 API: 모두 인증 필요 ----
  if (pathname === '/api/cart' || pathname.startsWith('/api/cart/')) {
    const authUser = getAuthUser(req)
    if (!authUser) {
      sendJson(res, 401, { error: '로그인이 필요합니다' })
      return
    }
    const userId = authUser.sub

    // 1. GET /api/cart -> 내 장바구니 (상품 조인). 합계는 클라이언트가 subtotal로 계산.
    if (method === 'GET' && pathname === '/api/cart') {
      const cart = await fetchCart(userId)
      sendJson(res, 200, cart.items)
      return
    }

    // 2. POST /api/cart -> 담기 (이미 있으면 수량 누적)
    if (method === 'POST' && pathname === '/api/cart') {
      let body
      try {
        body = await parseBody(req)
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return
      }
      // product_id: 정수 필수
      const productId = Number(body.product_id)
      if (!Number.isInteger(productId) || productId <= 0) {
        sendJson(res, 400, { error: 'product_id 는 양의 정수여야 합니다' })
        return
      }
      // quantity: 생략 시 1, 양의 정수여야 함
      const quantity = body.quantity === undefined ? 1 : Number(body.quantity)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        sendJson(res, 400, { error: 'quantity 는 양의 정수여야 합니다' })
        return
      }

      // 존재하지 않는 상품이면 FK 위반 전에 미리 404 로 안내
      const productCheck = await pool.query(
        'SELECT id FROM harbor_w5_shop_products WHERE id = $1',
        [productId]
      )
      if (productCheck.rowCount === 0) {
        sendJson(res, 404, { error: '해당 상품을 찾을 수 없습니다' })
        return
      }

      // ON CONFLICT 로 (user_id, product_id) 중복 시 수량 누적
      const result = await pool.query(
        `
        INSERT INTO harbor_w5_shop_cart (user_id, product_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, product_id)
        DO UPDATE SET quantity = harbor_w5_shop_cart.quantity + EXCLUDED.quantity
        RETURNING id, product_id, quantity
      `,
        [userId, productId, quantity]
      )
      sendJson(res, 201, result.rows[0])
      return
    }

    // /api/cart/:id (PATCH, DELETE) — 본인 소유 항목만 조작 가능
    const cartIdMatch = pathname.match(/^\/api\/cart\/(.+)$/)
    if (cartIdMatch) {
      const rawId = cartIdMatch[1]
      if (!/^\d+$/.test(rawId)) {
        sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
        return
      }
      const id = Number(rawId)

      // 3. PATCH /api/cart/:id -> 수량 변경 (0 이하면 해당 행 삭제)
      if (method === 'PATCH') {
        let body
        try {
          body = await parseBody(req)
        } catch {
          sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
          return
        }
        const quantity = Number(body.quantity)
        if (!Number.isInteger(quantity)) {
          sendJson(res, 400, { error: 'quantity 는 정수여야 합니다' })
          return
        }

        // 수량이 0 이하면 장바구니에서 제거 (본인 것만)
        if (quantity <= 0) {
          const del = await pool.query(
            'DELETE FROM harbor_w5_shop_cart WHERE id = $1 AND user_id = $2',
            [id, userId]
          )
          if (del.rowCount === 0) {
            sendJson(res, 404, { error: '해당 장바구니 항목을 찾을 수 없습니다' })
            return
          }
          sendJson(res, 200, { ok: true, removed: true })
          return
        }

        // 양수면 수량 갱신 (본인 것만)
        const result = await pool.query(
          'UPDATE harbor_w5_shop_cart SET quantity = $1 WHERE id = $2 AND user_id = $3 RETURNING id, product_id, quantity',
          [quantity, id, userId]
        )
        if (result.rowCount === 0) {
          sendJson(res, 404, { error: '해당 장바구니 항목을 찾을 수 없습니다' })
          return
        }
        sendJson(res, 200, result.rows[0])
        return
      }

      // 4. DELETE /api/cart/:id -> 삭제 (본인 것만)
      if (method === 'DELETE') {
        const result = await pool.query(
          'DELETE FROM harbor_w5_shop_cart WHERE id = $1 AND user_id = $2',
          [id, userId]
        )
        if (result.rowCount === 0) {
          sendJson(res, 404, { error: '해당 장바구니 항목을 찾을 수 없습니다' })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // cart 경로지만 매칭 안 되는 메서드
    sendJson(res, 404, { error: '요청한 경로를 찾을 수 없습니다' })
    return
  }

  // 그 외 GET -> index.html 정적 서빙
  if (method === 'GET') {
    serveIndex(res)
    return
  }

  // 매칭되지 않는 요청
  sendJson(res, 404, { error: '요청한 경로를 찾을 수 없습니다' })
}

// 서버 생성: 각 요청 앞에서 DB 초기화를 보장한 뒤 handleRequest 실행
// 모든 핸들러를 try/catch 로 감싸 DB 에러 시 500 응답
const server = http.createServer((req, res) => {
  ensureInit()
    .then(() => handleRequest(req, res))
    .catch((err) => {
      console.error('요청 처리 중 오류:', err)
      if (!res.headersSent) {
        sendJson(res, 500, { error: '서버 내부 오류가 발생했습니다' })
      } else {
        res.end()
      }
    })
})

// 로컬 개발 실행일 때만 listen (Vercel 서버리스에서는 함수가 export 를 재사용)
if (require.main === module) {
  ensureInit()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`서버 실행 중: http://localhost:${PORT}`)
      })
    })
    .catch((err) => {
      console.error('DB 초기화 실패. 서버를 시작하지 못했습니다:', err)
      process.exit(1)
    })
}

// Vercel 서버리스는 "기본 export가 (req,res) 핸들러 함수"여야 한다.
// 기본 export = DB 초기화 보장 후 라우팅하는 핸들러. 로컬/재사용용 named export도 함께 붙인다.
async function vercelHandler(req, res) {
  try {
    await ensureInit()
    await handleRequest(req, res)
  } catch (err) {
    console.error('요청 처리 중 오류:', err)
    if (!res.headersSent) {
      sendJson(res, 500, { error: '서버 내부 오류가 발생했습니다' })
    } else {
      res.end()
    }
  }
}
module.exports = vercelHandler
module.exports.handleRequest = handleRequest
module.exports.ensureInit = ensureInit
