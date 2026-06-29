// ============================================================
// coin-server : 백엔드 프록시 학습용 미니 서버
// ------------------------------------------------------------
// 흐름:  브라우저 → 내 server.js → CoinGecko → 내 server.js → 브라우저
//
// 즉, 프론트(index.html)는 외부 API(CoinGecko)를 직접 부르지 않는다.
// 프론트는 오직 "내 서버"의 /api/coins 만 호출하고,
// 내 서버가 대신 CoinGecko를 호출해 받은 JSON을 그대로 전달한다.
//
// 이렇게 서버가 중간에서 외부 API를 대신 불러주는 패턴을 "프록시(proxy)"라 한다.
// (장점 학습 포인트: CORS 회피, API 키 숨김, rate limit 한곳 관리 등)
//
// Node 내장 모듈(http, fs, path)만 사용 — npm/Express 없음
// ============================================================
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3000

// 서버가 대신 호출할 외부 API 주소 (CoinGecko, 원화 기준 7개 코인 + 24h 등락률)
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=krw&ids=bitcoin,ethereum,ripple,solana,dogecoin,cardano,tron&price_change_percentage=24h'

// ============================================================
// 외부 API 호출 함수
// Node 18+ 에는 전역 fetch가 내장돼 있어 이를 우선 사용한다.
// 다만 런타임에 fetch가 없을 수도 있으므로(구버전 Node 등),
// 그럴 땐 내장 https 모듈로 폴백한다. (둘 다 동작해야 함)
//
// 반환: Promise<{ status, body }>  — status는 외부 API의 HTTP 상태코드, body는 응답 문자열
// ============================================================
function fetchCoins() {
  // --- 경로 1: 내장 fetch 사용 (Node 18+) ---
  if (typeof fetch !== 'undefined') {
    return fetch(COINGECKO_URL).then((res) =>
      res.text().then((body) => ({ status: res.status, body }))
    )
  }

  // --- 경로 2: 내장 https 모듈로 폴백 ---
  const https = require('https')
  return new Promise((resolve, reject) => {
    https
      .get(COINGECKO_URL, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data })
        })
      })
      .on('error', (err) => reject(err))
  })
}

const server = http.createServer((req, res) => {
  // ----------------------------------------------------------
  // 라우트 1: 정적 페이지 서빙 ( / 또는 /index.html → 같은 폴더 index.html )
  // ----------------------------------------------------------
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('index.html 파일을 불러올 수 없습니다.')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(data)
    })

  // ----------------------------------------------------------
  // 라우트 2: 프록시 API ( /api/coins )
  // 서버가 CoinGecko를 대신 호출 → 받은 JSON을 그대로 클라이언트에 전달
  // ----------------------------------------------------------
  } else if (req.url === '/api/coins') {
    fetchCoins()
      .then(({ status, body }) => {
        // 외부 API가 200이 아니면(예: 429 rate limit) 에러로 처리한다 (502)
        if (status !== 200) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: `외부 API(CoinGecko) 응답 오류입니다. (상태코드: ${status})` }))
          return
        }
        // 받은 JSON 문자열을 "그대로" 전달 (파싱 없이 통과 = 진짜 프록시)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(body)
      })
      .catch((err) => {
        // 네트워크 실패 등 호출 자체가 안 된 경우 → 500
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '외부 API 호출에 실패했습니다: ' + err.message }))
      })

  // ----------------------------------------------------------
  // 그 외 경로: 404
  // ----------------------------------------------------------
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }
})

server.listen(PORT, () => {
  console.log(`코인 프록시 서버 실행 중 → http://localhost:${PORT}`)
  console.log('프론트는 /api/coins 만 호출하고, 서버가 CoinGecko를 대신 부릅니다.')
})
