// 바이턴(Bi-Turn) 카페 운영 데이터 시드 스크립트
// harbor_w5_cafe_* 4개 테이블을 생성하고, 비어있으면 2주치 시드 데이터를 넣는다.
// 데이터는 week_5/quest/06_my-cafe-concept/my_cafe.md 의 컨셉(평일 오피스족 회전 / 주말 가족 체류)과 정합되도록 설계.

const path = require('node:path')
try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'))
} catch {
  try { process.loadEnvFile() } catch {}
}

const { Pool } = require('pg')
const connectionString = (process.env.DATABASE_URL || '').trim()
if (!connectionString) {
  console.error('DATABASE_URL 이 없습니다. repo 루트 .env 를 확인하세요.')
  process.exit(1)
}
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } })

// ---- 14일치 날짜 (2026-06-27 ~ 2026-07-10) ----
const DAYS = [
  { date: '2026-06-27', dow: '토' },
  { date: '2026-06-28', dow: '일' },
  { date: '2026-06-29', dow: '월' },
  { date: '2026-06-30', dow: '화' },
  { date: '2026-07-01', dow: '수' },
  { date: '2026-07-02', dow: '목' },
  { date: '2026-07-03', dow: '금' },
  { date: '2026-07-04', dow: '토' },
  { date: '2026-07-05', dow: '일' },
  { date: '2026-07-06', dow: '월' },
  { date: '2026-07-07', dow: '화' },
  { date: '2026-07-08', dow: '수' },
  { date: '2026-07-09', dow: '목' },
  { date: '2026-07-10', dow: '금' },
]
const isWeekend = (dow) => dow === '토' || dow === '일'

// 평일: 고객 많음·객단가 낮음(테이크아웃 위주) / 주말: 고객 적음·객단가 높음(가족·체류형)
const dailySales = [
  { date: '2026-06-27', customer_count: 52, revenue: 458000 },
  { date: '2026-06-28', customer_count: 58, revenue: 534000 },
  { date: '2026-06-29', customer_count: 92, revenue: 497000 },
  { date: '2026-06-30', customer_count: 88, revenue: 466000 },
  { date: '2026-07-01', customer_count: 95, revenue: 523000 },
  { date: '2026-07-02', customer_count: 101, revenue: 566000 },
  { date: '2026-07-03', customer_count: 108, revenue: 616000 },
  { date: '2026-07-04', customer_count: 61, revenue: 549000 },
  { date: '2026-07-05', customer_count: 49, revenue: 461000 },
  { date: '2026-07-06', customer_count: 90, revenue: 491000 },
  { date: '2026-07-07', customer_count: 93, revenue: 512000 },
  { date: '2026-07-08', customer_count: 97, revenue: 543000 },
  { date: '2026-07-09', customer_count: 104, revenue: 598000 },
  { date: '2026-07-10', customer_count: 112, revenue: 661000 },
].map((row) => ({ ...row, day_of_week: DAYS.find((d) => d.date === row.date).dow }))

// 메뉴 5종: 평일/주말 판매량 범위 + 가격. 딸기스무디는 의도적으로 부진(단종 후보).
const MENU = [
  { name: '아메리카노', price: 4300, weekday: [42, 50], weekend: [10, 18] },
  { name: '카페라떼', price: 4900, weekday: [16, 24], weekend: [14, 22] },
  { name: '바스크 치즈케이크', price: 9000, weekday: [5, 10], weekend: [18, 26] },
  { name: '마들렌', price: 3800, weekday: [14, 22], weekend: [20, 30] },
  { name: '딸기스무디', price: 5500, weekday: [1, 4], weekend: [1, 3] },
]
// 날짜·메뉴 인덱스로 결정적 변주(진짜 랜덤 아님 — 재현 가능하게)
function pick(range, seed) {
  const [min, max] = range
  return min + (seed % (max - min + 1))
}
const menuSales = []
DAYS.forEach((d, di) => {
  const weekend = isWeekend(d.dow)
  MENU.forEach((m, mi) => {
    const qty = pick(weekend ? m.weekend : m.weekday, di * 7 + mi * 3)
    menuSales.push({ date: d.date, menu_name: m.name, quantity_sold: qty, revenue: qty * m.price })
  })
})

