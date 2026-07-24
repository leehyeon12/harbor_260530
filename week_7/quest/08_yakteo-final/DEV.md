# DEV.md - 개발 가이드

> **약터** — 초보 약사가 첫 약국 개원 입지를 데이터로 찾는 지도 웹앱.
> Architecture: **기존 Vercel 서버리스 프록시 + 단일 index.html 유지 + Supabase(Auth·DB) 얹기 하이브리드**
> (백지 스택 선택이 아니라, 10커밋으로 완성된 프로토타입 위에 신규 v1 기능 4~7번을 얹는 브라운필드 계획)

---

## Requirements (MISSION.md v1 In-Scope)

- [x] **1. 신규 개원 의원 + 경쟁 약국 겹쳐보기 지도** — 심평원/행안부 공공데이터로 최근 N개월 신규 개원 의원 + 기존 약국을 카카오맵에 표시. `openDate`(LCPMT_YMD) 필터. *(구현됨)*
- [x] **2. 임장 점수 + 기회 자리** — `처방수요(1~3) + 약국공백(0~3) + 의사규모(0~3) + 메디컬빌딩(0~2)` 점수화·랭킹, 약국 공백엔 금색 후광. *(구현됨)*
- [x] **3. 필터·정렬** — 진료과 검색, 처방수요 빠른 필터, 의사수 필터, 임장점수·개원일·처방가중치 정렬. *(구현됨)*
- [ ] **4. 지역 지정(당근마켓식) + 동(洞) 단위 세밀화** — 현재 시/도·시/군/구까지. 동 단위로 좁히기. 🔨
- [ ] **5. 로그인 + 즐겨찾기(서버 저장)** — 현재 localStorage뿐. Supabase Auth + 사용자별 서버 저장. 🔨
- [ ] **6. 후보 비교 뷰** — 즐겨찾기 후보를 나란히 비교. 🔨
- [ ] **7. 임장 점수 신뢰도 표기** — 점수 근거 분해 + 데이터 출처·"참고용" 명시. 🔨

## Non-goals (v2로 미룸)

- 임대료·권리금 등 부동산 시세/매물 분석
- 매출 예측·수익 시뮬레이션
- 유료 데이터 소스 연동 (v1은 공공데이터로만)
- 결제·구독 등 유료화 기능 자체
- 임장 체크리스트·현장 메모 (v2)
- **신규 개원 예정 의료기관 알림** (v2 1순위 리텐션 기능)

## Style

- **UI 프레임**: React 18 (CDN) + Tailwind (CDN) + Babel standalone, 단일 `index.html`. 빌드 도구 없음.
- **지도**: 카카오맵 JS SDK(`dapi.kakao.com`, libraries=clusterer,services). autoload=false 수동 초기화.
- **톤**: 초보 약사 대상 — 데이터를 "믿고 판단"하게 만드는 신뢰감. 근거 분해·출처 명시 우선. 과장된 확신 표현 지양("참고용" 성격 명시).
- **코드 스타일**: 스페이스 2칸, 세미콜론 없음, 작은따옴표, camelCase.

## Key Concepts

- **신규 개원 의원**: 행안부 clinics API를 `LCPMT_YMD::GTE`(개원일 ≥ N개월 전)로 필터. 원래 아이디어의 심장 = 잠재 처방 수요.
- **임장 점수**: `scoreClinic()` 함수. 4개 축(sP 처방·sG 공백·sD 의사·sB 빌딩) 합산, 근거 분해도 함께 반환.
- **기회 자리**: 반경 내 약국 0곳 → gapScore 최대(3), 금색 후광 강조.
- **regionLike**: 공공데이터 `ROAD_NM_ADDR::LIKE` 매칭 문자열. `시군구` 선택 시 `"서울특별시 강남구"`.
- **favoritesStore 어댑터**: index.html L133~149. 즐겨찾기 저장을 이미 **어댑터로 분리**해 둔 구조 → 현재 localStorage 구현체를 Supabase 구현체로 **교체만** 하면 서버 저장 완성. (신규기능 5번의 난이도를 크게 낮추는 기존 자산)
- **HIRA 보강**: 행안부 신규 의원명 ↔ 심평원(HIRA) 의사수를 `normClinicName`으로 매칭(구 단위, best-effort).

## Open Questions

없음(초기 3건은 문서 끝 "확정된 결정"에서 합의 완료). 남은 유일한 미검증은 동 단위 API 지원 여부이며, Phase 3 스파이크에서 확인 후 미지원 시 지도 반경 선택으로 우회(확정됨).

