// Supabase Postgres 를 저장소로 쓰는 레시피 서버 (인증 없음, 순수 CRUD)
// 표준 http 모듈 + pg(node-postgres) 만 사용 (그 외 외부 의존성 없음)

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
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

// DB 연결 풀
// Supabase 풀러는 SSL 이 필요하므로 ssl 옵션을 반드시 지정
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

// ========================================
// 🗄️ DB 초기화 (테이블 생성)
// ========================================
async function initDB() {
  // simple_recipes 테이블이 없으면 생성
  // 기존 recipes 테이블과 충돌을 피하기 위해 별도 이름을 사용
  await pool.query(`
    CREATE TABLE IF NOT EXISTS simple_recipes (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
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
// ✅ 입력 검증 + 정규화
// ========================================
// 레시피 본문(title/ingredients/steps)을 검증하고 다듬어 반환
// title 은 필수(공백 불가), ingredients/steps 는 선택(없으면 빈 문자열)
function normalizeRecipe(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const ingredients = typeof body.ingredients === 'string' ? body.ingredients.trim() : ''
  const steps = typeof body.steps === 'string' ? body.steps.trim() : ''
  if (title === '') return { error: '제목(title)은 필수이며 공백일 수 없습니다' }
  return { title, ingredients, steps }
}

// ========================================
// 🧭 라우팅
// ========================================
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // ---- 레시피 API (인증 없음) ----
  if (pathname === '/api/recipes' || pathname.startsWith('/api/recipes/')) {
    // 1. GET /api/recipes -> 전체 목록 (최신순)
    if (method === 'GET' && pathname === '/api/recipes') {
      const result = await pool.query(
        'SELECT id, title, ingredients, steps, created_at FROM simple_recipes ORDER BY created_at DESC, id DESC'
      )
      sendJson(res, 200, result.rows)
      return
    }

    // 2. POST /api/recipes -> 새 레시피 생성
    if (method === 'POST' && pathname === '/api/recipes') {
      let body
      try {
        body = await parseBody(req)
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return
      }
      const recipe = normalizeRecipe(body)
      if (recipe.error) {
        sendJson(res, 400, { error: recipe.error })
        return
      }
      const result = await pool.query(
        `INSERT INTO simple_recipes (title, ingredients, steps)
         VALUES ($1, $2, $3)
         RETURNING id, title, ingredients, steps, created_at`,
        [recipe.title, recipe.ingredients, recipe.steps]
      )
      sendJson(res, 201, result.rows[0])
      return
    }

    // /api/recipes/:id (PUT, DELETE)
    const idMatch = pathname.match(/^\/api\/recipes\/(.+)$/)
    if (idMatch) {
      const rawId = idMatch[1]
      if (!/^\d+$/.test(rawId)) {
        sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
        return
      }
      const id = Number(rawId)

      // 3. PUT /api/recipes/:id -> 수정
      if (method === 'PUT') {
        let body
        try {
          body = await parseBody(req)
        } catch {
          sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
          return
        }
        const recipe = normalizeRecipe(body)
        if (recipe.error) {
          sendJson(res, 400, { error: recipe.error })
          return
        }
        const result = await pool.query(
          `UPDATE simple_recipes
           SET title = $1, ingredients = $2, steps = $3
           WHERE id = $4
           RETURNING id, title, ingredients, steps, created_at`,
          [recipe.title, recipe.ingredients, recipe.steps, id]
        )
        if (result.rowCount === 0) {
          sendJson(res, 404, { error: '해당 레시피를 찾을 수 없습니다' })
          return
        }
        sendJson(res, 200, result.rows[0])
        return
      }

      // 4. DELETE /api/recipes/:id -> 삭제
      if (method === 'DELETE') {
        const result = await pool.query('DELETE FROM simple_recipes WHERE id = $1', [id])
        if (result.rowCount === 0) {
          sendJson(res, 404, { error: '해당 레시피를 찾을 수 없습니다' })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // 레시피 경로지만 매칭 안 되는 메서드
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

// 초기화(테이블 생성)가 끝난 뒤 listen 시작
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
