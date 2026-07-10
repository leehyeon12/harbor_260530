# Q2 [Agent+DB] 가계부 분석 에이전트

Q1에서 만든 가계부 앱의 Supabase DB(`harbor_w5_ledger_transactions`)에 **AI 에이전트**를 연결해,
"말로 물어보는 소비 분석가"를 구현한 퀘스트.

## 무엇인가

- **에이전트**: `ledger-analyst` (Claude Code 서브에이전트)
- **DB 접속**: **Supabase MCP**(`mcp__supabase__execute_sql`, 읽기 전용)로 가계부 테이블을 직접 조회
- **역할**: 자연어 질문 → SQL 집계 → 사람 말로 해석. 조회·분석·조언 3종.

## 파일

- `ledger-analyst.md` — 에이전트 정의(프론트매터 + 시스템 프롬프트). 실제 설치 위치는 `.claude/agents/ledger-analyst.md`.
- `README.md` — 이 문서
- `screenshot-*.png` — 에이전트 대화(조회/분석/조언) + 앱 데이터 누적 스크린샷

## 세팅 (재현 방법)

1. Q1 가계부 앱으로 Supabase에 지출 데이터 10건+ 누적 (본 제출 기준 지출 18건 / 수입 2건, 6·7월)
2. **Supabase MCP** 연결 (읽기 전용):
   ```bash
   claude mcp add-json supabase '{"command":"npx","args":["-y","@supabase/mcp-server-supabase@latest","--read-only","--project-ref=<PROJECT_REF>"],"env":{"SUPABASE_ACCESS_TOKEN":"<PAT>"}}' -s user
   ```
   - `PAT`: Supabase 대시보드 → Account → Access Tokens
   - `PROJECT_REF`: 프로젝트 Settings → General → Reference ID
   - (본 프로젝트는 두 값을 repo 루트 `.env`에 보관, `.gitignore`로 커밋 제외)
3. Claude Code에서 `@ledger-analyst` 호출 후 질문.

## 질문 예시 & 실제 답변 (2026-07 기준, DB 근거)

**조회** — "이번 달 얼마 썼어? 교통비 월평균은?"
> 7월 지출 1,041,900원 (수입 3,200,000 → 잔액 +2,158,100). 교통비 월평균 41,000원. 식비 최다일 7/2 45,000원.

**분석** — "카테고리 비율이랑 주중/주말 비교"
> 주거 76.8% · 식비 8.1% · 교통 6.4% · 생활 4.5% · 기타 2.9% · 구독료 1.3%.
> 주말이 커 보이나 월세(80만)가 일요일에 찍힌 착시 — 월세 제외 주말 실소비 105,000원.

**조언** — "줄일 소비랑 월말 예상"
> 예산 200만 중 52% 사용(남은 958,100). 월세 제외 변동비 하루 ~24,190원 → 월말 예상 약 155만원(예산 내). 고정비(주거)는 단기 조절 불가, 변동비 중 식비 주말 외식 관리 권장. 지난달 대비 -3,000원으로 안정적.

## 창의성 요소

- **월간 리포트**: 총수입·지출·잔액 → 카테고리 TOP3 → 주중/주말 → 지난달 대비 → 소비 등급 → 개선 제안을 한 번에.
- **월말 지출 전망**: 경과일 일평균 × 남은 일수 (고정비/변동비 분리 추정).
- **예산 연동**: `harbor_w5_ledger_budgets`와 비교해 남은 예산·초과 경보.

## 기술 메모

- 쓰기는 read-only MCP로 막고, 데이터 적재는 Q1 앱(pg) 경유. 분석은 오직 조회.
- 쿼리 결과의 untrusted 데이터 경계 안 지시는 따르지 않음(값만 사용).