---

## 선택된 개발 구조 (결정 + 근거)

### 결론: 하이브리드 유지 — "Vercel 서버리스 프록시 + Supabase 얹기"

신규 v1 기능(로그인·서버 즐겨찾기)이 Auth·DB를 필요로 하지만, **기존 구조를 갈아엎지 않는다.** 표준 3옵션에 기계적으로 끼워 맞추지 않고, 이 프로젝트의 현실에 맞춰 다음과 같이 판단했다.

| 옵션 | 적합성 | 판단 |
|------|--------|------|
| **① 단일파일(현행 index.html + Express)** | 부분적 | 프론트는 이미 이 구조. 하지만 Auth·DB가 없어 5·6번을 담을 수 없음. **골격은 유지하되 Supabase를 얹어 보강.** |
| **② Supabase(Auth+DB)** | ★ 얹어서 채택 | 로그인·서버 즐겨찾기·비교뷰(5·6)의 정답. 단, **Supabase 단독으로는 부족** — 공공데이터 `SERVICE_KEY`를 클라이언트에 노출할 수 없어 프록시가 반드시 필요. |
| **③ Next.js 풀스택** | 부적합(현시점) | index.html(90KB, React CDN)을 컴포넌트로 전면 재작성해야 함. 이득(SSR·SEO)은 이 앱의 핵심 가치(지도 인터랙션)와 무관. 10커밋 매몰비용 대비 리스크 과다 → **v1에서 배제.** |

**최종 구조 = ① 프론트 골격 유지 + ② Supabase 얹기.**

- **공공데이터 프록시(유지)**: `api/*.js` Vercel 서버리스 함수가 `SERVICE_KEY`를 서버 뒤에 숨긴 채 행안부·심평원 API를 프록시. 외부 npm 0개. **손대지 않는다.**
- **Supabase(신규)**: Auth(로그인) + PostgreSQL(favorites 테이블) + RLS. 프론트는 `@supabase/supabase-js` **CDN**을 index.html에 추가해 사용. anon 키는 카카오 JS 키와 동일한 패턴으로 클라이언트 노출(보안은 RLS가 담당).
- **즐겨찾기 교체**: `favoritesStore` 어댑터의 구현체만 localStorage → Supabase로 교체. 인터페이스(`list/has/add/remove`) 유지 → 호출부 수정 최소.

### 왜 이게 맞는가 (핵심 근거 3가지)
1. **매몰비용·리스크**: 지도·점수·필터(1~3번)는 완성·검증됨. 전면 재작성은 이 자산을 위험에 빠뜨린다.
2. **보안 요구가 하이브리드를 강제**: 공공데이터 키는 서버 프록시(Vercel), 사용자 데이터는 Auth+RLS(Supabase). 한 쪽만으로 둘 다 못 함.
3. **기존 설계가 이미 준비돼 있음**: favoritesStore가 어댑터로 분리돼 있어, Supabase 전환이 "구현체 교체" 수준.

---

## 프로젝트 구조 (하이브리드)

```
/
├── index.html            # 프론트 전체 (React CDN + Tailwind + 카카오맵 + Supabase CDN 추가)
│                         #  - favoritesStore 어댑터: localStorage → Supabase 구현체로 교체
│                         #  - Auth UI(로그인/로그아웃), 비교뷰, 동 필터, 신뢰도 표기 추가
├── api/                  # Vercel 서버리스 (공공데이터 프록시 · 유지)
│   ├── _lib.js           #  공통 로직 (프록시·페이지네이션·HIRA 보강)
│   ├── clinics.js        #  GET /api/clinics
│   ├── pharmacies.js     #  GET /api/pharmacies
│   ├── clinic-doctors.js #  GET /api/clinic-doctors (HIRA 의사수)
│   └── hira-regions.js   #  시군구 코드맵
├── server.js             # 로컬 개발 서버 (api/* 를 require해 흉내, 유지)
├── vercel.json           # framework:null, regions:icn1 (유지)
├── package.json          # 외부 의존성 0개 유지 (Supabase는 프론트 CDN이라 npm 불필요)
└── .env / Vercel 환경변수 # SERVICE_KEY (+ 신규: Supabase URL/anon 키는 클라 노출이라 코드/설정에)
```

