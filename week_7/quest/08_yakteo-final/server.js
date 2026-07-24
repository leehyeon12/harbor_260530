// ========================================
// 로컬 개발 서버 (Vercel 배포에는 사용되지 않음)
// ----------------------------------------
// 배포 환경(Vercel)에서는 api/clinics.js·api/pharmacies.js 가 서버리스 함수로,
// index.html 이 정적 파일로 자동 서빙된다. 이 파일은 그 구조를 로컬에서 그대로
// 흉내 내기 위한 얇은 개발 서버다 — API 로직은 api/*.js 와 100% 공유한다.
//
// 실행: node --env-file=.env server.js   (Node v20.6+ / .env 의 SERVICE_KEY 로드)
// 외부 패키지 0개: node:http, node:fs, node:path, node:url 만 사용.
// ========================================
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { URL } = require('node:url')

// Vercel 서버리스 함수와 동일한 핸들러를 그대로 require 해서 재사용
const clinicsHandler = require('./api/clinics')
const pharmaciesHandler = require('./api/pharmacies')
const doctorsHandler = require('./api/clinic-doctors')
const configHandler = require('./api/config')
const favoritesHandler = require('./api/favorites')

const PORT = process.env.PORT || 3000
const ROOT_DIR = __dirname // 정적 파일(index.html 등)은 프로젝트 루트에서 서빙

// 정적 파일 MIME 타입
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

// 정적 파일 서빙 (루트 → index.html, ../ 탈출 방어)
function serveStatic(reqPath, res) {
  let rel = reqPath === '/' ? '/index.html' : reqPath
  const filePath = path.normalize(path.join(ROOT_DIR, decodeURIComponent(rel)))
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '접근이 거부되었습니다' }))
    return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '파일을 찾을 수 없습니다: ' + rel }))
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')
  const pathname = u.pathname

  // --- API 라우트: Vercel 핸들러로 위임 ---
  // Vercel 은 req.query 를 자동 파싱하므로, 로컬에서도 동일하게 주입해 호환시킨다.
  if (pathname === '/api/clinics' || pathname === '/api/pharmacies' || pathname === '/api/clinic-doctors') {
    req.query = Object.fromEntries(u.searchParams)
    if (pathname === '/api/clinics') return clinicsHandler(req, res)
    if (pathname === '/api/pharmacies') return pharmaciesHandler(req, res)
    return doctorsHandler(req, res)
  }

  // 클라이언트 공개 설정 (Supabase URL/anon key)
  if (pathname === '/api/config') {
    req.query = Object.fromEntries(u.searchParams)
    return configHandler(req, res)
  }

  // 즐겨찾기 (Supabase Postgres · 인증 필요)
  // Vercel 은 JSON body 를 req.body 로 자동 파싱하므로, 로컬에서도 동일하게 주입한다.
  if (pathname === '/api/favorites') {
    req.query = Object.fromEntries(u.searchParams)
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try { req.body = body ? JSON.parse(body) : {} } catch (e) { req.body = {} }
        favoritesHandler(req, res)
      })
      return
    }
    return favoritesHandler(req, res)
  }

  // --- 정적 파일 ---
  serveStatic(pathname, res)
})

server.listen(PORT, () => {
  console.log(`\n🚀 로컬 개발 서버: http://localhost:${PORT}`)
  console.log(`   - 정적 파일: ${ROOT_DIR} (index.html)`)
  console.log(`   - GET /api/clinics?region=서울특별시`)
  console.log(`   - GET /api/pharmacies?region=서울특별시 (약국 활용신청 필요 시 503)`)
  if (!(process.env.SERVICE_KEY || '').trim()) {
    console.warn('   ⚠️  SERVICE_KEY 미설정 — `node --env-file=.env server.js` 로 실행했는지 확인하세요.')
  }
})
