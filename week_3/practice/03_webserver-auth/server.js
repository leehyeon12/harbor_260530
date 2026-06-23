// 보안 학습 포인트: 실제 서비스에선 비밀번호를 평문 파일/응답으로 다루지 말 것 (암호화·해시·전용 시크릿 저장소 사용)
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3000

// pass.txt를 파싱해 { password, label, savedAt } 형태로 돌려주는 함수
// 매 요청마다 호출하므로 파일을 바꾸면 서버 재시작 없이 바로 반영됨 (캐싱하지 않음)
function readPassword() {
  const filePath = path.join(__dirname, 'pass.txt')

  // 파일 수정시각(mtime)을 "저장 시각"으로 사용 (못 구하면 현재시각)
  let savedAt = new Date().toISOString()
  try {
    savedAt = fs.statSync(filePath).mtime.toISOString()
  } catch (err) {
    // stat 실패 시 현재시각 유지
  }

  // 파일 내용 읽기 (실패하면 호출부에서 500 처리)
  const raw = fs.readFileSync(filePath, 'utf8')

  // 빈 줄/공백 줄을 무시하고 첫 유효 줄을 찾음
  let firstLine = ''
  for (const line of raw.split('\n')) {
    if (line.trim() !== '') {
      firstLine = line.trim()
      break
    }
  }
  if (firstLine === '') {
    throw new Error('비밀번호 파일에 유효한 내용이 없습니다.')
  }

  // '키=값' 형식이면 = 뒤를 password로, 키는 label로 / = 가 없으면 줄 전체를 password로
  const eqIndex = firstLine.indexOf('=')
  let label = null
  let password = firstLine
  if (eqIndex !== -1) {
    label = firstLine.slice(0, eqIndex).trim()
    password = firstLine.slice(eqIndex + 1).trim()
  }

  return { password, label, savedAt }
}

const server = http.createServer((req, res) => {
  // 라우트 1: index.html 정적 파일 서빙
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500)
        res.end('Error loading index.html')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(data)
    })

  // 라우트 2: pass.txt를 읽어 비밀번호를 JSON으로 응답 (프론트 계약: { password, savedAt })
  } else if (req.url === '/api/password') {
    try {
      const result = readPassword()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      // pass.txt가 없거나 읽기 실패하면 500 + 한국어 에러 메시지
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '비밀번호 파일을 읽을 수 없습니다: ' + err.message }))
    }

  // 그 외 경로: 404
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
})

server.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`)
})
