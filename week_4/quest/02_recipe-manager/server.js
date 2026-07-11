// Supabase Postgres 를 저장소로 쓰는 냉장고 재료 & 레시피 관리 서버
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
// 환경변수에 trailing newline 등이 붙는 경우가 있어 trim 적용
const connectionString = (process.env.DATABASE_URL || '').trim()

// DB 연결 풀
// Supabase 풀러는 SSL 이 필요하므로 ssl 옵션을 반드시 지정
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

// 시드 데이터 (재료 테이블이 비어 있을 때 한 번만 입력)
// expiry(유통기한) 는 비워서(null) 입력한다
const seedIngredients = [
  { name: '계란', quantity: '6개', category: '냉장' },
  { name: '밥', quantity: '2공기', category: '냉장' },
  { name: '라면', quantity: '2개', category: '실온' },
  { name: '김치', quantity: '1/2포기', category: '냉장' },
  { name: '대파', quantity: '2대', category: '냉장' },
  { name: '스팸', quantity: '1캔', category: '실온' },
]

// 테이블 생성 + (비어 있으면) 시드 입력
async function initDB() {
  // ingredients(재료) 테이블이 없으면 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w4_recipe_ingredients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity TEXT,
      category TEXT,
      expiry DATE,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  // recipes(레시피) 테이블이 없으면 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w4_recipe_recipes (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT,
      steps TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  // 재료가 0건이면 시드 6개 입력 (한 번만). expiry 는 null 로 둔다
  const countResult = await pool.query('SELECT count(*) AS cnt FROM harbor_w4_recipe_ingredients')
  const count = Number(countResult.rows[0].cnt)
  if (count === 0) {
    for (const item of seedIngredients) {
      await pool.query(
        'INSERT INTO harbor_w4_recipe_ingredients (name, quantity, category, expiry) VALUES ($1, $2, $3, $4)',
        [item.name, item.quantity, item.category, null]
      )
    }
    console.log(`재료 시드 데이터 ${seedIngredients.length}건을 입력했습니다`)
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

// 빈 문자열/공백을 null 로 정규화 (expiry 등 선택값 처리용)
function normalizeOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// ========================================
// 재료(ingredients) 라우팅
// ========================================
async function handleIngredients(req, res, url, pathname) {
  const { method } = req

  // 1. GET /api/ingredients?q=&category= -> 검색 + 카테고리 필터, 최신순
  if (method === 'GET' && pathname === '/api/ingredients') {
    const rawQuery = url.searchParams.get('q')
    const keyword = typeof rawQuery === 'string' ? rawQuery.trim() : ''
    const rawCategory = url.searchParams.get('category')
    const category = typeof rawCategory === 'string' ? rawCategory.trim() : ''

    // 동적으로 WHERE 절을 조립한다 (파라미터 바인딩으로 SQL 인젝션 방지)
    const conditions = []
    const params = []
    if (keyword !== '') {
      params.push(`%${keyword}%`)
      conditions.push(`name ILIKE $${params.length}`)
    }
    if (category !== '') {
      params.push(category)
      conditions.push(`category = $${params.length}`)
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const result = await pool.query(
      `SELECT id, name, quantity, category, expiry, created_at
       FROM harbor_w4_recipe_ingredients ${whereClause}
       ORDER BY created_at DESC, id DESC`,
      params
    )
    sendJson(res, 200, result.rows)
    return true
  }

  // 2. POST /api/ingredients -> 새 재료 생성
  if (method === 'POST' && pathname === '/api/ingredients') {
    let body
    try {
      body = await parseBody(req)
    } catch (err) {
      sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
      return true
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name === '') {
      sendJson(res, 400, { error: 'name 은 필수이며 공백일 수 없습니다' })
      return true
    }
    // 나머지는 선택값: 빈 문자열이면 null 로 저장
    const quantity = normalizeOrNull(body.quantity)
    const category = normalizeOrNull(body.category)
    const expiry = normalizeOrNull(body.expiry)
    const result = await pool.query(
      `INSERT INTO harbor_w4_recipe_ingredients (name, quantity, category, expiry)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, quantity, category, expiry, created_at`,
      [name, quantity, category, expiry]
    )
    sendJson(res, 201, result.rows[0])
    return true
  }

  // /api/ingredients/:id 형태 매칭 (PUT, DELETE)
  const idMatch = pathname.match(/^\/api\/ingredients\/(.+)$/)
  if (idMatch) {
    const rawId = idMatch[1]
    // :id 는 숫자만 허용
    if (!/^\d+$/.test(rawId)) {
      sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
      return true
    }
    const id = Number(rawId)

    // 3. PUT /api/ingredients/:id -> 재료 수정
    if (method === 'PUT') {
      let body
      try {
        body = await parseBody(req)
      } catch (err) {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return true
      }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '') {
        sendJson(res, 400, { error: 'name 은 필수이며 공백일 수 없습니다' })
        return true
      }
      const quantity = normalizeOrNull(body.quantity)
      const category = normalizeOrNull(body.category)
      const expiry = normalizeOrNull(body.expiry)
      const result = await pool.query(
        `UPDATE harbor_w4_recipe_ingredients
         SET name = $1, quantity = $2, category = $3, expiry = $4
         WHERE id = $5
         RETURNING id, name, quantity, category, expiry, created_at`,
        [name, quantity, category, expiry, id]
      )
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 재료를 찾을 수 없습니다' })
        return true
      }
      sendJson(res, 200, result.rows[0])
      return true
    }

    // 4. DELETE /api/ingredients/:id -> 삭제
    if (method === 'DELETE') {
      const result = await pool.query('DELETE FROM harbor_w4_recipe_ingredients WHERE id = $1', [id])
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 재료를 찾을 수 없습니다' })
        return true
      }
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // 재료 라우트로 처리되지 않음
  return false
}

// ========================================
// 레시피(recipes) 라우팅
// ========================================
async function handleRecipes(req, res, url, pathname) {
  const { method } = req

  // 1. GET /api/recipes?q= -> 제목 또는 재료 검색, 최신순
  if (method === 'GET' && pathname === '/api/recipes') {
    const rawQuery = url.searchParams.get('q')
    const keyword = typeof rawQuery === 'string' ? rawQuery.trim() : ''
    if (keyword !== '') {
      const result = await pool.query(
        `SELECT id, title, ingredients, steps, created_at
         FROM harbor_w4_recipe_recipes
         WHERE title ILIKE $1 OR ingredients ILIKE $1
         ORDER BY created_at DESC, id DESC`,
        [`%${keyword}%`]
      )
      sendJson(res, 200, result.rows)
      return true
    }
    const result = await pool.query(
      `SELECT id, title, ingredients, steps, created_at
       FROM harbor_w4_recipe_recipes
       ORDER BY created_at DESC, id DESC`
    )
    sendJson(res, 200, result.rows)
    return true
  }

  // 2. POST /api/recipes -> 새 레시피 생성
  if (method === 'POST' && pathname === '/api/recipes') {
    let body
    try {
      body = await parseBody(req)
    } catch (err) {
      sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
      return true
    }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title === '') {
      sendJson(res, 400, { error: 'title 은 필수이며 공백일 수 없습니다' })
      return true
    }
    // 재료/조리법은 선택값: 문자열이 아니면 빈 문자열로 처리
    const ingredients = typeof body.ingredients === 'string' ? body.ingredients : ''
    const steps = typeof body.steps === 'string' ? body.steps : ''
    const result = await pool.query(
      `INSERT INTO harbor_w4_recipe_recipes (title, ingredients, steps)
       VALUES ($1, $2, $3)
       RETURNING id, title, ingredients, steps, created_at`,
      [title, ingredients, steps]
    )
    sendJson(res, 201, result.rows[0])
    return true
  }

  // /api/recipes/:id 형태 매칭 (PUT, DELETE)
  const idMatch = pathname.match(/^\/api\/recipes\/(.+)$/)
  if (idMatch) {
    const rawId = idMatch[1]
    // :id 는 숫자만 허용
    if (!/^\d+$/.test(rawId)) {
      sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
      return true
    }
    const id = Number(rawId)

    // 3. PUT /api/recipes/:id -> 레시피 수정
    if (method === 'PUT') {
      let body
      try {
        body = await parseBody(req)
      } catch (err) {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return true
      }
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (title === '') {
        sendJson(res, 400, { error: 'title 은 필수이며 공백일 수 없습니다' })
        return true
      }
      const ingredients = typeof body.ingredients === 'string' ? body.ingredients : ''
      const steps = typeof body.steps === 'string' ? body.steps : ''
      const result = await pool.query(
        `UPDATE harbor_w4_recipe_recipes
         SET title = $1, ingredients = $2, steps = $3
         WHERE id = $4
         RETURNING id, title, ingredients, steps, created_at`,
        [title, ingredients, steps, id]
      )
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 레시피를 찾을 수 없습니다' })
        return true
      }
      sendJson(res, 200, result.rows[0])
      return true
    }

    // 4. DELETE /api/recipes/:id -> 삭제
    if (method === 'DELETE') {
      const result = await pool.query('DELETE FROM harbor_w4_recipe_recipes WHERE id = $1', [id])
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 레시피를 찾을 수 없습니다' })
        return true
      }
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // 레시피 라우트로 처리되지 않음
  return false
}

// ========================================
// 전체 라우팅
// ========================================
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // 재료 API 먼저 시도
  if (pathname.startsWith('/api/ingredients')) {
    const handled = await handleIngredients(req, res, url, pathname)
    if (handled) return
  }

  // 레시피 API 시도
  if (pathname.startsWith('/api/recipes')) {
    const handled = await handleRecipes(req, res, url, pathname)
    if (handled) return
  }

  // 그 외 GET -> index.html 정적 서빙
  if (method === 'GET' && !pathname.startsWith('/api/')) {
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
