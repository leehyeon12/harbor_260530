// ============================================================
// AI 레시피 생성앱 서버 (냉장고 재료 기반)
// ------------------------------------------------------------
// Q2(02_recipe-manager) 아키텍처를 그대로 계승한다:
//   - 표준 node:http 모듈 + pg(node-postgres) 만 사용 (Express/프레임워크 없음)
//   - 응답은 raw row 객체/배열을 그대로 반환 ({success,data} 래핑 안 함)
//   - process.loadEnvFile() 로 .env 로드, PORT=3000, initDB() 후 listen
//
// Q2 대비 추가된 것:
//   - recipes 테이블에 확장 컬럼 4개 (cook_time/difficulty/style/thumbnail_url)
//   - POST /api/generate-recipe : 냉장고 재료 → OpenAI → 레시피 미리보기 반환
//     (about-me-app 의 callOpenAI 프록시 패턴을 재사용)
//
// AI 생성 흐름:  브라우저 → server.js → OpenAI API → server.js → 브라우저
//   프론트는 OpenAI 를 직접 부르지 않는다. 서버가 대신 호출한다.
//   이유: OPENAI_API_KEY 를 서버에만 두고 브라우저에 절대 노출하지 않기 위함.
// ============================================================

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { Pool } = require('pg')

// .env 로드: Node 내장 기능 사용 (외부 패키지 없이)
// .env 가 없거나 형식이 잘못돼도 서버는 계속 진행한다
try {
  process.loadEnvFile()
} catch (err) {
  console.warn('.env 파일을 불러오지 못했습니다 (무시하고 진행):', err.message)
}

const PORT = 3000

// OpenAI 챗 완성(chat completions) 설정
// MODEL 한 줄만 바꾸면 사용 모델을 교체할 수 있다
const MODEL = 'gpt-4o-mini'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

// 환경변수에 trailing newline 등이 붙는 경우가 있어 trim 적용
const connectionString = (process.env.DATABASE_URL || '').trim()

// DB 연결 풀
// Supabase 풀러는 SSL 이 필요하므로 ssl 옵션을 반드시 지정한다
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

// 시드 데이터 (재료 테이블이 비어 있을 때 한 번만 입력)
// expiry(유통기한) 는 비워서(null) 입력한다 — Q2 와 동일한 6개
const seedIngredients = [
  { name: '계란', quantity: '6개', category: '냉장' },
  { name: '밥', quantity: '2공기', category: '냉장' },
  { name: '라면', quantity: '2개', category: '실온' },
  { name: '김치', quantity: '1/2포기', category: '냉장' },
  { name: '대파', quantity: '2대', category: '냉장' },
  { name: '스팸', quantity: '1캔', category: '실온' },
]

// ============================================================
// 테이블 생성 + (비어 있으면) 시드 입력
// ------------------------------------------------------------
// recipes 테이블은 Q2 에서 이미 생성돼 있을 수 있으므로,
// 먼저 기본 형태로 CREATE IF NOT EXISTS 한 뒤
// 확장 컬럼은 ALTER TABLE ... ADD COLUMN IF NOT EXISTS 로 하나씩 추가한다.
// (이미 있으면 무시되므로 기존 데이터가 그대로 보존된다)
// ============================================================
async function initDB() {
  // ingredients(재료) 테이블이 없으면 생성 — Q2 그대로
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity TEXT,
      category TEXT,
      expiry DATE,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  // recipes(레시피) 테이블이 없으면 기본 형태로 생성 — Q2 컬럼 구성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT,
      steps TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  // recipes 확장 컬럼 4개를 각각 추가 (이미 있으면 무시됨)
  await pool.query('ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cook_time TEXT')
  await pool.query('ALTER TABLE recipes ADD COLUMN IF NOT EXISTS difficulty TEXT')
  await pool.query('ALTER TABLE recipes ADD COLUMN IF NOT EXISTS style TEXT')
  await pool.query('ALTER TABLE recipes ADD COLUMN IF NOT EXISTS thumbnail_url TEXT')

  // 재료가 0건이면 시드 6개 입력 (한 번만). expiry 는 null 로 둔다
  const countResult = await pool.query('SELECT count(*) AS cnt FROM ingredients')
  const count = Number(countResult.rows[0].cnt)
  if (count === 0) {
    for (const item of seedIngredients) {
      await pool.query(
        'INSERT INTO ingredients (name, quantity, category, expiry) VALUES ($1, $2, $3, $4)',
        [item.name, item.quantity, item.category, null]
      )
    }
    console.log(`재료 시드 데이터 ${seedIngredients.length}건을 입력했습니다`)
  }
}