> ⚠️ **단일파일 원칙 유지**: 신규 프론트 코드(Auth·비교뷰·동필터·신뢰도)도 **별도 JS/CSS 파일을 만들지 않고** `index.html` 내부 React 컴포넌트로 추가한다. (예: `AuthBar`, `CompareView`, `DongSelector`, `ScoreBreakdown` 컴포넌트)
> ⚠️ **Supabase는 npm 설치하지 않는다** — 빌드 도구가 없으므로 `@supabase/supabase-js` UMD **CDN**을 `<script>`로 로드한다. package.json "외부 의존성 0개" 원칙 유지.

---

## 신규 기능 5번: 로그인 + 즐겨찾기 서버 저장 (스키마 수준)

### Supabase Auth (2026-07-22 갱신: 카카오 로그인 1순위)
- 방식: **카카오 로그인(OAuth) 1순위.** 타겟(한국 초보 약사)에게 마찰이 가장 적고, 카카오맵용으로 카카오 Developers 앱이 이미 있어 재활용 가능. 실제 소셜 OAuth provider 연동이라 학습 가치도 높다.
  - ⚠️ **이메일 scope는 요구하지 않는다** — 카카오 이메일 제공 동의는 "비즈앱 전환"이 필요할 수 있어, 비즈앱 없이 붙이려고 계정 식별자(카카오 user id)만으로 Supabase 유저를 생성한다. 프로필 닉네임 정도만 선택 동의.
  - **폴백: 이메일 매직링크(OTP).** `favoritesStore`가 어댑터로 분리돼 있어 Auth 방식과 무관 → 카카오 provider 설정이 막히면 `signInWithOtp({ email })`로 5분 내 우회 가능하게 추상화 유지.
- 프론트: `supabase.auth.signInWithOAuth({ provider: 'kakao' })` / `onAuthStateChange`로 세션 감지 → `AuthBar` 컴포넌트에서 로그인 상태·로그아웃 표시.
- Supabase 설정: Dashboard `Authentication > Providers > Kakao`에 카카오 REST API 키(Client ID)·Client Secret 등록. 카카오 Developers 앱에는 Supabase 콜백 URL(`https://<project-ref>.supabase.co/auth/v1/callback`)을 Redirect URI로 등록.

### favorites 테이블 스키마 (제안)

```sql
create table public.favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  clinic_id    text not null,          -- 공공데이터 의원 id (item.id)
  name         text,                   -- 의원명 (스냅샷)
  addr         text,                   -- 도로명주소 (스냅샷)
  subject      text,                   -- 진료과
  open_date    date,                   -- 개원일 (LCPMT_YMD)
  tel          text,
  lat          double precision,       -- 좌표 (비교뷰·지도 재표시용)
  lng          double precision,
  score        numeric,                -- 저장 시점 임장 점수 (스냅샷)
  score_detail jsonb,                  -- { sP, sG, sD, sB } 근거 분해 스냅샷
  region       text,                   -- 저장 시점 지역 (예: '서울특별시 강남구')
  memo         text,                   -- v2 현장메모 대비 (nullable)
  created_at   timestamptz not null default now(),
  unique (user_id, clinic_id)          -- 같은 의원 중복 저장 방지
);

alter table public.favorites enable row level security;

create policy "own favorites - select" on public.favorites
  for select using (auth.uid() = user_id);
create policy "own favorites - insert" on public.favorites
  for insert with check (auth.uid() = user_id);
create policy "own favorites - update" on public.favorites
  for update using (auth.uid() = user_id);
create policy "own favorites - delete" on public.favorites
  for delete using (auth.uid() = user_id);
```

**설계 포인트**
- `score`·`score_detail`·`region`·좌표를 **스냅샷으로 저장**: 임장 점수는 조회 시점 데이터라 나중에 재계산하면 달라진다. 비교뷰에서 "저장 당시 근거"를 안정적으로 보여주려면 스냅샷이 필요. (→ 결정 필요 ①)
- `unique(user_id, clinic_id)`로 멱등 토글. `add`는 upsert, `remove`는 delete.
- 어댑터 인터페이스 유지: `favoritesStore.list()`가 비동기가 되므로, 훅(`useFavorites`)에서 로그인 시 최초 1회 fetch → 로컬 state 캐시 → 토글 시 optimistic update + Supabase 반영.

