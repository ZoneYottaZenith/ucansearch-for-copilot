"""
检查图标 SVG 能不能当侧边栏图标用。

侧边栏图标在 VS Code 里是用 CSS mask 渲染的：
只取 alpha 通道，颜色由主题决定。
所以真正要检查的是——图形是不是单色实心、有没有铺满整块画布的背景。

跑法：
    uv run --no-project python "测试脚本/检查图标SVG.py" "UCanSearch-logo.svg"
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "UCanSearch-logo.svg")
    if not path.exists():
        print(f"找不到 {path}")
        return 1

    text = path.read_text(encoding="utf-8")
    size_kb = len(text.encode("utf-8")) / 1024

    viewbox = re.search(r'viewBox="([^"]+)"', text)
    colors = sorted(set(re.findall(r'#[0-9a-fA-F]{3,8}\b', text)))
    paths = len(re.findall(r"<path\b", text))
    rects = len(re.findall(r"<rect\b", text))
    circles = len(re.findall(r"<circle\b|<ellipse\b", text))
    fills = sorted(set(re.findall(r'fill="([^"]*)"', text)))
    strokes = sorted(set(re.findall(r'stroke="([^"]*)"', text)))
    opacity = sorted(set(re.findall(r'opacity="([^"]*)"', text)))

    print(f"文件：{path.name}")
    print(f"大小：{size_kb:.1f} KB")
    print(f"viewBox：{viewbox.group(1) if viewbox else '（没有，缩放可能出问题）'}")
    print(f"图形：path {paths} 个，rect {rects} 个，circle/ellipse {circles} 个")
    print(f"颜色：{', '.join(colors) if colors else '（无，用默认黑）'}")
    print(f"fill：{fills or '（未声明，默认 black）'}")
    print(f"stroke：{strokes or '（无）'}")
    print(f"opacity：{opacity or '（无）'}")

    problems: list[str] = []
    if not viewbox:
        problems.append("没有 viewBox，在固定尺寸里会裁切")
    if rects:
        problems.append(f"有 {rects} 个 <rect>，如果其中一个是铺满画布的背景，侧边栏会变成一个实心方块")
    if len(colors) > 1:
        problems.append(f"用了 {len(colors)} 种颜色；mask 只取 alpha，多色会塌成一个形状")
    if size_kb > 200:
        problems.append(f"文件 {size_kb:.0f} KB 偏大，缩到 24px 时渲染又慢又容易糊")
    if paths > 400:
        problems.append(f"{paths} 条路径，属于「矢量化过拟合」，24px 下细节全糊成一坨")

    if problems:
        print("\n需要注意：")
        for item in problems:
            print(f"  - {item}")
    else:
        print("\n✅ 没有明显问题，可以直接当侧边栏图标")

    return 0


if __name__ == "__main__":
    sys.exit(main())
