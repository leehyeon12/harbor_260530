# Q5 [My Agent] 관심분야 자동 리서치 스킬

매주 반복하는 "웹 리서치 → md 정리 → 노션 공유"를 **재사용 스킬**로 박제. "○○ 리서치 해줘" 한마디로 재현된다. 주제는 **카페 창업**(Q6 카페 컨설턴트로 연결).

## 스킬 위치

- **본체**: `.claude/skills/research/SKILL.md` (`/research` 또는 "○○ 트렌드 조사해줘"로 호출)
- Playwright MCP(브라우저 탐색) + Notion MCP(공유, 보너스) 사용

## 만드는 과정 (손으로 한 번 → 박제 → 재호출)

1. **손으로 한 번**: "브라우저로 카페 창업 트렌드 사이트 3곳+ 돌아보고 research.md로 정리 후 노션에 올려줘" → 실제 탐색·정리·업로드.
2. **박제**: 위 절차를 `.claude/skills/research/SKILL.md`로 저장.
3. **재호출**: `/reload-plugins` 후 "디저트 카페 메뉴 트렌드 리서치 해줘" → 스킬이 같은 절차·포맷을 재현.

## 산출물 (재호출 결과 2개 — 같은 포맷)

| 파일 | 주제 | 탐색 스크린샷 |
|---|---|---|
| `research-cafe-trend-2026-07-10.md` | 카페 창업 트렌드 | `research-site1/2/3-*.png` |
| `research-dessert-menu-2026-07-10.md` | 디저트 카페 메뉴 트렌드 | `research2-site1/2/3-*.png` |

정해진 포맷: **제목 · 수집일 · 출처별 핵심(사이트당 3줄) · 한 줄 요약 · 다음 액션**.

## 노션 업로드 (보너스)

- 카페 창업 트렌드: https://app.notion.com/p/39971ed00f0881f59389c9b1968e0c84
- 디저트 카페 메뉴: https://app.notion.com/p/39971ed00f08819e84aacbc549f8bdc1

## 폴더 구조

```
week_5/quest/05_research-skill/
├── README.md
├── research-cafe-trend-2026-07-10.md      # 1차 산출물
├── research-dessert-menu-2026-07-10.md    # 2차(재호출) 산출물 — 같은 포맷
├── research-site1/2/3-*.png               # 1차 탐색 스크린샷 3장
├── research2-site1/2/3-*.png              # 2차 탐색 스크린샷 3장
└── (스킬 본체는 .claude/skills/research/SKILL.md)
```

## 제출물 체크리스트 (마감: 금요일 23:59)
- [x] 주제 + 탐색 사이트 목록
- [x] 자동 탐색 스크린샷 3장+ (총 6장)
- [x] `.claude/skills/research/SKILL.md`
- [x] 재호출 결과 2개 (같은 포맷 재현)
- [x] (보너스) 노션 자동 업로드 2건
