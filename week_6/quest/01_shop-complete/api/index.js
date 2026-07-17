// Vercel 서버리스 진입점
// 로컬은 server.js가 http 서버로 상주하지만, Vercel은 요청마다 이 함수가 호출된다.
// server.js의 handleRequest(req,res)를 그대로 재사용하고, 콜드스타트 때 DB 초기화를 1회 보장한다.
const { handleRequest, ensureInit } = require('../server.js')

module.exports = async (req, res) => {
  await ensureInit()
  return handleRequest(req, res)
}