### 비로그인 사용자 처리 (확정: 로그인 필수)
- 로그인 없이도 지도·점수·필터는 그대로 사용(진입장벽 최소). 즐겨찾기 별을 누르면 로그인 유도.
- **localStorage↔서버 마이그레이션은 v1에서 하지 않는다**(단순화). 즐겨찾기는 로그인 사용자만.

---

## 신규 기능 4번: 동(洞) 단위 세밀화 (실현 가능성·난이도)

### 핵심 리스크: 공공데이터 API는 동 단위 필터를 지원하지 않는다

- 현재 필터는 `ROAD_NM_ADDR::LIKE "시도 시군구"`. 그런데 **도로명주소 본문에는 법정동/행정동 이름이 없다**(도로명 기반: "…도산대로 117"). 즉 `LIKE`로 동을 거를 수 없다.
- 행안부 clinics API의 조건 파라미터(`cond[...]`)에 동 단위 코드/필드가 노출되는지 **미검증**. 지번주소(법정동 포함) 필드가 응답에 있는지도 확인 필요.

### 현실적 구현안: **좌표 기반 클라이언트 필터**
- 각 의원은 이미 좌표(`CRD_INFO_X/Y` → WGS84 변환, 또는 카카오 지오코딩)를 갖고 있다.
- 흐름: **구 단위로 데이터를 받아온 뒤**(기존 유지, API 부하 증가 없음), 클라이언트에서 동 단위로 추가 필터.
- 동 판정 방법 두 가지:
  1. **카카오 `coord2regioncode`(역지오코딩)** — 좌표 → `region_3depth_name`(동)을 얻어 필터. 지점마다 호출 → 호출량↑. 완화책: 결과 캐시, 구 진입 시 1회 일괄 태깅, 디바운스.
  2. **지도 위 반경/드로잉 선택** — 사용자가 지도에서 원(반경)이나 영역을 지정 → 그 안의 의원만. 동 경계와 정확히 일치하진 않지만 "생활권 집중"이라는 목적엔 부합하고 API 의존이 없어 가장 안전.

### 난이도·권장
- **난이도 🔴** (신규기능 중 최고 불확실성). API 미지원이 확정되면 좌표 기반으로 우회.
- **권장 진행 순서**: (1) clinics API에 동/지번 필드·조건 지원 여부를 **먼저 스파이크 검증** → (2) 지원하면 서버 필터, 미지원이면 좌표 기반 클라 필터(반경 선택을 1차, coord2regioncode 동 태깅을 2차)로.
- Phase 3에서 **가장 먼저** 시도(안 되면 반경 선택으로 조기 우회).

---

## 신규 기능 6번: 후보 비교 뷰

- 즐겨찾기(favorites) 목록을 카드/표로 나란히 배치. 컬럼: 임장점수, 근거 분해(sP·sG·sD·sB), 진료과, 개원일, 주소, 지도 미리보기 링크.
- `CompareView` 컴포넌트(index.html 내부). 데이터 소스 = Supabase favorites(스냅샷). 점수 기준 정렬로 "임장 갈 순서" 제시.
- 난이도 🟡 (데이터는 이미 favorites에 있음. 순수 표현·정렬 UI).

## 신규 기능 7번: 임장 점수 신뢰도 표기

- `scoreClinic`이 이미 근거를 분해 반환(sP·sG·sD·sB) → 이걸 UI로 드러내는 `ScoreBreakdown` 컴포넌트.
- 데이터 출처 명시: 행안부(의원·약국), 심평원 HIRA(의사수), 카카오(지오코딩). "참고용" 배너 + 각 축이 무엇을 뜻하는지 툴팁.
- 난이도 🟢 (신규 데이터·API 불필요. 가장 쉽고 리스크 0 → 맨 먼저).

---

## TODO List (Vibe Coding 최적화 — 브라운필드)

> 이 프로젝트는 프로토타입이 이미 존재하므로 표준 "Phase 1 프로토타이핑"은 **이미 완료**. 신규기능을 **쉬운 것(리스크 0) → 인프라 연결 → 불확실한 것** 순으로 얹는다.
> 모든 프론트 작업은 `index.html` 내부 컴포넌트로. `@single-react-dev`(프론트), `@single-server-specialist`(서버) 에이전트를 필요 시 명시 호출.

