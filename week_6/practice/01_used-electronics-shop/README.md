# Q4 [Auth + DB] 중고 전자기기 쇼핑몰 — 중고테크 마켓

로그인/회원가입 + 공개 상품 목록 + **사용자별 장바구니**를 갖춘 이커머스(결제 제외). 이번 주 핵심인 **인증**을 구현한 퀘스트.

## 🔗 배포

- **Live**: https://04used-electronics-shop.vercel.app

## 무엇을 만들었나

- **주제**: 중고 전자기기 마켓 (아이폰·아이패드·맥북·에어팟·갤럭시·스위치 등 10종)
- **인증 방식**: 강의(`week_5/practice/01_todo-app-db`) 방식 계승 — **자체 JWT + pg**
  - 비밀번호는 Node `crypto` scrypt 해싱, 토큰은 자체 HMAC-SHA256 JWT(7일), localStorage 저장
  - **RLS 아님**: 서버가 `user_id` 컬럼 + `WHERE user_id = $N`로 사용자별 격리
- **DB**: Supabase Postgres(`pg` 직접 접속). 테이블 `harbor_w5_shop_*`
- **배포**: Vercel. `http` 서버를 서버리스 함수로 변환(`api/index.js` + `vercel.json`)

## 구조

```
index.html    # 프론트 (React CDN + Tailwind, 단일 파일): 상품 그리드 · 로그인/회원가입 · 장바구니
server.js     # http + pg. 인증/상품/장바구니 API. 기본 export = 서버리스 핸들러, 로컬은 listen
api/index.js  # Vercel 진입점 (server.js 핸들러 재사용)
vercel.json   # /api/* → 함수로 rewrite (index.html은 정적 서빙)
package.json  # pg 하나
```

## DB 테이블 (자동 생성)

| 테이블 | 컬럼 | 공개범위 |
|---|---|---|
| `harbor_w5_shop_users` | id, username(UNIQUE), password_hash, created_at | — |
| `harbor_w5_shop_products` | id, name, price, image_url, description | 전체 공개 |
| `harbor_w5_shop_cart` | id, user_id→users, product_id→products, quantity, UNIQUE(user_id,product_id) | 사용자별 분리 |

## API

| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /api/products` | ✕ 공개 | 상품 전체 |
| `POST /api/auth/register` `{username,password}` | ✕ | 가입 → JWT. 중복 409 |
| `POST /api/auth/login` `{username,password}` | ✕ | 로그인 → JWT. 실패 401 |
| `GET /api/cart` | ✅ Bearer | 내 장바구니(상품 조인·소계). 비로그인 401 |
| `POST /api/cart` `{product_id,quantity}` | ✅ | 담기(수량 누적) |
| `PATCH /api/cart/:id` `{quantity}` | ✅ | 수량 변경(0이하 삭제), 본인 것만 |
| `DELETE /api/cart/:id` | ✅ | 삭제, 본인 것만 |

## 핵심 흐름 (스크린샷)

1. `shop-1-products.png` — 상품 목록(공개, 비로그인)
2. 비로그인 "장바구니 담기" → **로그인 모달 자동 오픈**(로그인 필요)
3. 로그인 → 담기 → `shop-2-cart.png` — 장바구니: 수량 +/-, 삭제, **합계 자동 계산**
4. `shop-3-deployed.png` — 배포된 Vercel 화면

## 로컬 실행

```bash
npm install
npm start   # http://localhost:3000  (루트 .env의 DATABASE_URL·JWT_SECRET 사용)
```

## 보안 메모

- `.env`(DATABASE_URL·JWT_SECRET)·`.vercel`은 커밋 제외(gitignore). Vercel 환경변수로 별도 주입.
- 비밀번호는 scrypt 해싱만 저장(평문 금지). 회원가입 시연은 테스트 계정만.
