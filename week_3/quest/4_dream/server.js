// ============================================================
// dream-server : AI 꿈해몽 백엔드 프록시 (학습용 미니 서버)
// ------------------------------------------------------------
// 흐름:  브라우저 → 내 server.js → OpenAI API → 내 server.js → 브라우저
//
// 즉, 프론트(index.html)는 OpenAI API를 직접 부르지 않는다.
// 프론트는 오직 "내 서버"의 /api/dream 만 호출하고,
// 내 서버가 대신 OpenAI를 호출해 받은 해몽 결과(JSON)를 전달한다.
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
const MODEL = 'gpt-5.4-mini'

// 서버가 호출할 OpenAI 챗 완성(chat completions) 엔드포인트
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

// ============================================================
// 시스템 프롬프트 : AI의 "캐릭터"와 "출력 형식"을 강하게 지정
// ------------------------------------------------------------
// "신비로운 점술가" 역할을 부여하고, 반드시 정해진 JSON 형식으로만
// 답하도록 지시한다. (response_format: json_object 와 함께 쓰면 더 안정적)
// ============================================================
const SYSTEM_PROMPT = `너는 신비롭고 영험한 해몽 도사다. 천 년을 살아온 점술가처럼 신비롭고 운치 있는 말투로 사용자의 꿈을 풀이한다.

사용자가 들려준 꿈을 해석해서, 반드시 아래 JSON 형식으로만 답하라. 다른 텍스트나 설명, 마크다운 코드블록(\`\`\`)은 절대 붙이지 말고 순수 JSON 객체만 출력하라.

{
  "summary": "한 줄 요약 (꿈의 핵심을 신비로운 톤으로 한 문장)",
  "keywords": ["상징", "키워드", "배열 (2~4개)"],
  "fortune": "길몽 또는 흉몽 또는 반길몽 중 하나",
  "advice": "오늘의 한 줄 조언",
  "luck": 0부터 100 사이 정수 (행운지수),
  "personal": "생년월일 기반 개인화 한 문장 (생년월일이 없으면 빈 문자열)"
}

규칙:
- 모든 텍스트는 한국어로 작성한다.
- "fortune"은 반드시 "길몽", "흉몽", "반길몽" 셋 중 하나의 단어만 넣는다.
- "keywords"는 2~4개의 짧은 단어 배열로 넣는다.
- "luck"은 0 이상 100 이하의 정수다.
- 사용자 메시지에 생년월일이 주어지면, 그 사람의 띠/기운(간단한 사주·띠 느낌)을 꿈 해석과 자연스럽게 엮어 개인화하라. 이때 "personal" 필드에 그 사람의 띠·기운을 담은 짧은 한 문장을 넣는다. (예: "1990년생 백말띠 — 역마살의 기운이 도는 해")
- 생년월일이 주어지지 않으면 "personal"은 반드시 빈 문자열("")로 둔다.
- JSON 외의 어떤 글자도 출력하지 않는다.`

// ============================================================
// OpenAI 호출 함수
// Node 18+ 에는 전역 fetch가 내장돼 있어 이를 우선 사용한다.
// 다만 런타임에 fetch가 없을 수도 있으므로(구버전 Node 등),
// 그럴 땐 내장 https 모듈로 폴백한다. (둘 다 동작해야 함)
//
// 인자:
//   apiKey : OpenAI API 키 (Authorization 헤더에 실음)
//   dream  : 사용자가 입력한 꿈 내용 문자열
//   birth  : (선택) 생년월일 문자열. 있으면 개인화 해몽에 활용한다.
// 반환: Promise<{ status, body }>
//   status = OpenAI의 HTTP 상태코드, body = 응답 문자열(JSON)
// ============================================================
function callOpenAI(apiKey, dream, birth) {
  // --- user 메시지 구성 ---
  // 생년월일이 있으면 "생년월일: ...\n꿈: ..." 형태로 함께 담아 개인화 유도.
  // 없으면 기존처럼 꿈 내용만 보낸다. (하위호환)
  const userContent = birth
    ? `생년월일: ${birth}\n꿈: ${dream}`
    : dream

  // OpenAI에 보낼 요청 본문 (JSON 문자열로 직렬화)
  const payload = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
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
  // 라우트 2: 꿈해몽 프록시 API ( POST /api/dream )
  // 서버가 OpenAI를 대신 호출 → 받은 해몽 JSON을 클라이언트에 전달
  // ----------------------------------------------------------
  } else if (req.method === 'POST' && req.url === '/api/dream') {
    // --- (1) 요청 본문(JSON) 수집: data 청크를 모아 end에서 합친다 ---
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      // --- (2) 본문 파싱 + dream 값 검증 ---
      // dream(필수)과 함께 birth(선택)도 꺼낸다.
      let dream
      let birth
      try {
        const parsed = JSON.parse(body || '{}')
        dream = parsed.dream
        birth = parsed.birth // 생년월일 (없으면 undefined)
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }))
        return
      }

      // dream이 비었으면(없거나 공백뿐) 400
      if (!dream || typeof dream !== 'string' || dream.trim() === '') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '꿈 내용(dream)을 입력해주세요.' }))
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
      // birth는 선택값이라 검증하지 않는다. 문자열이고 공백이 아니면 정리해서,
      // 그 외(없음/빈 문자열 등)에는 빈 값으로 넘겨 기존 동작(꿈만 해몽)을 유지한다.
      const birthArg =
        typeof birth === 'string' && birth.trim() !== '' ? birth.trim() : ''
      callOpenAI(apiKey, dream.trim(), birthArg)
        .then(({ status, body: openaiBody }) => {
          // OpenAI가 200이 아니면 상태코드별 메시지로 502 반환
          if (status !== 200) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: describeOpenAIError(status) }))
            return
          }

          // --- (5) 응답에서 해몽 JSON만 꺼내 파싱 ---
          // OpenAI 응답 구조: { choices: [ { message: { content: "<JSON 문자열>" } } ] }
          // content는 "문자열"이므로 한 번 더 JSON.parse 해야 객체가 된다.
          try {
            const openaiJson = JSON.parse(openaiBody)
            const content = openaiJson.choices[0].message.content
            const result = JSON.parse(content) // summary/keywords/fortune/advice/luck

            // 파싱한 객체를 그대로 클라이언트에 200으로 전달
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(result))
          } catch (err) {
            // 응답 형태가 예상과 달라 파싱 실패한 경우
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: '해몽 결과를 해석하지 못했습니다. 다시 시도해주세요.' }))
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
  console.log(`꿈해몽 프록시 서버 실행 중 → http://localhost:${PORT}`)
  console.log('프론트는 POST /api/dream 만 호출하고, 서버가 OpenAI를 대신 부릅니다.')
  console.log('실행 전 OPENAI_API_KEY 환경변수가 설정돼 있는지 확인하세요.')
})
