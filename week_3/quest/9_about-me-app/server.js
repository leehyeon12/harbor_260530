// ============================================================
// about-me-server : AI About Me Q&A 백엔드 프록시 (학습용 미니 서버)
// ------------------------------------------------------------
// 흐름:  브라우저 → 내 server.js → OpenAI API → 내 server.js → 브라우저
//
// 즉, 프론트(index.html)는 OpenAI API를 직접 부르지 않는다.
// 프론트는 오직 "내 서버"의 /api/ask 만 호출하고,
// 내 서버가 대신 OpenAI를 호출해 받은 답변 결과(JSON)를 전달한다.
//
// 왜 프록시(proxy)로 만드나?
//   - API 키 숨김: OpenAI 키는 서버에만 두고 브라우저엔 절대 노출하지 않는다.
//     (브라우저에 키를 넣으면 누구나 개발자도구로 훔쳐 쓸 수 있다.)
//   - CORS 회피 / 호출 한곳 관리 등도 덤으로 얻는다.
//
// Node 내장 모듈(http, fs, path)만 사용 — npm/Express 없음
// ============================================================
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3000

// OpenAI 콘솔에 표기된 정식 API model id로 교체하세요 (예: 'gpt-4o-mini' 등). 이 한 줄만 바꾸면 모델 변경됨.
const MODEL = 'gpt-4o-mini'

// 서버가 호출할 OpenAI 챗 완성(chat completions) 엔드포인트
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ABOUT_ME = fs.readFileSync(path.join(__dirname, 'about-me.md'), 'utf8')
// ============================================================
// 시스템 프롬프트 : AI의 "캐릭터"와 "답변 규칙"을 지정
// ------------------------------------------------------------
// ★ 이 퀘스트의 핵심 ★
// 위에서 읽어둔 ABOUT_ME(내 소개 .md)를 프롬프트 안에 그대로 박아넣어,
// AI가 '일반 지식'이 아니라 '내 자료 안의 내용만' 근거로 답하게 만든다.
// 자료에 없는 내용은 지어내지 말고 "모른다"고 답하도록 강하게 지시한다.
// ============================================================
const SYSTEM_PROMPT = `너는 'LEE'를 소개하는 친절하고 정중한 비서다.
아래 <자료> 안에 적힌 내용만 근거로 사용자의 질문에 답한다.

규칙:
- 반드시 <자료>에 있는 내용만으로 답한다. 일반 지식이나 추측으로 답하지 않는다.
- <자료>에 없는 내용을 물으면 "제 자료에는 없는 내용이라 답변드리기 어렵습니다."라고 답한다.
- 한국어로, 정중하고 간결하게 핵심만 답한다.
- 반드시 아래 JSON 형식으로만 답하라. 마크다운 코드블록(\`\`\`)은 붙이지 말고 순수 JSON 객체만 출력한다.

{
  "answer": "질문에 대한 답변. (자료에 근거가 없으면 '제 자료에는 없는 내용이라 답변드리기 어렵습니다.')"
}

<자료>
${ABOUT_ME}
</자료>`

// ============================================================
// OpenAI 호출 함수
// Node 18+ 에는 전역 fetch가 내장돼 있어 이를 우선 사용한다.
// 다만 런타임에 fetch가 없을 수도 있으므로(구버전 Node 등),
// 그럴 땐 내장 https 모듈로 폴백한다. (둘 다 동작해야 함)
//
// 인자:
//   apiKey   : OpenAI API 키 (Authorization 헤더에 실음)
//   question : 사용자가 입력한 질문 문자열 (그대로 user content로 전송)
// 반환: Promise<{ status, body }>
//   status = OpenAI의 HTTP 상태코드, body = 응답 문자열(JSON)
// ============================================================
function callOpenAI(apiKey, question) {
  // OpenAI에 보낼 요청 본문 (JSON 문자열로 직렬화)
  const payload = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question },
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
  const https = require('https')
  return new Promise((resolve, reject) => {
    const req = https.request(
      OPENAI_URL,
      {
        method: 'POST',
        // https.request에 본문 바이트 길이를 알려줘야 안전하다
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

// ============================================================
// OpenAI 상태코드 → 사람이 읽기 좋은 한국어 메시지로 변환
// (200이 아닐 때 502로 내려줄 메시지를 만든다)
// ============================================================
function describeOpenAIError(status) {
  if (status === 401) return 'API 키가 올바르지 않습니다.'
  if (status === 429) return 'API 호출 한도를 초과했습니다. 잠시 후 다시 시도하세요.'
  return `OpenAI API 응답 오류입니다. (상태코드: ${status})`
}

const server = http.createServer((req, res) => {
  // ----------------------------------------------------------
  // 라우트 1: 정적 페이지 서빙 ( / 또는 /index.html → 같은 폴더 index.html )
  // ----------------------------------------------------------
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
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
  // 라우트 2: About Me Q&A 프록시 API ( POST /api/ask )
  // 서버가 OpenAI를 대신 호출 → 받은 답변 JSON을 클라이언트에 전달
  // ----------------------------------------------------------
  } else if (req.method === 'POST' && req.url === '/api/ask') {
    // --- (1) 요청 본문(JSON) 수집: data 청크를 모아 end에서 합친다 ---
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      // --- (2) 본문 파싱 + question 값 검증 ---
      // 본문은 { "question": "..." } 형태만 받는다.
      let question
      try {
        const parsed = JSON.parse(body || '{}')
        question = parsed.question
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }))
        return
      }

      // question이 비었으면(없거나 공백뿐) 400
      if (!question || typeof question !== 'string' || question.trim() === '') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '질문(question)을 입력해주세요.' }))
        return
      }

      // --- (3) API 키 확인 (코드에 하드코딩 금지, 환경변수에서만 읽음) ---
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY 환경변수가 없습니다. .env 파일을 확인하세요.' }))
        return
      }

      // --- (4) OpenAI 호출 ---
      // question 문자열을 그대로 user content로 보낸다.
      callOpenAI(apiKey, question.trim())
        .then(({ status, body: openaiBody }) => {
          // OpenAI가 200이 아니면 상태코드별 메시지로 502 반환
          if (status !== 200) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: describeOpenAIError(status) }))
            return
          }

          // --- (5) 응답에서 답변 JSON만 꺼내 파싱 ---
          // OpenAI 응답 구조: { choices: [ { message: { content: "<JSON 문자열>" } } ] }
          // content는 "문자열"이므로 한 번 더 JSON.parse 해야 객체가 된다.
          try {
            const openaiJson = JSON.parse(openaiBody)
            const content = openaiJson.choices[0].message.content
            const result = JSON.parse(content) // { answer }

            // 파싱한 객체를 그대로 클라이언트에 200으로 전달
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(result))
          } catch (err) {
            // 응답 형태가 예상과 달라 파싱 실패한 경우
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: '답변 결과를 해석하지 못했습니다. 다시 시도해주세요.' }))
          }
        })
        .catch((err) => {
          // 네트워크 실패 등 호출 자체가 안 된 경우 → 500
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'OpenAI 호출에 실패했습니다: ' + err.message }))
        })
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
  console.log(`About Me Q&A 프록시 서버 실행 중 → http://localhost:${PORT}`)
  console.log('프론트는 POST /api/ask 만 호출하고, 서버가 OpenAI를 대신 부릅니다.')
  console.log('실행 전 OPENAI_API_KEY 환경변수가 설정돼 있는지 확인하세요.')
})