const reviews = [
  { date: '2026-06-28', rating: 5, comment: '단체석이 진짜 커요! 회사 팀원 8명이서 갔는데 자리 걱정 없이 편하게 회의했어요.' },
  { date: '2026-06-30', rating: 5, comment: '테이크아웃 할인 정책 너무 좋아요. 출근길에 매일 들러요.' },
  { date: '2026-07-01', rating: 4, comment: '바스크 치즈케이크 진짜 진하고 맛있어요. 주말에 아이랑 갔는데 다들 만족했어요.' },
  { date: '2026-07-02', rating: 3, comment: '커피는 괜찮은데 주말엔 대기줄이 좀 길어요. 좌석은 넉넉한데 주문 대기가 아쉬움.' },
  { date: '2026-07-03', rating: 5, comment: '안쪽 소파존이 조용해서 미팅하기 딱 좋았어요. 다른 카페는 시끄러운데 여긴 대화가 편해요.' },
  { date: '2026-07-05', rating: 2, comment: '마들렌이 다 팔려서 못 샀어요. 인기 많은 건 알겠는데 여유분 좀 더 준비해주세요.' },
  { date: '2026-07-06', rating: 4, comment: '딸기스무디는 그냥 그랬어요. 다른 메뉴가 더 나은듯.' },
  { date: '2026-07-07', rating: 5, comment: '가격도 합리적이고 특히 아메리카노 테이크아웃이 저렴해서 자주 이용해요.' },
  { date: '2026-07-08', rating: 4, comment: '분위기 좋고 넓어서 아이 데리고 가기 편했어요. 유모차도 여유있게 들어갈 수 있음.' },
  { date: '2026-07-09', rating: 3, comment: '바스크 치즈케이크 좋아하는데 가끔 품절이더라구요. 재입고 타이밍 맞추기 어려워요.' },
]

// 크림치즈(치즈케이크 재료)를 의도적으로 재고 부족 상태로 시드 → 재고 시나리오용
const inventory = [
  { item_name: '크림치즈', unit: 'kg', current_stock: 2.5, reorder_threshold: 5, last_order_date: '2026-06-25' },
  { item_name: '버터', unit: 'kg', current_stock: 6, reorder_threshold: 4, last_order_date: '2026-07-05' },
  { item_name: '원두', unit: 'kg', current_stock: 12, reorder_threshold: 6, last_order_date: '2026-07-06' },
  { item_name: '우유', unit: 'L', current_stock: 18, reorder_threshold: 10, last_order_date: '2026-07-08' },
  { item_name: '테이크아웃컵(아메리카노)', unit: '개', current_stock: 220, reorder_threshold: 150, last_order_date: '2026-07-04' },
  { item_name: '딸기(스무디용)', unit: 'kg', current_stock: 1.2, reorder_threshold: 1, last_order_date: '2026-07-07' },
]

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_cafe_daily_sales (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      day_of_week TEXT NOT NULL,
      customer_count INTEGER NOT NULL,
      revenue INTEGER NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_cafe_menu_sales (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      menu_name TEXT NOT NULL,
      quantity_sold INTEGER NOT NULL,
      revenue INTEGER NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_cafe_reviews (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS harbor_w5_cafe_inventory (
      id SERIAL PRIMARY KEY,
      item_name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL,
      current_stock NUMERIC(10,2) NOT NULL,
      reorder_threshold NUMERIC(10,2) NOT NULL,
      last_order_date DATE NOT NULL
    )
  `)

  const seedIfEmpty = async (table, rows, insertFn) => {
    const { rows: cnt } = await pool.query(`SELECT count(*) AS cnt FROM ${table}`)
    if (Number(cnt[0].cnt) === 0) {
      for (const row of rows) await insertFn(row)
      console.log(`${table}: ${rows.length}건 시드 완료`)
    } else {
      console.log(`${table}: 이미 데이터 있음(${cnt[0].cnt}건), 시드 건너뜀`)
    }
  }

  await seedIfEmpty('harbor_w5_cafe_daily_sales', dailySales, (r) =>
    pool.query(
      'INSERT INTO harbor_w5_cafe_daily_sales (date, day_of_week, customer_count, revenue) VALUES ($1,$2,$3,$4)',
      [r.date, r.day_of_week, r.customer_count, r.revenue]
    )
  )
  await seedIfEmpty('harbor_w5_cafe_menu_sales', menuSales, (r) =>
    pool.query(
      'INSERT INTO harbor_w5_cafe_menu_sales (date, menu_name, quantity_sold, revenue) VALUES ($1,$2,$3,$4)',
      [r.date, r.menu_name, r.quantity_sold, r.revenue]
    )
  )
  await seedIfEmpty('harbor_w5_cafe_reviews', reviews, (r) =>
    pool.query('INSERT INTO harbor_w5_cafe_reviews (date, rating, comment) VALUES ($1,$2,$3)', [
      r.date,
      r.rating,
      r.comment,
    ])
  )
  await seedIfEmpty('harbor_w5_cafe_inventory', inventory, (r) =>
    pool.query(
      'INSERT INTO harbor_w5_cafe_inventory (item_name, unit, current_stock, reorder_threshold, last_order_date) VALUES ($1,$2,$3,$4,$5)',
      [r.item_name, r.unit, r.current_stock, r.reorder_threshold, r.last_order_date]
    )
  )
}

initDB()
  .then(() => {
    console.log('시드 완료')
    return pool.end()
  })
  .catch((err) => {
    console.error('시드 실패:', err)
    process.exit(1)
  })
