"""
OCR 接口冒烟测试（只读）。

用途：验证 DeepSeek 的 POST /v1/tools/ocr 能不能正常吃下本地 PDF。
约束：
  - 只读本地文件，不做任何修改、删除、写入。
  - 密钥只从环境变量 DEEPSEEK_TEST_KEY 读取，不落盘、不打印。
  - 每个文件只发一次请求，不重试（解析是按页计费的，重发等于重复扣钱）。

用法：
  uv run --with requests ocr冒烟.py <pdf1> [pdf2] ...
"""

import os
import sys
from pathlib import Path

import requests

OCR_URL = "https://api.deepseek.com/v1/tools/ocr"
# 官方总时限 180 秒（含上传），这里留一点余量
TIMEOUT_SECONDS = 200
PREVIEW_CHARS = 300


def describe_error(response: requests.Response) -> str:
    """把上游错误翻成一句能看的话。"""
    try:
        body = response.json()
        message = (body.get("error") or {}).get("message") or ""
    except ValueError:
        message = response.text.strip()[:300]
    return f"HTTP {response.status_code}" + (f"（上游原话：{message}）" if message else "")


def ocr_one(path: Path, api_key: str) -> None:
    size_mb = path.stat().st_size / 1024 / 1024
    print(f"\n=== {path.name}（{size_mb:.2f} MB）===")

    # purpose 必须在 file 之前，官方明确要求，反了会 400
    form = [
        ("purpose", (None, "text_recognition")),
        ("file", (path.name, path.read_bytes(), "application/pdf")),
    ]

    response = requests.post(
        OCR_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        files=form,
        timeout=TIMEOUT_SECONDS,
    )

    if not response.ok:
        print(f"失败：{describe_error(response)}")
        return

    # 识别期间服务端会垫换行保活，前导空白对 JSON 解析无害
    try:
        body = response.json()
    except ValueError:
        print(f"失败：返回的不是 JSON，原文前 200 字：{response.text[:200]!r}")
        return

    # 200 也可能是错误对象（识别开始后失败 / 超时）
    if isinstance(body.get("error"), dict):
        print(f"失败：{body['error'].get('message')}")
        return

    pages = body.get("pages") or []
    usage = body.get("usage") or {}
    print(f"成功：{body.get('page_count')} 页，tokens {usage.get('total_tokens')}")

    for page in pages:
        text = (page.get("text") or "").strip()
        reason = page.get("finish_reason")
        head = text[:PREVIEW_CHARS].replace("\n", " ⏎ ")
        print(f"  第 {int(page.get('index', 0)) + 1} 页（{reason}，{len(text)} 字）：{head}")


def main() -> int:
    api_key = os.environ.get("DEEPSEEK_TEST_KEY", "").strip()
    if not api_key:
        print("缺少环境变量 DEEPSEEK_TEST_KEY")
        return 2

    targets = [Path(arg) for arg in sys.argv[1:]]
    if not targets:
        print("用法：uv run --with requests ocr冒烟.py <pdf1> [pdf2] ...")
        return 2

    for target in targets:
        if not target.is_file():
            print(f"\n跳过（不是文件）：{target}")
            continue
        try:
            ocr_one(target, api_key)
        except requests.RequestException as error:
            print(f"失败：请求异常 {error}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
