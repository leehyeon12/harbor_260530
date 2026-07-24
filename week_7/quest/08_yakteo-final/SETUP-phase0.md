# Phase 0 셋업 체크리스트 (약터 v1 — 카카오 로그인 + 서버 즐겨찾기)

> 현재님이 **대시보드에서** 진행하는 부분. 다 끝나면 맨 아래 "AI에게 넘길 값" 3개만 알려주면
> 나머지(코드 연결)는 내가 처리한다. 순서대로 진행하면 막힘 없음.

---

## STEP 1. 새 Supabase 프로젝트 생성 (사이드프로젝트 공용) ⏱️ 2분

> harbor와 **별도**의 새 프로젝트를 만든다. 무료 플랜은 프로젝트 수 제한이 있으니,
> 이 프로젝트 하나를 **여러 사이드프로젝트 공용 DB**로 쓴다(harbor처럼 한 프로젝트에 여러 앱 테이블이 쌓임).
> 앱별 충돌은 **`yakteo_` 접두어**로 격리한다(다른 앱은 다른 접두어).

1. https://supabase.com → 로그인 → **New project**
2. 값 입력:
   - Name: `side-projects` (여러 사이드프로젝트 공용 컨테이너)
   - Database Password: 강한 비번(어딘가 메모, 지금은 안 써도 됨)
   - Region: **Northeast Asia (Seoul)** — 국내 사용자라 서울
3. 생성되면 좌측 **Settings(⚙️) > API** 로 가서 두 값 복사:
   - **Project URL** (예: `https://abcdxxxx.supabase.co`)
   - **anon public** 키 (긴 문자열, `eyJ...`)
   > anon 키는 클라이언트에 노출되는 게 정상이다(보안은 RLS가 담당). 공유해도 안전.
   > ⚠️ `service_role` 키는 절대 공유·노출 금지 (안 쓴다).

---

## STEP 2. 테이블 2개(yakteo_favorites + yakteo_user_regions) + RLS 생성 ⏱️ 1분

좌측 **SQL Editor > New query** 에 아래를 **통째로 붙여넣고 Run**:

```sql
create table public.yakteo_favorites (
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

alter table public.yakteo_favorites enable row level security;

create policy "own favorites - select" on public.yakteo_favorites
  for select using (auth.uid() = user_id);
create policy "own favorites - insert" on public.yakteo_favorites
  for insert with check (auth.uid() = user_id);
create policy "own favorites - update" on public.yakteo_favorites
  for update using (auth.uid() = user_id);
create policy "own favorites - delete" on public.yakteo_favorites
  for delete using (auth.uid() = user_id);


-- ============================================
-- 관심지역 (당근마켓식 · 시군구 단위 · 최대 3개 · 기본 1개)
-- favorites 다음 fast-follow 기능(#4)용. DB는 지금 미리 생성해 둔다.
-- ============================================
create table public.yakteo_user_regions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  sido        text not null,          -- 시/도 (예: 서울특별시)
  sigungu     text,                   -- 시군구 (예: 강남구). null이면 시/도 전체
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, sido, sigungu)     -- 같은 지역 중복 방지
);

-- 기본 관심지역은 사용자당 1개만 (부분 유니크 인덱스)
create unique index yakteo_user_regions_one_default
  on public.yakteo_user_regions (user_id) where is_default;
-- ⚠️ "최대 3개" 제한은 앱단에서 체크(가장 단순). DB 트리거는 v2에서 필요 시.

alter table public.yakteo_user_regions enable row level security;

create policy "own regions - select" on public.yakteo_user_regions
  for select using (auth.uid() = user_id);
create policy "own regions - insert" on public.yakteo_user_regions
  for insert with check (auth.uid() = user_id);
create policy "own regions - update" on public.yakteo_user_regions
  for update using (auth.uid() = user_id);
create policy "own regions - delete" on public.yakteo_user_regions
  for delete using (auth.uid() = user_id);
```

`Success. No rows returned` 나오면 성공 (테이블 2개 생성됨). 카카오 로그인이어도 `auth.users`에 유저가 생기므로 두 스키마 모두 그대로 유효.

