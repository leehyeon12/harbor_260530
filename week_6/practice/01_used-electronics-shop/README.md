# [Auth + DB + 결제] 중고 전자기기 쇼핑몰 — 중고테크 마켓

로그인/회원가입 + 공개 상품 목록 + **사용자별 장바구니** + **토스페이먼츠 결제** + **주문 내역** + **프로필(마이페이지)**을 갖춘 이커머스.
week5의 인증(Q4)에서 출발해 week6에서 **결제·주문·프로필**까지 확장했다.

## 🔗 배포

- **Live**: https://04used-electronics-shop.vercel.app

## 무엇을 만들었나

- **주제**: 중고 전자기기 마켓 (아이폰·아이패드·맥북·에어팟·갤럭시·스위치 등 10종 + 결제 테스트용 100원 상품)
- **인증 방식**: 강의(`week_5/practice/01_todo-app-db`) 방식 계승 — **자체 JWT + pg**
  - 비밀번호는 Node `crypto` scrypt 해싱, 토큰은 자체 HMAC-SHA256 JWT(7일), localStorage 저장
  - **RLS 아님**: 서버가 `user_id` 컬럼 + `WHERE user_id = $N`로 사용자별 격리
- **결제**: 토스페이먼츠 **결제위젯 SDK v2**. 클라이언트가 위젯을 렌더링하고,
  **승인(confirm)은 서버가 시크릿키로 처리**. 금액은 서버가 DB 상품가로 재계산·검증(클라이언트 금액 불신뢰).
- **프로필 이미지**: **ImageKit** 업로드(서버가 PRIVATE 키로 대리 업로드) 후 URL만 DB에 저장.
- **DB**: Supabase Postgres(`pg` 직접 접속). 테이블 `harbor_w5_shop_*`(users/products/cart) + `harbor_w6_shop_*`(orders/order_items/profiles)
- **배포**: Vercel. `http` 서버를 서버리스 함수로 변환(`api/index.js` + `vercel.json`)

## 구조

```
index.html    # 프론트 (React CDN + Tailwind, 단일 파일): 상품 그리드 · 로그인/회원가입 · 장바구니 · 결제위젯 · 주문내역 · 마이페이지
server.js     # http + pg. 인증/상품/장바구니/주문·결제/프로필 API. 기본 export = 서버리스 핸들러, 로컬은 listen
api/index.js  # Vercel 진입점 (server.js 핸들러 재사용, 콜드스타트 시 initDB 1회 보장)
vercel.json   # /api/* → 함수로 rewrite (index.html은 정적 서빙)
package.json  # pg 하나 (토스·ImageKit은 fetch로 직접 호출, SDK 미사용)
```

## DB 테이블 (자동 생성)

| 테이블 | 컬럼 | 공개범위 |
|---|---|---|
| `harbor_w5_shop_users` | id, username(UNIQUE), password_hash, created_at | — |
| `harbor_w5_shop_products` | id, name, price, image_url, description | 전체 공개 |
| `harbor_w5_shop_cart` | id, user_id→users, product_id→products, quantity, UNIQUE(user_id,product_id) | 사용자별 분리 |
| `harbor_w6_shop_orders` | id, user_id→users, total_price, status(pending/completed/failed/cancelled), order_uid(UNIQUE), payment_key, order_name, created_at | 사용자별 분리 |
| `harbor_w6_shop_order_items` | id, order_id→orders(CASCADE), product_id→products, quantity, price(결제시점 단가 스냅샷) | 주문에 종속 |
| `harbor_w6_shop_profiles` | user_id(PK)→users, image_url, updated_at | 본인 1행 |

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
| `GET /api/profile` | ✅ | 내 프로필(이미지 URL) |
| `POST /api/profile/image` `{fileName,fileBase64}` | ✅ | ImageKit 업로드 후 URL 저장 |
| `GET /api/orders` | ✅ | 내 주문 내역(완료건만, 최신순 + 상품 항목) |
| `POST /api/orders` | ✅ | 현재 장바구니로 주문 생성(status=pending). **금액은 서버가 DB가로 재계산** |
| `POST /api/orders/confirm` `{paymentKey,orderId,amount}` | ✅ | 토스 승인. **주문 금액과 일치 검증** 후 completed 처리 |

## 결제 흐름 (토스페이먼츠 결제위젯 v2)

1. 장바구니 → "결제하기" → `POST /api/orders` 로 **pending 주문 생성**(서버가 `order_uid`·금액 확정)
2. 프론트가 `widgets.setAmount` → `renderPaymentMethods`/`renderAgreement` 로 결제위젯 렌더
3. `requestPayment` → 토스 결제창 → 성공 시 `paymentKey`/`orderId`/`amount` 수신
4. `POST /api/orders/confirm` → 서버가 **금액 일치 검증** 후 토스 `payments/confirm` 승인 호출 → `completed` + `payment_key` 저장
5. 주문 내역(`GET /api/orders`)에 반영

> 테스트 클라이언트키는 프론트에 하드코딩된 토스 공개 문서 키(`test_gck_docs_...`), 시크릿키는 서버 `TOSS_SECRET_KEY` 환경변수.

## 핵심 흐름 (스크린샷)

1. `shop-1-products.png` — 상품 목록(공개, 비로그인)
2. `shop-2-cart.png` — 장바구니: 수량 +/-, 삭제, **합계 자동 계산**
3. `shop-3-deployed.png` — 배포된 Vercel 화면
4. `shop-4-agent-chat.png` — 토스페이먼츠 연동 에이전트 대화내역(제출용)

## 로컬 실행

```bash
npm install
npm start   # http://localhost:3000
```

필요한 환경변수(루트 `.env`):

| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | Supabase Postgres 접속 |
| `JWT_SECRET` | 자체 JWT 서명 |
| `TOSS_SECRET_KEY` | 토스 결제 승인(서버 전용) |
| `IMAGEKIT_URL_ENDPOINT` / `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` | 프로필 이미지 업로드 |

## 보안 메모

- `.env`·`.vercel`은 커밋 제외(gitignore). Vercel 환경변수로 별도 주입.
- 비밀번호는 scrypt 해싱만 저장(평문 금지). 회원가입 시연은 테스트 계정만.
- **결제 금액은 클라이언트를 신뢰하지 않는다**: 주문 생성 시 서버가 DB 상품가로 재계산하고, 승인 시 주문 금액과 요청 금액의 **일치를 검증**한다.
- `TOSS_SECRET_KEY`·`IMAGEKIT_PRIVATE_KEY`는 **서버 전용** — 프론트로 노출하지 않는다.
