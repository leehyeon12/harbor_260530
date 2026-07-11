#!/usr/bin/env bash
#
# 유튜브 URL에서 영상(mp4) + 음원(mp3)을 다운로드한다.
# 파일명 판단은 호출하는 쪽(모델)이 하고, 이 스크립트는 받은 이름 그대로 저장만 한다.
#
# 사용법:
#   download.sh <URL> <OUTPUT_DIR> <CLEAN_BASENAME> [MODE]
#
#   URL            유튜브 링크
#   OUTPUT_DIR     저장 폴더 (없으면 생성)
#   CLEAN_BASENAME 확장자 없는 파일 이름 (예: "Queen - Radio GaGa (Live Aid 1985)")
#   MODE           both(기본) | audio(mp3만) | video(mp4만)
#
# Homebrew(Apple Silicon) 경로를 PATH에 넣어 yt-dlp/ffmpeg를 찾는다.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

URL="${1:-}"
OUTPUT_DIR="${2:-}"
BASENAME="${3:-}"
MODE="${4:-both}"

if [[ -z "$URL" || -z "$OUTPUT_DIR" || -z "$BASENAME" ]]; then
  echo "오류: URL, OUTPUT_DIR, CLEAN_BASENAME 가 모두 필요합니다." >&2
  echo "사용법: download.sh <URL> <OUTPUT_DIR> <CLEAN_BASENAME> [both|audio|video]" >&2
  exit 1
fi

# 의존성 확인 — 없으면 설치 방법을 안내하고 종료한다.
missing=()
command -v yt-dlp >/dev/null 2>&1 || missing+=("yt-dlp")
command -v ffmpeg >/dev/null 2>&1 || missing+=("ffmpeg")
if (( ${#missing[@]} > 0 )); then
  echo "오류: ${missing[*]} 가 설치되어 있지 않습니다." >&2
  echo "설치: brew install ${missing[*]}" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# 슬래시 등 파일명에 못 쓰는 문자를 안전한 형태로 바꾼다.
SAFE_NAME="${BASENAME//\//-}"
OUT_TEMPLATE="${OUTPUT_DIR%/}/${SAFE_NAME}.%(ext)s"

if [[ "$MODE" == "both" || "$MODE" == "video" ]]; then
  echo "▶ 영상 다운로드 (최고화질 mp4): ${SAFE_NAME}.mp4"
  yt-dlp -f "bv*+ba/b" --merge-output-format mp4 \
    -o "$OUT_TEMPLATE" "$URL"
fi

if [[ "$MODE" == "both" || "$MODE" == "audio" ]]; then
  echo "▶ 음원 추출 (mp3, 최고품질): ${SAFE_NAME}.mp3"
  yt-dlp -x --audio-format mp3 --audio-quality 0 \
    -o "$OUT_TEMPLATE" "$URL"
fi

echo ""
echo "✅ 완료. 저장 위치: ${OUTPUT_DIR%/}/"
ls -lh "${OUTPUT_DIR%/}/${SAFE_NAME}."* 2>/dev/null || true
