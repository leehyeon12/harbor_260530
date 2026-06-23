// webserver-01 정적 파일 서버
// Node 내장 모듈(http, fs, path)만 사용 — npm 의존성 없음
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3000
const ROOT = __dirname

// 확장자별 Content-Type 매핑
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// 요청 경로 → 안전한 실제 파일 경로로 변환 (디렉터리 밖 접근 차단)
function resolvePath(reqUrl) {
  // 쿼리스트링 제거 후 디코드, '/'는 index.html 로
  const urlPath = decodeURIComponent(reqUrl.split('?')[0])
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const filePath = path.join(ROOT, relative)
  // ROOT 밖으로 벗어나면 null
  if (!filePath.startsWith(ROOT)) return null
  return filePath
}

const server = http.createServer((req, res) => {
  const filePath = resolvePath(req.url)

  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('403 Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`서버 실행 중 → http://localhost:${PORT}`)
})