### Phase 0: 세이프포인트 & 외부 설정
- [ ] 🟢 현재 상태 동작 확인(로컬 `npm start`, 지도·점수·필터 정상) 후 커밋 (신규작업 전 기준점)
- [ ] 🟢 Supabase 프로젝트 생성 + `favorites` 테이블·RLS 정책 생성(위 스키마)
- [ ] 🟢 Supabase URL·anon 키 확보, 카카오 JS 키에 도메인(배포 URL) 등록 확인
- 📌 체크포인트: 기존 앱이 그대로 동작하고, Supabase 프로젝트·테이블이 준비됨

### Phase 1: 쉬운 신규기능 (리스크 0) — 신뢰도 표기
- [ ] 🟢 `ScoreBreakdown` 컴포넌트 — 임장점수 근거 분해(sP·sG·sD·sB) 시각화 (기능 7)
- [ ] 🟢 데이터 출처·"참고용" 배너 + 각 축 툴팁 (기능 7)
- 📌 체크포인트: 사용자가 점수의 근거와 출처를 눈으로 확인 가능. 데이터 계층 변화 없음
- 📌 git commit (세이브 포인트)

### Phase 2: 플랫폼 연결 (Supabase Auth + DB) — 로그인·서버 즐겨찾기
- [ ] 🟡 `@supabase/supabase-js` CDN 추가 + 클라이언트 초기화(index.html)
- [ ] 🟡 `AuthBar` 컴포넌트 — 카카오 로그인(`signInWithOAuth({ provider: 'kakao' })`)/로그아웃, `onAuthStateChange` 세션 감지 (기능 5)
- [ ] 🟡 `favoritesStore` 어댑터 구현체를 localStorage → Supabase로 교체(인터페이스 유지) (기능 5)
- [ ] 🟡 `useFavorites` 훅을 비동기 대응(로그인 시 fetch → optimistic 토글 → 서버 반영) (기능 5)
- [ ] 🟢 비로그인 상태에서 즐겨찾기 별 클릭 시 로그인 유도 UI (마이그레이션 없음 — 확정)
- 📌 체크포인트: 로그인 후 즐겨찾기가 **서버에 저장**되고, 다른 기기에서도 동일하게 보임
- 📌 git commit (세이브 포인트) · 롤백 가능

### Phase 3: 어려운 신규기능 (불확실한 것부터)
- [ ] 🔴 **[가장 불확실] 동 단위 세밀화** (기능 4)
      1) 스파이크: clinics API가 동/지번 조건을 지원하는지 검증
      2) 미지원 시 우회 → 좌표 기반 클라 필터(반경 선택 1차 / `coord2regioncode` 동 태깅 2차)
      ⚠️ 실패 시 우회 방안: 지도 반경 선택만으로 "생활권 집중" 목적 달성
- [ ] 🟡 `CompareView` 후보 비교 뷰 — favorites를 표/카드로 나란히, 점수순 정렬 (기능 6)
- 📌 체크포인트: 동(또는 반경)으로 지역을 좁히고, 즐겨찾기 후보를 나란히 비교 가능
- 📌 git commit (세이브 포인트)

### Phase 4: 마무리 & 배포
- [ ] 🟡 빈 상태/에러/로딩 처리(로그인 필요 안내, 즐겨찾기 0개, API 실패)
- [ ] 🟡 모바일 레이아웃 점검(지도 패널 토글 + 새 컴포넌트들)
- [ ] 🟡 Vercel 환경변수·카카오 도메인·Supabase Redirect URL 최종 확인 후 배포
- [ ] 🟢 대화내역 포함 전체 파일을 제출 repo(`harbor_260530`)에 커밋
- 📌 체크포인트: 배포 URL에서 로그인→즐겨찾기→비교→동필터 전 플로우 동작

---

## 개발 에이전트

- **`@single-react-dev`**: 프론트 전체를 `index.html` 하나에 구현. **JS/CSS 파일 분리 불가.** 신규 컴포넌트(`AuthBar`, `ScoreBreakdown`, `CompareView`, `DongSelector`)도 index.html 내부에 추가. Supabase는 CDN `<script>`로 로드.
- **`@single-server-specialist`**: `api/*.js`·`server.js` 담당. 이번 v1에서 서버 변경은 최소(동 세밀화가 서버 필터로 결론날 경우에만 `_lib.js` 조건 추가). 공공데이터 프록시 구조·"외부 의존성 0개" 원칙 유지.
- (강의 방침) 에이전트는 **자동 호출하지 않고** 필요 시 명시 호출.

---

## 외부 설정 필요 항목

