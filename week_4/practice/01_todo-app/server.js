// Node.js 표준 http 모듈만 사용하는 todo 서버 (외부 의존성 없음)
// txt 파일을 DB처럼 사용한다: todo_<id>.txt 파일 1개 = todo 1개
// 실행: node server.js  (포트 3000)
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3000
// 이 서버 파일이 위치한 폴더 기준으로 동작
const baseDir = __dirname

// 파일명에서 id 정수를 뽑아내는 정규식 (todo_<정수>.txt)
const fileNameRe = /^todo_(\d+)\.txt$/

// 파일 내용을 파싱해 done/text로 분리한다
// "[x] ..." -> done=true, "[ ] ..." -> done=false
// 마커가 없는 기존 파일은 미완료로 간주하고 전체를 text로 사용
function parseTodoContent(content) {
  const trimmed = content.trim()
  if (trimmed.startsWith('[x] ')) {
    return { done: true, text: trimmed.slice(4) }
  }
  if (trimmed.startsWith('[ ] ')) {
    return { done: false, text: trimmed.slice(4) }
  }
  // 마커가 없는 무포맷 파일
  return { done: false, text: trimmed }
}

// done/text를 파일에 저장할 문자열로 만든다 (항상 마커를 붙여 정규화)
function formatTodoContent(text, done) {
  return `${done ? '[x] ' : '[ ] '}${text}`
}

// id에 해당하는 파일의 절대 경로를 만든다 (id는 정수만 허용되므로 안전)
function todoFilePath(id) {
  return path.join(baseDir, `todo_${id}.txt`)
}

// 디렉토리를 스캔해 todo_<id>.txt 파일을 읽어 todo 배열로 만든다
// 요청마다 호출하므로 서버 재시작 없이 txt 변경이 반영된다
// 반환: [{ id, text, done }, ...] id 오름차순 정렬
function readTodos() {
  const todos = fs
    .readdirSync(baseDir)
    .map((name) => {
      const match = name.match(fileNameRe)
      if (!match) return null
      const id = parseInt(match[1], 10)
      const content = fs.readFileSync(path.join(baseDir, name), 'utf-8')
      const parsed = parseTodoContent(content)
      return { id, text: parsed.text, done: parsed.done }
    })
    .filter((todo) => todo !== null)
    .sort((a, b) => a.id - b.id)

  return todos
}

// 현재 존재하는 todo 중 최대 id + 1을 반환한다 (없으면 1)
function nextTodoId() {
  const todos = readTodos()
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
  // GET /api/todos -> todo JSON 배열 응답 (요청마다 디렉토리 스캔)
  if (req.method === 'GET' && req.url === '/api/todos') {
    try {
      sendJson(res, 200, readTodos())
    } catch (err) {
      // 파일 읽기 실패 등 서버 에러 처리
      sendJson(res, 500, { success: false, message: '할 일 목록을 읽지 못했습니다' })
    }
    return
  }

  // POST /api/todos -> 새 todo 파일 생성
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
        const id = nextTodoId()
        // 새 todo는 항상 미완료로 생성
        fs.writeFileSync(todoFilePath(id), formatTodoContent(text, false), 'utf-8')
        sendJson(res, 201, { id, text, done: false })
      } catch (writeErr) {
        sendJson(res, 500, { success: false, message: '할 일을 추가하지 못했습니다' })
      }
    })
    return
  }

  // PATCH /api/todos/:id -> done 상태만 갱신 (text는 기존 유지)
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
      const filePath = todoFilePath(id)
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { success: false, message: '할 일을 찾을 수 없습니다' })
        return
      }
      try {
        // 기존 text는 유지하고 마커만 done에 맞게 다시 써서 저장
        const parsed = parseTodoContent(fs.readFileSync(filePath, 'utf-8'))
        fs.writeFileSync(filePath, formatTodoContent(parsed.text, body.done), 'utf-8')
        sendJson(res, 200, { id, text: parsed.text, done: body.done })
      } catch (writeErr) {
        sendJson(res, 500, { success: false, message: '할 일을 수정하지 못했습니다' })
      }
    })
    return
  }

  // DELETE /api/todos/:id -> 파일 삭제
  const deleteMatch = req.url.match(/^\/api\/todos\/(.+)$/)
  if (req.method === 'DELETE' && deleteMatch) {
    // id는 숫자만 허용 (경로 조작 방지)
    if (!/^\d+$/.test(deleteMatch[1])) {
      sendJson(res, 400, { success: false, message: 'id는 숫자여야 합니다' })
      return
    }
    const id = parseInt(deleteMatch[1], 10)
    const filePath = todoFilePath(id)
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { success: false, message: '할 일을 찾을 수 없습니다' })
      return
    }
    try {
      fs.unlinkSync(filePath)
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