// ============================================================
// 공통 헬퍼
// ============================================================

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

// ============================================================
// OpenAI 호출 함수 (about-me-app 패턴 재사용)
// ------------------------------------------------------------
// Node 18+ 에는 전역 fetch 가 내장돼 있어 이를 우선 사용하고,
// fetch 가 없는 런타임(구버전 Node)에서는 내장 https 모듈로 폴백한다.
//
// 인자:
//   apiKey        : OpenAI API 키 (Authorization 헤더에 실음)
//   systemPrompt  : 시스템 프롬프트 (요리사 캐릭터 + 답변 규칙)
//   userPrompt    : 사용자 프롬프트 (냉장고 재료 + 요청 옵션)
// 반환: Promise<{ status, body }>
//   status = OpenAI 의 HTTP 상태코드, body = 응답 문자열(JSON)
// ============================================================
function callOpenAI(apiKey, systemPrompt, userPrompt) {
  // OpenAI 에 보낼 요청 본문 (JSON 문자열로 직렬화)
  const payload = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    // 모델이 반드시 JSON 객체로만 답하도록 강제 (파싱 실패 방지)
    response_format: { type: 'json_object' },
  })

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  // --- 경로 1: 내장 fetch 사용 (Node 18+) ---
  if (typeof fetch !== 'undefined') {
    return fetch(OPENAI_URL, {
      method: 'POST',
      headers,
      body: payload,
    }).then((res) => res.text().then((body) => ({ status: res.status, body })))
  }

  // --- 경로 2: 내장 https 모듈로 폴백 ---
  const https = require('node:https')
  return new Promise((resolve, reject) => {
    const req = https.request(
      OPENAI_URL,
      {
        method: 'POST',
        // https.request 에는 본문 바이트 길이를 알려줘야 안전하다
        headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data })
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.write(payload) // 본문 전송
    req.end()
  })
}

// OpenAI 상태코드 → 사람이 읽기 좋은 한국어 메시지로 변환
// (200 이 아닐 때 502 로 내려줄 메시지를 만든다)
function describeOpenAIError(status) {
  if (status === 401) return 'API 키가 올바르지 않습니다. .env 의 OPENAI_API_KEY 를 확인하세요.'
  if (status === 429) return 'API 호출 한도를 초과했습니다. 잠시 후 다시 시도하세요.'
  return `AI 응답 오류 (상태코드: ${status})`
}

// ============================================================
// 재료(ingredients) 라우팅 — Q2 그대로
// ============================================================
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
       FROM ingredients ${whereClause}
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
      `INSERT INTO ingredients (name, quantity, category, expiry)
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
        `UPDATE ingredients
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
      const result = await pool.query('DELETE FROM ingredients WHERE id = $1', [id])
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

