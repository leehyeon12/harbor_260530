// ========================================
// 공공데이터 프록시 공통 로직 (의원/약국 공용)
// ----------------------------------------
// Vercel 서버리스 함수(api/clinics.js·api/pharmacies.js)와
// 로컬 개발 서버(server.js)가 동일하게 require 해서 쓴다.
// 외부 패키지 0개: node:https, node:url 만 사용.
// serviceKey 는 호출 시점에 process.env 에서 읽는다
//   - 로컬:  node --env-file=.env server.js  (.env 로드)
//   - Vercel: 대시보드 환경변수 SERVICE_KEY
// 파일명이 '_' 로 시작하므로 Vercel 은 이 파일을 함수 엔드포인트로 노출하지 않는다.
// ========================================
const https = require('node:https')
const { URL } = require('node:url')

// 공공데이터 엔드포인트
const CLINICS_API = 'https://apis.data.go.kr/1741000/clinics/info'
const PHARMACIES_API = 'https://apis.data.go.kr/1741000/pharmacies/info'

const NUM_OF_ROWS = 100 // 이 API 페이지당 최대 100건
const DEFAULT_SINCE_MONTHS = 6 // 의원 "신규 개원" 기본 기간(개월) — 오늘 기준 롤링
const MAX_CONCURRENT_PAGES = 5 // 페이지네이션 동시요청 상한(정부 API 과부하·타임아웃 방지)

// 오늘 기준 N개월 전 날짜를 'YYYY-MM-DD'로 반환 — 의원 개원일 필터(LCPMT_YMD::GTE)에 사용.
// (server.js·Vercel 함수는 실제 런타임이라 new Date() 사용 가능)
function sinceDateFromMonths(months) {
  const n = Number(months)
  const m = Number.isFinite(n) && n >= 1 && n <= 24 ? Math.floor(n) : DEFAULT_SINCE_MONTHS
  const d = new Date()
  d.setMonth(d.getMonth() - m)
  return d.toISOString().slice(0, 10)
}

// serviceKey 는 매 호출 시점에 읽는다(콜드스타트/모듈 캐시 타이밍 무관).
// 일부 플랫폼에서 환경변수에 trailing newline 이 붙는 경우가 있어 .trim() 적용.
function getServiceKey() {
  return (process.env.SERVICE_KEY || '').trim()
}

// cond[KEY]=VAL 형태 파라미터 인코딩 (대괄호·:: 모두 인코딩 필요)
function encodeCond(key, val) {
  return 'cond' + encodeURIComponent('[' + key + ']') + '=' + encodeURIComponent(val)
}

// 의원 조회 URL 생성 (지역·페이지·개원일 기준일)
function buildClinicsUrl(regionLike, pageNo, sinceDate) {
  const params = [
    'serviceKey=' + getServiceKey(),
    'returnType=json',
    'numOfRows=' + NUM_OF_ROWS,
    'pageNo=' + pageNo,
    encodeCond('LCPMT_YMD::GTE', sinceDate),      // ★ 신규 개원 기준일(동적·롤링)
    encodeCond('SALS_STTS_CD::EQ', '01'),         // 영업중(고정)
    encodeCond('MDLCR_INST_BTP_NM::EQ', '의원'),   // 업태 의원(고정)
    encodeCond('ROAD_NM_ADDR::LIKE', regionLike), // ★ 지역(동적)
  ]
  return CLINICS_API + '?' + params.join('&')
}

// 약국 조회 URL 생성 (업태조건 불필요 — 영업중 + 지역만)
function buildPharmaciesUrl(regionLike, pageNo) {
  const params = [
    'serviceKey=' + getServiceKey(),
    'returnType=json',
    'numOfRows=' + NUM_OF_ROWS,
    'pageNo=' + pageNo,
    encodeCond('SALS_STTS_CD::EQ', '01'),         // 영업중(고정)
    encodeCond('ROAD_NM_ADDR::LIKE', regionLike), // ★ 지역(동적)
  ]
  return PHARMACIES_API + '?' + params.join('&')
}

// 응답에서 items.item 배열을 안전하게 추출 (단건이면 객체로 와서 배열화)
function normalizeItems(json) {
  const it = json && json.response && json.response.body && json.response.body.items
    ? json.response.body.items.item : null
  if (!it) return []
  return Array.isArray(it) ? it : [it]
}

