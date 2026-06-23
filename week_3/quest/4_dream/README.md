# 🌙 AI 꿈해몽 — 신비로운 점술가

어젯밤 꿈을 입력하면 AI가 풀이해주는 앱이다. **Server + AI 조합** 퀘스트로,
브라우저가 외부 AI를 직접 부르지 않고 **내 서버(`server.js`)가 OpenAI API를 대신 호출(프록시)** 한다.

```
브라우저(index.html) → 내 server.js → OpenAI API → 내 server.js → 브라우저
                       (여기에만 API 키 보관)
```

해몽가 AI는 "신비로운 점술가" 캐릭터로 설정했고(시스템 프롬프트), 결과는
**① 한 줄 요약 ② 상징 키워드 ③ 길몽/흉몽 ④ 오늘의 조언 ⑤ 🍀 행운지수(0~100)** 를 카드로 보여준다.

## 구성 파일

| 파일 | 설명 |
|---|---|
| `server.js` | Node 내장 모듈(http)만 쓰는 프록시 서버. `POST /api/dream`에서 OpenAI 호출 |
| `index.html` | React 18 + Tailwind (CDN, 빌드 없음) 단일 파일. 밤하늘 카드 UI |
| `.env.example` | API 키 템플릿. 복사해서 `.env`로 쓴다 |
| `.gitignore` | 실제 키가 든 `.env`를 깃에서 제외 |

## 실행 방법

1. **API 키 준비**: [platform.openai.com](https://platform.openai.com)에서 결제 등록 후 API 키 발급(`sk-...`)
2. **키 저장**: `.env.example`을 복사해 `.env`를 만들고 키를 채운다
   ```bash
   cp .env.example .env
   # .env 파일을 열어 OPENAI_API_KEY=sk-... 채우기
   ```
3. **서버 실행** (Node 20.6+):
   ```bash
   node --env-file=.env server.js
   ```
4. 브라우저에서 `http://localhost:3000` 접속 → 꿈 입력 → "해몽하기"

> 🔑 **보안**: API 키는 `.env`에만 두고 코드엔 하드코딩하지 않는다. `.env`는 `.gitignore`로 깃에 올라가지 않는다.
>
> 🔄 **모델 변경**: `server.js` 상단 `const MODEL` 한 줄만 바꾸면 다른 모델로 교체된다. (콘솔에 표기된 정식 API model id 사용)

## 생성 방법 (에이전트 활용)

- **백엔드 `server.js`**: `single-server-specialist` 에이전트
- **프론트 `index.html`**: `single-react-dev` 에이전트
- 기존 `week_3/quest/3_coin`의 프록시 패턴을 참고해 동일 구조로 구현

## 제출물

- [x] GitHub 저장소 링크 (이 폴더)
- [x] 동작 스크린샷 (해몽 결과 카드)
- [x] 에이전트와의 대화 스크린샷

### 동작 화면

![동작 화면 — DREAM ORACLE 해몽 결과 카드](스크린샷%202026-06-23%20오후%204.57.23.png)

### 에이전트 대화

![에이전트(Claude Code)와의 대화](스크린샷%202026-06-23%20오후%204.56.35.png)
