# [Payment+File] 쇼핑몰 완성 — 중고테크 마켓

week_5의 '결제 없는 쇼핑몰'(Q4 Auth+DB)을 복사해, **상품 이미지 업로드 · 토스페이먼츠 결제 · 마이페이지**를 붙여 진짜 서비스로 완성한 퀘스트.

## 🔗 배포

- **Live**: https://harbor-w6-shop-complete.vercel.app

## 무엇을 만들었나

- **주제**: 중고 전자기기 마켓 (아이폰·아이패드·맥북·에어팟·갤럭시·스위치 등 10종 + 결제 테스트용 100원 상품)
- **인증**: 자체 JWT + `pg` (week_5 계승) — 비밀번호 scrypt 해싱, HMAC-SHA256 JWT(7일), localStorage 저장. 서버가 `user_id`로 사용자별 격리(RLS 아님)
- **상품 이미지 업로드**: **ImageKit** 서버 경유 업로드 (PRIVATE 키는 서버 전용). 브라우저는 base64만 보내고, 서버가 대신 올린 뒤 URL만 DB에 저장
- **결제**: **토스페이먼츠 결제위젯 v2**. 클라이언트가 위젯을 렌더링하고, **승인(confirm)은 서버가 시크릿키로 처리**. 금액은 서버가 DB 상품가로 재계산·검증(클라이언트 금액 불신뢰)
- **마이페이지**: 로그인 사용자의 주문 내역(상품명·수량·금액·주문일·주문번호)을 **본인 것만** 조회
- **DB**: Supabase Postgres(`pg` 직접 접속)
- **배포**: Vercel. `http` 서버를 서버리스 함수로 변환(`api/index.js` + `vercel.json`)

## 구조

```
index.html    # 프론트 (React CDN + Tailwind, 단일 파일):
              #   상품 그리드 · 상품 등록(이미지 업로드) · 로그인/회원가입 · 장바구니
              #   · 결제(토스 위젯) · 결제결과 · 마이페이지
server.js     # http + pg. 인증/상품/장바구니/주문·결제/마이페이지 API + ImageKit 업로드
              #   기본 export = 서버리스 핸들러, 로컬은 listen
api/index.js  # Vercel 진입점 (server.js 핸들러 재사용, 콜드스타트 시 initDB 1회 보장)
vercel.json   # /api/* → 함수로 rewrite (index.html은 정적 서빙)
.vercelignore # 스크린샷·env 등 배포 제외
package.json  # pg 하나 (토스·ImageKit은 fetch로 직접 호출, SDK 미사용)
```

## DB 테이블 (자동 생성)

| 테이블 | 컬럼 | 공개범위 |
|---|---|---|
| `harbor_w5_shop_users` | id, username(UNIQUE), password_hash, created_at | — |
| `harbor_w5_shop_products` | id, name, price, image_url, description | 전체 공개 |
| `harbor_w5_shop_cart` | id, user_id→users, product_id→products, quantity, UNIQUE(user_id,product_id) | 사용자별 분리 |
| `harbor_w6_shop_orders` | id, user_id→users, order_uid(UNIQUE), total_price, status(pending/completed/failed/cancelled), payment_key, order_name, paid_at, created_at | 사용자별 분리 |
| `harbor_w6_shop_order_items` | id, order_id→orders(CASCADE), product_id→products, quantity, price(결제시점 단가 스냅샷) | 주문에 종속 |

> ⚠️ `harbor_w6_shop_*` 테이블은 practice 프로젝트와 DB를 공유해 먼저 만들어져 있었다. `CREATE TABLE IF NOT EXISTS`로는 컬럼이 안 붙으므로 `ALTER TABLE ADD COLUMN IF NOT EXISTS`로 `paid_at`을 보강하고, `status` 값은 기존 제약(pending/completed/failed/cancelled)에 맞춰 `completed`를 쓴다.

## API

| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /api/products` | ✕ 공개 | 상품 전체 |
| `POST /api/products` `{name,price,description,fileName,fileBase64}` | ✅ | 이미지 ImageKit 업로드 후 상품 등록 |
| `POST /api/auth/register` `{username,password}` | ✕ | 가입 → JWT. 중복 409 |
| `POST /api/auth/login` `{username,password}` | ✕ | 로그인 → JWT. 실패 401 |
| `GET /api/cart` | ✅ | 내 장바구니(상품 조인·소계) |
| `POST /api/cart` `{product_id,quantity}` | ✅ | 담기(수량 누적) |
| `PATCH /api/cart/:id` `{quantity}` | ✅ | 수량 변경(0이하 삭제), 본인 것만 |
| `DELETE /api/cart/:id` | ✅ | 삭제, 본인 것만 |
| `POST /api/orders` | ✅ | 현재 장바구니로 pending 주문 생성. **금액은 서버가 DB가로 확정** |
| `POST /api/orders/confirm` `{paymentKey,orderId,amount}` | ✅ | 토스 승인. **주문 금액과 일치 검증** 후 completed 처리·장바구니 비움 |
| `GET /api/orders` | ✅ | 내 주문 내역(완료건, 최신순 + 상품 항목). 본인 것만 |

## 결제 흐름 (토스페이먼츠 결제위젯 v2)

1. 장바구니 → "결제하기" → `POST /api/orders` 로 **pending 주문 생성**(서버가 `order_uid`·금액 확정)
2. 프론트가 `widgets.setAmount` → `renderPaymentMethods`/`renderAgreement` 로 결제위젯 렌더
3. `requestPayment` → 토스 결제창 → 성공 시 `successUrl(?payment=success)` 로 리다이렉트(paymentKey·orderId·amount 동반)
4. 앱이 리다이렉트를 감지 → `POST /api/orders/confirm` → 서버가 **금액 검증** 후 토스 `payments/confirm` 승인 → `completed` + `payment_key`·`paid_at` 저장
5. 결제 결과 화면 표시, 마이페이지(`GET /api/orders`)에 반영

> 클라이언트 키(`test_gck_docs_...`)는 프론트에 하드코딩(공개 가능), 시크릿 키(`test_gsk_docs_...`)는 서버 `TOSS_SECRET_KEY` 환경변수. 강사 제공 공용 docs 테스트 키 사용(사업자등록번호 없이 개인이 발급 가능한 위젯 키가 없어서).

## 스크린샷 (`screenshots/`)

1. `1-products.png` — 상품 목록(업로드된 이미지 포함)
2. `2-cart.png` — 장바구니(수량 +/-, 삭제, 합계)
3. `3-payment-widget.png` — 결제 화면(토스 결제위젯)
4. `4-payment-success.png` — 결제 성공(100원 테스트)
5. `5-mypage.png` — 마이페이지 주문 내역

## 로컬 실행

```bash
npm install
npm start   # http://localhost:3000
```

필요한 환경변수:

| 변수 | 위치 | 용도 |
|---|---|---|
| `DATABASE_URL` | 루트 `.env` | Supabase Postgres 접속 |
| `JWT_SECRET` | 프로젝트 `.env` | 자체 JWT 서명 |
| `TOSS_SECRET_KEY` | 프로젝트 `.env` | 토스 결제 승인(서버 전용) |
| `IMAGEKIT_URL_ENDPOINT` / `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` | 프로젝트 `.env` | 상품 이미지 업로드 (코드는 PRIVATE 키만 사용) |

> Vercel 배포 시 위 환경변수는 대시보드(또는 `vercel env add`)로 별도 주입한다.

## 보안 메모

- `.env`·`.vercel`은 커밋 제외(gitignore). 비밀번호는 scrypt 해싱만 저장.
- **결제 금액은 클라이언트를 신뢰하지 않는다**: 주문 생성 시 서버가 DB 상품가로 재계산하고, 승인 시 주문 금액과 요청 금액의 **일치를 검증**한다.
- `TOSS_SECRET_KEY`·`IMAGEKIT_PRIVATE_KEY`는 **서버 전용** — 프론트로 노출하지 않는다. (이미지 업로드·결제 승인 모두 서버 경유)
