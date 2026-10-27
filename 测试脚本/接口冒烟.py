"""
接口冒烟：真打一次 DeepSeek Search / Fetch，确认字段和我们的解析对得上。

需要密钥，从环境变量读（不要把 key 写进这个文件）：
    $env:DEEPSEEK_API_KEY = "sk-..."
    uv run --no-project python "测试脚本/接口冒烟.py"

没有密钥就直接跳过，退出码 0 —— 免得每次跑都红一片。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("UCANSEARCH_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()

SEARCH_FIELDS = {
    "rerank_score",
    "title",
    "url",
    "snippet",
    "summary",
    "content",
    "site_name",
    "site_icon",
    "date",
    "authority",
}


def post(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    if not API_KEY:
        print("⏭  没有 DEEPSEEK_API_KEY，跳过联网测试")
        return 0

    failures: list[str] = []

    # 1. 搜索
    try:
        result = post("/tools/search", {"query": "DeepSeek 官方文档 lang:zh", "count": 3})
        items = result.get("results")
        if not isinstance(items, list):
            failures.append(f"search 返回里没有 results 数组：{result!r}")
        elif not items:
            print("⚠️  search 返回 0 条，网络或关键词问题，不算失败")
        else:
            extra = set(items[0]) - SEARCH_FIELDS
            print(f"✅ search 正常，{len(items)} 条；首条字段：{sorted(items[0])}")
            if extra:
                print(f"   ℹ️ 文档之外的新字段：{sorted(extra)}")
    except urllib.error.HTTPError as error:
        failures.append(f"search 失败 HTTP {error.code}：{error.read().decode('utf-8', 'ignore')[:300]}")
    except Exception as error:  # noqa: BLE001
        failures.append(f"search 异常：{error}")

    # 2. 抓取
    try:
        page = post("/tools/fetch", {"url": "https://api-docs.deepseek.com/zh-cn/guides/search"})
        if not isinstance(page.get("content"), str) or not page["content"].strip():
            failures.append("fetch 没返回正文")
        else:
            print(f"✅ fetch 正常，标题={page.get('title')!r}，正文 {len(page['content'])} 字符")
    except urllib.error.HTTPError as error:
        failures.append(f"fetch 失败 HTTP {error.code}：{error.read().decode('utf-8', 'ignore')[:300]}")
    except Exception as error:  # noqa: BLE001
        failures.append(f"fetch 异常：{error}")

    # 3. 参数边界：count 超出范围应该被上游拒绝
    try:
        post("/tools/search", {"query": "test", "count": 999})
        failures.append("count=999 竟然成功了，上游边界可能变了")
    except urllib.error.HTTPError as error:
        if error.code == 400:
            print("✅ count=999 被正确拒绝（HTTP 400）")
        else:
            failures.append(f"count=999 返回了 {error.code}，预期 400")
    except Exception as error:  # noqa: BLE001
        failures.append(f"count 边界测试异常：{error}")

    if failures:
        print(f"\n❌ {len(failures)} 项不通过")
        for item in failures:
            print(f"   - {item}")
        return 1

    print("\n全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
