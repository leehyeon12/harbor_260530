# 하버스쿨 AI 공장장 부트캠프 — 수업 핵심 노트 (텍스트 컨텍스트)

> 이 문서는 수업 Q&A 에이전트가 참조하는 **텍스트 컨텍스트**다.
> "지난 수업에서 배운 ○○가 뭐였지?" 류의 질문에 이 노트가 근거가 된다.
> 실제 **코드 컨텍스트**는 `week_1` ~ `week_3` 폴더의 실습 파일들이다.

## 과정 개요
- 8주 과정, 매주 토요일 14:00~17:00 (주말반)
- 흐름: 기초개념 → 고블린(직접 만들기 → 리뷰 → 설명) → 퀘스트(실제 앱 구현)
- 결과물 제출: GitHub 저장소 하나(`harbor_260530`)에 `week_N/quest/...` 구조로 폴더별 구분

---

## W1 (5/30) — 웹 기초
- 웹이 동작하는 큰 그림: **프론트엔드 / 백엔드 / CRUD / 서버 / 배포**
- 개인 프로필 사이트를 v0로 만들어보며 HTML/화면 구성 감 잡기
- 퀘스트: 레시피 카드(`week_1/quest/1_recipe`), 드라마 추천(`week_1/quest/2_drama`)

## W2 (6/6) — 단일 파일 프론트엔드 패턴
- **CDN 기반 React 18 + Tailwind**를 `index.html` 한 파일에 담는 패턴 (빌드 도구 없음)
- 상태(useState)로 입력 → 계산 → 화면 갱신하는 인터랙션 구현
- 실습: 나이 계산기(`05_age-calculator`), D-day 카운터(`06_dday-counter`), 색상 팔레트(`07_color-palette`) — 모두 `week_2/practice/` 아래
- 퀘스트: 더치페이 계산기(`quest/1_dutch-pay`), 밈 메이커(`quest/2_meme-maker`)

## W3 (6/13) — 백엔드 / API / 인증 패턴 심화
가장 코드 컨텍스트가 풍부한 주차다. 핵심은 **Node 내장 모듈만으로 서버 만들기**.

### 01_webserver-static — 정적 파일 서버
- `http`, `fs`, `path` **내장 모듈만** 사용 (npm 의존성 0)
- 확장자별 **MIME 타입 매핑** 테이블로 Content-Type 결정
- `resolvePath()`로 요청 URL → 실제 파일 경로 변환, **ROOT 밖 접근 차단**(디렉터리 탈출 방어)

### 02_webserver-api — API 라우팅
- `req.url`로 라우트 분기: `/` → `index.html` 서빙, `/api/hello` → **JSON 응답**
- `res.writeHead(200, { 'Content-Type': 'application/json' })` 후 `JSON.stringify(...)`
- 매칭 안 되면 404 처리 — "라우팅"의 기본 개념

### 03_webserver-auth — 인증 / 비밀번호 처리
- `pass.txt`를 매 요청마다 읽어 `{ password, label, savedAt }`로 파싱 (서버 재시작 없이 반영)
- 파일 mtime을 "저장 시각"으로 사용, `키=값` 형식 파싱
- **보안 학습 포인트**: 실서비스에선 비밀번호를 평문 파일/응답으로 다루지 말 것 (해시·전용 시크릿 저장소)

### 외부 API 활용 앱
- `04_apod-magazine` (NASA 오늘의 천문 사진), `05_weather-today`(날씨), `06_pokebook`(포켓몬 도감) — 모두 `week_3/practice/` 아래
- 퀘스트 `3_coin`: 코인 시세 대시보드 — **백엔드 프록시 `server.js`** (CORS/키 숨김 목적)
- 퀘스트 `4_dream`: AI 꿈해몽 앱 (생년월일 개인화)
- 퀘스트 `7_context-me`: 나를 설명하는 컨텍스트 Q&A 에이전트

---

## 자주 나올 질문 → 어디를 보면 되는지
- "정적 파일 서버 어떻게 만들었어?" → `week_3/practice/01_webserver-static/server.js`
- "API 엔드포인트(라우팅) 예시 보여줘" → `week_3/practice/02_webserver-api/server.js`
- "비밀번호/인증 처리 어떻게 했고 보안 주의점은?" → `week_3/practice/03_webserver-auth/server.js`
- "React를 빌드 없이 쓰는 단일 HTML 패턴이 뭐였지?" → `week_2/practice/*` 의 `index.html`
- "백엔드 프록시는 왜 썼어?" → `week_3/quest/3_coin/server.js`
