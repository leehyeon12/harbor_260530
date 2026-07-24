-- 약터 v1 스키마 (idempotent — 여러 번 실행해도 안전)
-- 대상: 서버(pg)로 접근. Data API OFF, RLS는 defense-in-depth.
-- 실행: node --env-file=.env scripts/migrate.mjs
-- 접두어 yakteo_ = 공용 side-projects 프로젝트에서 앱별 격리.

-- ============================================================
-- 1) 즐겨찾기 (favorites) — v1 핵심 기능(#5)
-- ============================================================
create table if not exists public.yakteo_favorites (
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

drop policy if exists "own favorites - select" on public.yakteo_favorites;
create policy "own favorites - select" on public.yakteo_favorites
  for select using (auth.uid() = user_id);
drop policy if exists "own favorites - insert" on public.yakteo_favorites;
create policy "own favorites - insert" on public.yakteo_favorites
  for insert with check (auth.uid() = user_id);
drop policy if exists "own favorites - update" on public.yakteo_favorites;
create policy "own favorites - update" on public.yakteo_favorites
  for update using (auth.uid() = user_id);
drop policy if exists "own favorites - delete" on public.yakteo_favorites;
create policy "own favorites - delete" on public.yakteo_favorites
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 2) 관심지역 (당근마켓식 · 시군구 단위 · 최대 3개 · 기본 1개)
--    favorites 다음 fast-follow(#4)용. 테이블만 미리 생성.
-- ============================================================
create table if not exists public.yakteo_user_regions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  sido        text not null,          -- 시/도 (예: 서울특별시)
  sigungu     text,                   -- 시군구 (예: 강남구). null이면 시/도 전체
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, sido, sigungu)     -- 같은 지역 중복 방지
);

-- 기본 관심지역은 사용자당 1개만
create unique index if not exists yakteo_user_regions_one_default
  on public.yakteo_user_regions (user_id) where is_default;
-- ⚠️ "최대 3개" 제한은 앱단에서 체크(가장 단순).

alter table public.yakteo_user_regions enable row level security;

drop policy if exists "own regions - select" on public.yakteo_user_regions;
create policy "own regions - select" on public.yakteo_user_regions
  for select using (auth.uid() = user_id);
drop policy if exists "own regions - insert" on public.yakteo_user_regions;
create policy "own regions - insert" on public.yakteo_user_regions
  for insert with check (auth.uid() = user_id);
drop policy if exists "own regions - update" on public.yakteo_user_regions;
create policy "own regions - update" on public.yakteo_user_regions
  for update using (auth.uid() = user_id);
drop policy if exists "own regions - delete" on public.yakteo_user_regions;
create policy "own regions - delete" on public.yakteo_user_regions
  for delete using (auth.uid() = user_id);
