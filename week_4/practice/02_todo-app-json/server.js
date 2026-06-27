// Node.js 표준 http 모듈만 사용하는 todo 서버 (외부 의존성 없음)
// 단일 JSON 파일을 DB처럼 사용한다: todos.json 1개 = 전체 todo 배열
// 각 항목 포맷: { id: number, text: string, done: boolean }
// 실행: node server.js  (포트 3000)
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3000
// 이 서버 파일이 위치한 폴더 기준으로 동작
const baseDir = __dirname

// 저장소 파일 경로 (같은 폴더의 todos.json)
const dataFile = path.join(baseDir, 'todos.json')

// todos.json을 읽어 todo 배열로 반환한다
// 요청마다 호출하므로 서버 재시작 없이 파일 변경이 반영된다
// 파일이 없거나 비어있거나 파싱 실패 시 빈 배열로 간주 (서버가 죽지 않게 try/catch)
// 반환: [{ id, text, done }, ...] id 오름차순 정렬
function readTodos() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf-8').trim()
    if (raw === '') return []
    const parsed = JSON.parse(raw)
    // 혹시 배열이 아닌 값이 저장돼 있으면 빈 배열로 방어
    if (!Array.isArray(parsed)) return []
    return parsed.slice().sort((a, b) => a.id - b.id)
  } catch (err) {
    // 파일 없음 / 파싱 실패 등은 빈 배열로 처리
    return []
  }
}

// 전체 todo 배열을 todos.json에 저장한다 (사람이 읽기 좋게 들여쓰기 2칸)
function writeTodos(todos) {
  fs.writeFileSync(dataFile, JSON.stringify(todos, null, 2), 'utf-8')
}

// 현재 배열 기준 최대 id + 1을 반환한다 (배열이 비면 1)
function nextTodoId(todos) {
  if (todos.length === 0) return 1
  const maxId = todos.reduce((max, todo) => (todo.id > max ? todo.id : max), 0)
  return maxId + 1
}

// 요청 본문(JSON)을 모아서 파싱한다
// 잘못된 JSON이면 콜백 첫 인자에 에러를 넘긴다
function readJsonBody(req, callback) {
  let raw = ''
  req.on('data', (chunk) => {
    raw += chunk
  })
  req.on('end', () => {
    // 본문이 비어 있으면 빈 객체로 처리
    if (raw.trim() === '') {
      callback(null, {})
      return
    }
    try {
      callback(null, JSON.parse(raw))
    } catch (err) {
      callback(err)
    }
  })
  req.on('error', (err) => callback(err))
}

// JSON 응답 헬퍼 (UTF-8)
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

const server = http.createServer((req, res) => {
  // GET /api/todos -> todo JSON 배열 응답 (요청마다 todos.json 읽기)
  if (req.method === 'GET' && req.url === '/api/todos') {
    try {
      sendJson(res, 200, readTodos())
    } catch (err) {
      // 예기치 못한 서버 에러 처리
      sendJson(res, 500, { success: false, message: '할 일 목록을 읽지 못했습니다' })
    }
    return
  }

  // POST /api/todos -> 새 todo를 배열에 추가하고 저장
  if (req.method === 'POST' && req.url === '/api/todos') {
    readJsonBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { success: false, message: '잘못된 JSON 형식입니다' })
        return
      }
      // text 유효성 검사 (문자열 + 공백 제거 후 비어있지 않아야 함)
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '') {
        sendJson(res, 400, { success: false, message: 'text가 비어 있습니다' })
        return
      }
      try {
        const todos = readTodos()
        const id = nextTodoId(todos)
        // 새 todo는 항상 미완료로 생성
        const todo = { id, text, done: false }
        todos.push(todo)
        writeTodos(todos)
        sendJson(res, 201, todo)
      } catch (writeErr) {
        sendJson(res, 500, { success: false, message: '할 일을 추가하지 못했습니다' })
      }
    })
    return
  }

  // PATCH /api/todos/:id -> 해당 id 항목의 done 상태만 갱신 (text는 기존 유지)
  const patchMatch = req.url.match(/^\/api\/todos\/(.+)$/)
  if (req.method === 'PATCH' && patchMatch) {
    // id는 숫자만 허용 (경로 조작 방지)
    if (!/^\d+$/.test(patchMatch[1])) {
      sendJson(res, 400, { success: false, message: 'id는 숫자여야 합니다' })
      return
    }
    const id = parseInt(patchMatch[1], 10)
    readJsonBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { success: false, message: '잘못된 JSON 형식입니다' })
        return
      }
      if (typeof body.done !== 'boolean') {
        sendJson(res, 400, { success: false, message: 'done은 boolean이어야 합니다' })
        return
      }
      try {
        const todos = readTodos()
        const todo = todos.find((item) => item.id === id)
        if (!todo) {
          sendJson(res, 404, { success: false, message: '할 일을 찾을 수 없습니다' })
          return
        }
        // 기존 text는 유지하고 done만 갱신해 저장
        todo.done = body.done
        writeTodos(todos)
        sendJson(res, 200, { id: todo.id, text: todo.text, done: todo.done })
      } catch (writeErr) {
        sendJson(res, 500, { success: false, message: '할 일을 수정하지 못했습니다' })
      }
    })
    return
  }

  // DELETE /api/todos/:id -> 해당 id 항목을 배열에서 제거하고 저장
  const deleteMatch = req.url.match(/^\/api\/todos\/(.+)$/)
  if (req.method === 'DELETE' && deleteMatch) {
    // id는 숫자만 허용 (경로 조작 방지)
    if (!/^\d+$/.test(deleteMatch[1])) {
      sendJson(res, 400, { success: false, message: 'id는 숫자여야 합니다' })
      return
    }
    const id = parseInt(deleteMatch[1], 10)
    try {
      const todos = readTodos()
      const index = todos.findIndex((item) => item.id === id)
      if (index === -1) {
        sendJson(res, 404, { success: false, message: '할 일을 찾을 수 없습니다' })
        return
      }
      todos.splice(index, 1)
      writeTodos(todos)
      sendJson(res, 200, { ok: true })
    } catch (deleteErr) {
      sendJson(res, 500, { success: false, message: '할 일을 삭제하지 못했습니다' })
    }
    return
  }

  // 그 외 GET 경로는 index.html을 정적 서빙
  try {
    const html = fs.readFileSync(path.join(baseDir, 'index.html'), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  } catch (err) {
    // index.html이 아직 없을 때를 대비한 안내 응답
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>index.html을 찾을 수 없습니다</h1>')
  }
})

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`)
})
