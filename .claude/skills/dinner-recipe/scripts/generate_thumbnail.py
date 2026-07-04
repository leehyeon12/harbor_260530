#!/usr/bin/env python3
"""fal.ai(flux/schnell)로 요리 썸네일 이미지를 생성해 저장한다.

사용법:
    FAL_KEY=... python3 generate_thumbnail.py \
        --prompt "A delicious bowl of ...food photography..." \
        --output week_4/quest/04_dinner-recipe/recipes/thumbnails/dish.jpg

설계 원칙:
  - API 키는 코드에 하드코딩하지 않고 환경변수 FAL_KEY 로만 읽는다.
  - 표준 라이브러리(urllib)만 사용한다 → pip 설치 불필요.
  - 실패(키 없음/네트워크/HTTP 오류/유효하지 않은 이미지)해도 예외로 죽지 않고
    경고 메시지만 남기고 종료코드 1 로 끝낸다. (레시피 .md 본문은 스킬 쪽에서 이미 만들어짐)
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# fal.ai 동기 실행 엔드포인트. 요청 바디의 prompt 로 이미지를 만들고 결과 JSON을 바로 돌려준다.
FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell"


def fail(msg: str) -> None:
    """레시피 본문은 이미 생성되었음을 알리고 경고만 남긴 뒤 종료한다."""
    print(f"⚠️  썸네일 생성 실패: {msg}")
    print("   (레시피 .md 본문은 그대로 유지됩니다. 잠시 후 다시 시도해도 됩니다.)")
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="fal.ai로 요리 썸네일 생성")
    parser.add_argument("--prompt", required=True, help="영문 푸드 포토그래피 프롬프트")
    parser.add_argument("--output", required=True, help="저장할 이미지 경로 (.jpg)")
    parser.add_argument("--size", default="square_hd",
                        help="이미지 크기 프리셋 (기본 square_hd = 1024x1024)")
    args = parser.parse_args()

    fal_key = os.environ.get("FAL_KEY")
    if not fal_key:
        fail("환경변수 FAL_KEY 가 없습니다. `export FAL_KEY=...` 후 다시 실행하세요.")

    # 1) fal.ai 에 이미지 생성 요청
    body = json.dumps({
        "prompt": args.prompt,
        "image_size": args.size,
        "num_images": 1,
    }).encode("utf-8")
    req = urllib.request.Request(
        FAL_ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Key {fal_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:300]
        fail(f"fal.ai HTTP {e.code} — {detail}")
    except urllib.error.URLError as e:
        fail(f"네트워크 오류 — {e.reason}")
    except json.JSONDecodeError:
        fail("fal.ai 응답을 JSON으로 해석할 수 없습니다.")

    # 2) 응답에서 이미지 URL 추출
    images = result.get("images") or []
    if not images or not images[0].get("url"):
        fail(f"응답에 이미지 URL이 없습니다. 응답: {str(result)[:200]}")
    image_url = images[0]["url"]

    # 3) 이미지 URL 다운로드
    try:
        with urllib.request.urlopen(image_url, timeout=180) as img_resp:
            data = img_resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        fail(f"이미지 다운로드 실패 — {e}")

    # 4) 실제 이미지인지 매직바이트로 검증 (JPEG: ffd8ff / PNG: 89504e47)
    if not data or len(data) < 1000 or not (
        data[:3] == b"\xff\xd8\xff" or data[:4] == b"\x89PNG"
    ):
        fail("유효한 이미지 데이터가 아닙니다.")

    # 5) 저장
    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(data)
    print(f"✅ 썸네일 저장: {args.output} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