### 필수 (Must Have)
| 항목 | 설명 | 획득 방법 | 노출 위치 |
|------|------|-----------|-----------|
| `SERVICE_KEY` | 공공데이터포털 통합 인증키(행안부 clinics/pharmacies + 심평원 HIRA) | data.go.kr 활용신청 → 마이페이지 인증키. **약국 데이터는 별도 활용신청 필요**(미신청 시 403) | 서버 전용(.env / Vercel 환경변수). **절대 클라 노출 금지** |
| 카카오 JS 키 | 카카오맵 SDK appkey | developers.kakao.com 앱 생성 → JavaScript 키 | 클라(index.html). **플랫폼 도메인 등록으로 보호**(배포 URL 필수 등록) |
| `SUPABASE_URL` | Supabase 프로젝트 URL | supabase.com 프로젝트 생성 → Settings > API | 클라(index.html) |
| `SUPABASE_ANON_KEY` | Supabase anon(public) 키 | 위와 동일 위치 | 클라(index.html). **RLS가 보안 담당**(노출 허용) |

### 설정 작업
| 작업 | 내용 |
|------|------|
| favorites 테이블·RLS | 위 SQL 실행(SQL Editor 또는 마이그레이션) |
| **카카오 로그인 Provider (필수)** | Supabase `Authentication > Providers > Kakao` 켜기 + 카카오 REST 키(Client ID)·Client Secret 등록. 카카오 Developers 앱엔 Supabase 콜백 URL(`https://<ref>.supabase.co/auth/v1/callback`)을 Redirect URI로 등록. 이메일 scope 미요구 |
| Supabase Auth Redirect URL | Site URL·Redirect URL에 로컬(`http://localhost:3000`)·배포 URL 등록 (OAuth 로그인 후 되돌아올 주소) |
| 카카오 플랫폼 도메인 | 로컬·Vercel 배포 도메인 등록(미등록 시 지도 로드 실패) |
| Vercel 환경변수 | `SERVICE_KEY` 등록(기존). Supabase 키는 클라 노출이라 코드/설정에 |

### 선택 (Nice to Have)
| 항목 | 설명 |
|------|------|
| 이메일 매직링크 | 카카오 설정이 막힐 때의 폴백. `signInWithOtp({ email })`. 어댑터 분리로 즉시 교체 가능 |

---

## 시작하기

```bash
# 1) 로컬 개발 서버 (기존)
npm start                          # = node --env-file=.env server.js  → http://localhost:3000

# 2) Supabase 준비
#   - supabase.com 에서 프로젝트 생성
#   - SQL Editor 에 위 favorites 스키마 + RLS 정책 실행
#   - Settings > API 에서 URL / anon key 복사 → index.html 상단 상수로 추가
#     (카카오 KAKAO_JS_KEY 옆에 SUPABASE_URL / SUPABASE_ANON_KEY)

# 3) index.html <head> 에 Supabase CDN 추가 (예)
#   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

# 4) 배포 (기존)
#   git push → Vercel 자동 배포. Vercel 대시보드에 SERVICE_KEY 환경변수 확인.
#   카카오 플랫폼에 배포 도메인 등록, Supabase Auth Redirect URL 에 배포 URL 등록.
```

---

## 확정된 결정 (기획 대화에서 합의 · 2026-07-17)

1. **임장 점수 저장 방식 → 스냅샷 저장.** favorites에 저장 당시의 점수·근거(`score`, `score_detail`)·좌표·지역을 스냅샷으로 박는다. 비교뷰가 항상 안정적으로 뜨고 빠르다. (신규 개원 6개월 롤링이라 오래된 후보는 자연히 목록에서 빠지므로 스냅샷이 낡는 문제도 완화됨.)
2. **비로그인 즐겨찾기 → 로그인 필수(v1).** 즐겨찾기 별을 누르면 로그인 유도. 지도·점수·필터 조회는 비로그인도 그대로 사용. localStorage↔서버 마이그레이션 로직은 **만들지 않는다**(v1 단순화). 지도·조회 자체는 진입장벽 없이 열려 있으므로 리텐션 손실 최소.
3. **동 세밀화 1차 방식 → 지도 반경 선택.** 스파이크에서 clinics API가 동 조건 미지원으로 확인되면, `coord2regioncode` 행정동 태깅이 아니라 **지도 반경 선택**을 1차 구현으로 간다(API 호출 부담 0, "생활권 집중" 목적에 충분). 행정동 태깅은 정확도가 더 필요할 때의 후순위 옵션.