// https GET → JSON 파싱. 상태코드/본문을 함께 반환해 호출부가 판단하게 함.
// timeoutMs: 응답 제한(기본 15초). HIRA 대용량 페이지는 느릴 수 있어 호출부에서 늘려 쓴다.
// 반환: { status, json, raw }
function httpsGetJson(urlStr, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        // User-Agent 필수: HIRA(B551182) 게이트웨이는 UA 없는 요청에 응답하지 않는다(행안부는 무관).
        headers: { Accept: 'application/json', 'User-Agent': 'clinic-pharmacy-map/1.0' },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(data) } catch (e) { /* XML 에러 등 — json은 null 유지 */ }
          resolve({ status: res.statusCode, json, raw: data })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('공공데이터 응답 시간 초과')))
    req.end()
  })
}

// 공공데이터 응답 1건의 정상 여부 검증 — 비정상이면 status 담은 Error를 던진다.
// (HTTP 상태 / JSON 파싱 / 표준 에러 헤더 3중 판정 — 전체조회·단일페이지 공용)
function assertOkResponse(r) {
  // HTTP 레벨 실패 (403 Forbidden 등 — 약국 활용신청 전 케이스 포함)
  if (r.status < 200 || r.status >= 300) {
    const err = new Error('공공데이터 응답 오류 (' + r.status + ')')
    err.status = r.status
    throw err
  }
  // JSON 파싱 실패 → 보통 XML 에러바디(키 미인증/서비스 차단 등)
  if (!r.json) {
    const err = new Error('공공데이터 응답을 해석할 수 없습니다 (비정상 응답)')
    err.status = 502
    err.raw = r.raw
    throw err
  }
  // 공공데이터 표준 에러 헤더 판정(정상 코드/메시지가 아니면 오류)
  const header = r.json.response && r.json.response.header
  const OK_CODES = ['0', '00', '000', 'INFO-0', 'INFO-00', 'INFO-000']
  if (
    header && header.resultCode != null &&
    !OK_CODES.includes(String(header.resultCode)) &&
    !/정상|normal/i.test(String(header.resultMsg || ''))
  ) {
    const err = new Error('공공데이터 오류: ' + (header.resultMsg || header.resultCode))
    err.status = 502
    err.resultCode = header.resultCode
    throw err
  }
}

// 응답에서 totalCount 추출
function totalCountOf(json) {
  return Number((json.response && json.response.body && json.response.body.totalCount) || 0)
}

// 한 데이터셋을 전체 페이지네이션해 item 배열로 합쳐 가져온다.
// urlBuilder(regionLike, pageNo) 를 주입받아 의원/약국 공용으로 사용.
// 반환: { items, totalCount }
// 비정상(인증/권한 등) 응답이면 status 가 담긴 Error 를 던진다.
async function fetchAllPaged(urlBuilder, regionLike) {
  const first = await httpsGetJson(urlBuilder(regionLike, 1))
  assertOkResponse(first)
  const total = totalCountOf(first.json)
  let items = normalizeItems(first.json)

  const totalPages = Math.ceil(total / NUM_OF_ROWS)
  if (totalPages > 1) {
    // 2페이지부터 끝까지를 동시요청 상한(MAX_CONCURRENT_PAGES)으로 나눠 가져온다.
    // 전체를 한꺼번에 Promise.all 하면 정부 API가 과부하로 응답을 끊어(타임아웃) 버린다.
    // (단일 스레드라 await 사이가 없는 items 갱신은 레이스 없음)
    let nextPage = 2
    async function worker() {
      while (nextPage <= totalPages) {
        const p = nextPage++
        const r = await httpsGetJson(urlBuilder(regionLike, p))
        if (r.json) items = items.concat(normalizeItems(r.json))
      }
    }
    const poolSize = Math.min(MAX_CONCURRENT_PAGES, totalPages - 1)
    await Promise.all(Array.from({ length: poolSize }, () => worker()))
  }

  return { items, totalCount: total }
}

// 고수준 조회 함수 — 핸들러는 이것만 호출한다.
// sinceMonths: 의원 개원일 롤링 기간(개월, 기본 6). 적용된 기준일(sinceDate)도 함께 반환.
function getClinics(region, sinceMonths) {
  const sinceDate = sinceDateFromMonths(sinceMonths)
  return fetchAllPaged((r, p) => buildClinicsUrl(r, p, sinceDate), region)
    .then((res) => ({ ...res, sinceDate }))
}
function getPharmacies(region) {
  return fetchAllPaged(buildPharmaciesUrl, region)
}

