// Supabase Postgres 를 저장소로 쓰는 메모장 서버
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

// 시드 데이터 (테이블이 비어 있을 때 한 번만 입력)
// 제목 + 내용 쌍의 메모 3개
const seedMemos = [
  { title: '장보기 목록', content: '계란, 우유, 두부, 시금치' },
  { title: '주말 할 일', content: '방 청소하기, 빨래 돌리기, 강아지 산책 시키기' },
  { title: '아이디어 메모', content: '메모장 앱에 태그 기능과 즐겨찾기 추가해보기' },
]

// 테이블 생성 + (비어 있으면) 시드 입력
async function initDB() {
  // memos 테이블이 없으면 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w4_memo_memos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // 데이터가 0건이면 시드 3개 입력 (한 번만)
  // created_at 은 DEFAULT now() 에 맡긴다
  const countResult = await pool.query('SELECT count(*) AS cnt FROM harbor_w4_memo_memos')
  const count = Number(countResult.rows[0].cnt)
  if (count === 0) {
    for (const memo of seedMemos) {
      await pool.query('INSERT INTO harbor_w4_memo_memos (title, content) VALUES ($1, $2)', [memo.title, memo.content])
    }
    console.log(`시드 데이터 ${seedMemos.length}건을 입력했습니다`)
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

// 라우팅
async function handleRequest(req, res) {
  const { method } = req
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // 1. GET /api/memos -> 목록 조회 (검색 지원, 최신순)
  if (method === 'GET' && pathname === '/api/memos') {
    // 쿼리스트링 q 가 있고 공백 제거 후 비어있지 않으면 검색
    const rawQuery = url.searchParams.get('q')
    const keyword = typeof rawQuery === 'string' ? rawQuery.trim() : ''
    if (keyword !== '') {
      // 제목 또는 내용에 검색어가 포함된 메모만 (대소문자 무시 ILIKE)
      const result = await pool.query(
        'SELECT id, title, content, created_at FROM harbor_w4_memo_memos WHERE title ILIKE $1 OR content ILIKE $1 ORDER BY created_at DESC, id DESC',
        [`%${keyword}%`]
      )
      sendJson(res, 200, result.rows)
      return
    }
    // q 없으면 전체 조회
    const result = await pool.query(
      'SELECT id, title, content, created_at FROM harbor_w4_memo_memos ORDER BY created_at DESC, id DESC'
    )
    sendJson(res, 200, result.rows)
    return
  }

  // 2. POST /api/memos -> 새 메모 생성
  if (method === 'POST' && pathname === '/api/memos') {
    let body
    try {
      body = await parseBody(req)
    } catch (err) {
      sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
      return
    }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title === '') {
      sendJson(res, 400, { error: 'title 은 필수이며 공백일 수 없습니다' })
      return
    }
    // content 는 선택값: 문자열이 아니면 빈 문자열로 처리
    const content = typeof body.content === 'string' ? body.content : ''
    const result = await pool.query(
      'INSERT INTO harbor_w4_memo_memos (title, content) VALUES ($1, $2) RETURNING id, title, content, created_at',
      [title, content]
    )
    sendJson(res, 201, result.rows[0])
    return
  }

  // /api/memos/:id 형태 매칭 (PUT, DELETE)
  const memoIdMatch = pathname.match(/^\/api\/memos\/(.+)$/)
  if (memoIdMatch) {
    const rawId = memoIdMatch[1]
    // :id 는 숫자만 허용
    if (!/^\d+$/.test(rawId)) {
      sendJson(res, 400, { error: 'id 는 숫자여야 합니다' })
      return
    }
    const id = Number(rawId)

    // 3. PUT /api/memos/:id -> 메모 수정 (보너스)
    if (method === 'PUT') {
      let body
      try {
        body = await parseBody(req)
      } catch (err) {
        sendJson(res, 400, { error: '잘못된 JSON 형식입니다' })
        return
      }
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (title === '') {
        sendJson(res, 400, { error: 'title 은 필수이며 공백일 수 없습니다' })
        return
      }
      // content 는 선택값: 문자열이 아니면 빈 문자열로 처리
      const content = typeof body.content === 'string' ? body.content : ''
      const result = await pool.query(
        'UPDATE harbor_w4_memo_memos SET title = $1, content = $2 WHERE id = $3 RETURNING id, title, content, created_at',
        [title, content, id]
      )
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 메모를 찾을 수 없습니다' })
        return
      }
      sendJson(res, 200, result.rows[0])
      return
    }

    // 4. DELETE /api/memos/:id -> 삭제
    if (method === 'DELETE') {
      const result = await pool.query('DELETE FROM harbor_w4_memo_memos WHERE id = $1', [id])
      if (result.rowCount === 0) {
        sendJson(res, 404, { error: '해당 메모를 찾을 수 없습니다' })
        return
      }
      sendJson(res, 200, { ok: true })
      return
    }
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