// ============================================================
// 레시피(recipes) 라우팅 — Q2 복사 + 확장 컬럼 포함
// ------------------------------------------------------------
// SELECT/INSERT/RETURNING 에 cook_time, difficulty, style, thumbnail_url 을 추가했다.
// PUT 은 title/ingredients/steps 만 수정하고 확장 컬럼은 건드리지 않는다(유지).
// ============================================================
async function handleRecipes(req, res, url, pathname) {
  const { method } = req

  // 1. GET /api/recipes?q= -> 제목 또는 재료 검색, 최신순
  if (method === 'GET' && pathname === '/api/recipes') {
    const rawQuery = url.searchParams.get('q')
    const keyword = typeof rawQuery === 'string' ? rawQuery.trim() : ''
    if (keyword !== '') {
      const result = await pool.query(
        `SELECT id, title, ingredients, steps, cook_time, difficulty, style, thumbnail_url, created_at
         FROM recipes
         WHERE title ILIKE $1 OR ingredients ILIKE $1
         ORDER BY created_at DESC, id DESC`,
        [`%${keyword}%`]
      )
      sendJson(res, 200, result.rows)
      return true
    }
    const result = await pool.query(
      `SELECT id, title, ingredients, steps, cook_time, difficulty, style, thumbnail_url, created_at
       FROM recipes
       ORDER BY created_at DESC, id DESC`
    )
    sendJson(res, 200, result.rows)
    return true
  }

  // 2. POST /api/recipes -> 새 레시피 생성 (확장 컬럼 포함)
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
    // 확장 컬럼은 없으면 null 로 저장
    const cookTime = normalizeOrNull(body.cook_time)
    const difficulty = normalizeOrNull(body.difficulty)
    const style = normalizeOrNull(body.style)
    const thumbnailUrl = normalizeOrNull(body.thumbnail_url)
    const result = await pool.query(
      `INSERT INTO recipes (title, ingredients, steps, cook_time, difficulty, style, thumbnail_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, ingredients, steps, cook_time, difficulty, style, thumbnail_url, created_at`,
      [title, ingredients, steps, cookTime, difficulty, style, thumbnailUrl]
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

    // 3. PUT /api/recipes/:id -> 레시피 수정 (title/ingredients/steps 만, 확장 컬럼은 유지)
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
      // 확장 컬럼(cook_time 등)은 SET 에서 제외 → 기존 값이 그대로 유지된다.
      // RETURNING 에는 포함해 프론트가 최신 전체 row 를 받게 한다.
      const result = await pool.query(
        `UPDATE recipes
         SET title = $1, ingredients = $2, steps = $3
         WHERE id = $4
         RETURNING id, title, ingredients, steps, cook_time, difficulty, style, thumbnail_url, created_at`,
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
      const result = await pool.query('DELETE FROM recipes WHERE id = $1', [id])
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

// ============================================================
// ★ AI 레시피 생성 라우팅 : POST /api/generate-recipe
// ------------------------------------------------------------
// 냉장고에 담긴 재료 전체를 읽어 OpenAI 에 보내고,
// 만들 수 있는 한국 가정식 레시피 1개를 JSON 으로 돌려받는다.
// DB 에 저장하지 않고 "미리보기용" 으로만 200 반환한다.
// (실제 저장은 프론트가 별도로 POST /api/recipes 를 호출한다)
// ============================================================
async function handleGenerateRecipe(req, res, pathname) {
  const { method } = req

  // POST /api/generate-recipe 만 처리
  if (method !== 'POST' || pathname !== '/api/generate-recipe') {
    return false
  }

  // (1) 요청 본문 파싱 — style 옵션만 받는다 (없을 수 있음)
  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
    return true
  }
  const style = typeof body.style === 'string' ? body.style.trim() : ''

  // (2) 냉장고 재료 전체 조회 (이름 + 수량)
  const ingResult = await pool.query('SELECT name, quantity FROM ingredients')
  if (ingResult.rows.length === 0) {
    sendJson(res, 400, { error: '냉장고에 재료가 없습니다. 먼저 재료를 추가하세요.' })
    return true
  }

  // (3) API 키 확인 (코드에 하드코딩 금지, 환경변수에서만 읽음)
  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) {
    sendJson(res, 500, { error: 'OPENAI_API_KEY 환경변수가 없습니다. .env를 확인하세요.' })
    return true
  }

  // (4) 프롬프트 구성
  // 시스템 프롬프트: 요리사 캐릭터 + 출력 JSON 형식 강제
  const systemPrompt =
    '너는 자취생을 위한 요리사다. 주어진 냉장고 재료로 만들 수 있는 한국 가정식 레시피 1개를 제안한다. ' +
    '2인분·초보자 기준. 소금·기름·물·기본 양념은 있다고 가정한다. ' +
    '반드시 아래 JSON 형식으로만 답하라(마크다운 코드블록 금지):\n' +
    '{"title":"요리 이름","ingredients":"필요한 재료를 줄바꿈으로 나열",' +
    '"steps":"조리 순서를 1. 2. 3. 번호로 줄바꿈 나열",' +
    '"cook_time":"예상 조리시간 예: 15분","difficulty":"쉬움/보통/어려움 중 하나"}'

  // 재료명들을 쉼표로 연결 (수량은 참고용으로 이름 뒤에 붙임)
  const ingredientNames = ingResult.rows
    .map((row) => {
      const q = normalizeOrNull(row.quantity)
      return q ? `${row.name}(${q})` : row.name
    })
    .join(', ')

  // user 프롬프트: 냉장고 재료 + 요청 옵션
  let userPrompt = `냉장고 재료: ${ingredientNames}. 요청 옵션: ${style || '없음'}. 이 재료로 만들 요리 하나를 추천해줘.`

  // style 별 추가 지시를 user 프롬프트에 덧붙인다
  if (style === '간단요리') {
    userPrompt += ' 10분 내외, 최소 재료로 만들 수 있게 해줘.'
  } else if (style === '다이어트') {
    userPrompt += ' 저칼로리·담백하게 만들어줘.'
  } else if (style === '야식') {
    userPrompt += ' 간단한 야식/안주 느낌으로 만들어줘.'
  }

  // (5) OpenAI 호출
  let openai
  try {
    openai = await callOpenAI(apiKey, systemPrompt, userPrompt)
  } catch (err) {
    // 네트워크 실패 등 호출 자체가 안 된 경우 → 500
    sendJson(res, 500, { error: 'AI 호출에 실패했습니다: ' + err.message })
    return true
  }

  // OpenAI 가 200 이 아니면 상태코드별 메시지로 502 반환
  if (openai.status !== 200) {
    sendJson(res, 502, { error: describeOpenAIError(openai.status) })
    return true
  }

  // (6) 응답에서 레시피 JSON 만 꺼내 파싱
  // OpenAI 응답 구조: { choices: [ { message: { content: "<JSON 문자열>" } } ] }
  // content 는 "문자열" 이므로 한 번 더 JSON.parse 해야 객체가 된다.
  let recipe
  try {
    const openaiJson = JSON.parse(openai.body)
    const content = openaiJson.choices[0].message.content
    recipe = JSON.parse(content) // { title, ingredients, steps, cook_time, difficulty }
  } catch (err) {
    sendJson(res, 500, { error: 'AI 응답을 해석하지 못했습니다. 다시 시도해주세요.' })
    return true
  }

  // 파싱 결과에서 필요한 필드만 안전하게 추출 (문자열 아니면 빈 문자열)
  const title = typeof recipe.title === 'string' ? recipe.title.trim() : ''
  if (title === '') {
    sendJson(res, 500, { error: 'AI 가 요리 이름을 반환하지 않았습니다. 다시 시도해주세요.' })
    return true
  }
  const ingredients = typeof recipe.ingredients === 'string' ? recipe.ingredients : ''
  const steps = typeof recipe.steps === 'string' ? recipe.steps : ''
  const cookTime = typeof recipe.cook_time === 'string' ? recipe.cook_time : ''
  const difficulty = typeof recipe.difficulty === 'string' ? recipe.difficulty : ''

  // (7) 썸네일 URL 생성 (Pollinations 무료 이미지, API 키 불필요)
  const thumbnailUrl =
    'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(title + ' 음식 사진 고화질') +
    '?width=512&height=512&nologo=true'

  // (8) DB 에 저장하지 않고 미리보기용으로 200 반환
  //     저장은 프론트가 별도로 POST /api/recipes 를 호출한다.
  sendJson(res, 200, {
    title,
    ingredients,
    steps,
    cook_time: cookTime,
    difficulty,
    style: style || null,
    thumbnail_url: thumbnailUrl,
  })
  return true
}

// ============================================================
// 전체 라우팅
// ============================================================
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // AI 레시피 생성 API 먼저 시도 (고정 경로라 가장 먼저 매칭)
  if (pathname === '/api/generate-recipe') {
    const handled = await handleGenerateRecipe(req, res, pathname)
    if (handled) return
  }

  // 재료 API 시도
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

// 서버 생성: 모든 핸들러를 try/catch 로 감싸 DB/네트워크 오류 시 500 응답
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