> 지금 v1 핵심은 **favorites**만 구현한다. `user_regions`는 테이블만 미리 만들어 두고,
> favorites 배포 후 fast-follow로 코드를 붙인다(당근식 "동네 설정" 모달 → 기본 지역 자동 진입).

---

## STEP 3. 카카오 로그인 Provider 연동 ⏱️ 5분

**순서가 중요하다: Supabase에서 콜백 URL을 먼저 확인 → 카카오 앱 설정 → 다시 Supabase에 키 입력.**

### 3-1. Supabase 콜백 URL 확인
- Supabase 좌측 **Authentication > Sign In / Providers**(또는 Providers) 목록에서 **Kakao** 찾기 → 펼치면
  **Callback URL (for OAuth)** 이 보인다: `https://<project-ref>.supabase.co/auth/v1/callback`
  → 이 값을 복사해 둔다 (3-2에서 카카오에 등록).

### 3-2. 카카오 Developers 앱 설정
- https://developers.kakao.com → **내 애플리케이션** → (카카오맵 쓰던 **기존 앱** 선택. 없으면 새로 생성)
- **① 카카오 로그인 활성화**: 좌측 `카카오 로그인` → **활성화 설정 ON**
- **② Redirect URI 등록**: 같은 `카카오 로그인` 화면 하단 **Redirect URI 등록** →
  3-1에서 복사한 `https://<ref>.supabase.co/auth/v1/callback` 붙여넣기
- **③ 동의항목**: `카카오 로그인 > 동의항목` → **닉네임** 정도만 선택동의. ⚠️ **이메일은 켜지 말 것**(비즈앱 전환 요구됨, 우리는 안 씀)
- **④ 키 2개 확보**:
  - `앱 설정 > 앱 키` 의 **REST API 키** → Supabase Kakao의 **Client ID**로 쓴다
  - `제품 설정 > 카카오 로그인 > 보안` 의 **Client Secret** → **코드 생성/활성화 ON** 후 그 값 복사

### 3-3. Supabase에 카카오 키 입력
- 다시 Supabase **Authentication > Providers > Kakao** → **Enable ON**
- **Client ID** = 카카오 REST API 키
- **Client Secret** = 카카오 Client Secret
- **Save**

---

## STEP 4. Redirect / Site URL 등록 ⏱️ 1분

Supabase **Authentication > URL Configuration**:
- **Site URL**: `http://localhost:3000` (개발 중. 배포 후 배포 URL로 교체)
- **Redirect URLs** 에 추가: `http://localhost:3000` , (배포되면) `https://<vercel배포도메인>`

> 카카오 개발자 앱의 **플랫폼 > Web 사이트 도메인**에도 `http://localhost:3000` 이 등록돼 있어야
> 지도(카카오맵)가 뜬다 — 기존에 등록돼 있을 것. 배포 후 배포 도메인 추가 잊지 말기.

---

## 📌 나중에 도메인 변경 시 체크리스트 (예: yakteo.vercel.app 로 리네임)

배포 도메인이 바뀌면 아래 3곳만 갱신하면 된다 (Supabase Callback URI는 도메인과 무관 — 그대로):
1. **카카오 앱 대표 도메인** (앱 기본 정보)
2. **카카오 JavaScript 키 > SDK 도메인** (지도 로드용 — 미등록 시 지도 안 뜸)
3. **Supabase > Authentication > URL Configuration** (Site URL + Redirect URLs — 미등록 시 로그인 후 복귀 실패)

## ✅ 다 끝나면 — AI에게 넘길 값 3개

아래 3개만 알려주면 코드 연결(Supabase CDN + AuthBar + favoritesStore 교체)을 내가 진행한다:

1. **SUPABASE_URL** = `https://____.supabase.co`
2. **SUPABASE_ANON_KEY** = `eyJ...` (anon public 키)
3. STEP 2 SQL **Run 성공했는지** + STEP 3 카카오 Provider **Enable 됐는지** (예/아니오)

> 막히는 화면이 있으면 그 지점만 말해주면 같이 푼다. (특히 카카오 Client Secret 위치가 UI 개편으로 자주 바뀜)