// 약국 단일 페이지 조회(프론트 점진 로딩용).
// 반환: { items, totalCount, pageNo, totalPages }
async function getPharmaciesPage(region, pageNo) {
  const r = await httpsGetJson(buildPharmaciesUrl(region, pageNo))
  assertOkResponse(r)
  const total = totalCountOf(r.json)
  return {
    items: normalizeItems(r.json),
    totalCount: total,
    pageNo,
    totalPages: Math.ceil(total / NUM_OF_ROWS),
  }
}

// JSON 응답 헬퍼 — Vercel res / Node http res 양쪽 호환(둘 다 ServerResponse).
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

// 요청에서 region 추출 — Vercel(req.query 자동) / 로컬(server.js 주입) 공용.
function getRegion(req) {
  const q = req.query || {}
  return (q.region || '서울특별시').trim() || '서울특별시'
}

// 요청에서 의원 개원일 롤링 기간(개월) 추출 — 기본 6, 1~24 범위로 보정.
function getSinceMonths(req) {
  const q = req.query || {}
  const n = parseInt(q.since, 10)
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : DEFAULT_SINCE_MONTHS
}

// ========================================
// 🏥 HIRA(심평원) 병원정보 보강 — 의원 의사수
// ----------------------------------------
// 행안부 신규 의원에 "처방 잠재력(규모)" 신호로 의사수를 붙이기 위한 조회.
// 같은 data.go.kr 계정 키로 호출(계정당 1키). 지역 매핑은 hira-regions.js.
// ========================================
const { resolveHiraRegion } = require('./hira-regions')
const HIRA_HOSP_API = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'
const HIRA_NUM_ROWS = 1000 // HIRA 페이지당 최대 1000건
const HIRA_TIMEOUT_MS = 25000 // HIRA 대용량 페이지는 느릴 수 있어 넉넉히

// HIRA 의원(clCd=31) 구 단위 조회 URL
function buildHiraClinicsUrl(sidoCd, sgguCd, pageNo) {
  const params = [
    'serviceKey=' + getServiceKey(),
    '_type=json',
    'clCd=31',
    'numOfRows=' + HIRA_NUM_ROWS,
    'pageNo=' + pageNo,
    'sidoCd=' + sidoCd,
    'sgguCd=' + sgguCd,
  ]
  return HIRA_HOSP_API + '?' + params.join('&')
}

// 의원명 정규화(매칭 키) — 공백·괄호·'의원' 제거. 행안부·HIRA 양쪽 동일 규칙(매칭률 98% 확인).
function normClinicName(s) {
  return String(s || '').replace(/\s|의원|\(.*?\)/g, '').trim()
}

// 구 단위 HIRA 의원 → { 정규화명: { drTotCnt, sdrCnt } } 맵.
// 지역 매핑 실패/에러 시 빈 맵(보강은 best-effort — 본 의원 조회를 절대 막지 않는다).
async function fetchHiraDoctorMap(sidoFull, sigungu) {
  const region = resolveHiraRegion(sidoFull, sigungu)
  if (!region) return {}
  const map = {}
  const collect = (json) => {
    let it = json && json.response && json.response.body && json.response.body.items
      ? json.response.body.items.item : null
    if (!it) return
    if (!Array.isArray(it)) it = [it]
    for (const o of it) {
      const k = normClinicName(o.yadmNm)
      if (k) map[k] = { drTotCnt: Number(o.drTotCnt) || 0, sdrCnt: Number(o.mdeptSdrCnt) || 0 }
    }
  }
  try {
    const first = await httpsGetJson(buildHiraClinicsUrl(region.sidoCd, region.sgguCd, 1), HIRA_TIMEOUT_MS)
    if (!first.json || first.status < 200 || first.status >= 300) return {}
    collect(first.json)
    const totalPages = Math.ceil(totalCountOf(first.json) / HIRA_NUM_ROWS)
    if (totalPages > 1) {
      let next = 2
      const worker = async () => {
        while (next <= totalPages) {
          const p = next++
          const r = await httpsGetJson(buildHiraClinicsUrl(region.sidoCd, region.sgguCd, p), HIRA_TIMEOUT_MS)
          if (r.json) collect(r.json)
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PAGES, totalPages - 1) }, worker))
    }
    return map
  } catch (e) {
    return {}
  }
}

module.exports = {
  NUM_OF_ROWS,
  getServiceKey,
  getClinics,
  getPharmacies,
  getPharmaciesPage,
  fetchHiraDoctorMap,
  normClinicName,
  sendJson,
  getRegion,
  getSinceMonths,
}
