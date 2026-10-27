"""
把彩色 SVG 转成侧边栏能用的单色版。

VS Code 活动栏图标是 CSS mask 渲染的：只取 alpha 通道，颜色全部由主题决定。
所以 18 层渐变蓝在这里毫无意义，只会让形状糊在一起。统一填 currentColor 即可。

跑法：
    uv run --no-project python "测试脚本/转单色图标.py" <源.svg> <目标.svg>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def main() -> int:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "UCanSearch-logo.svg")
    target = Path(sys.argv[2] if len(sys.argv) > 2 else "media/icon.svg")

    if not source.exists():
        print(f"找不到源文件 {source}")
        return 1

    text = source.read_text(encoding="utf-8")

    # 去掉生成器注释，避免它出现在打包产物里
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)

    # 所有颜色统一成 currentColor：mask 只看 alpha，颜色留一种就够了
    before = len(re.findall(r'fill="#[0-9a-fA-F]{3,8}"', text))
    text = re.sub(r'fill="#[0-9a-fA-F]{3,8}"', 'fill="currentColor"', text)

    # data-color-layer 是矢量化工具留的元数据，颜色信息没用了
    text = re.sub(r'\s*data-color-layer="[^"]*"', "", text)

    if "viewBox" not in text:
        print("源文件没有 viewBox，先补一个再转")
        return 1

    # 图形占满画布时，24px 侧边栏里会顶到边、看着比别的图标大一圈。
    # 这里把 viewBox 四周各外扩 6%，等于给图标加了一圈呼吸的余地。
    def pad_viewbox(match: re.Match[str]) -> str:
        x, y, w, h = (float(v) for v in match.group(1).replace(",", " ").split())
        pad_x, pad_y = w * 0.06, h * 0.06
        return (
            f'viewBox="{x - pad_x:g} {y - pad_y:g} '
            f'{w + pad_x * 2:g} {h + pad_y * 2:g}"'
        )

    text = re.sub(r'viewBox="([^"]+)"', pad_viewbox, text, count=1)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")

    size_kb = len(text.encode("utf-8")) / 1024
    print(f"已生成 {target}（{size_kb:.1f} KB），把 {before} 处颜色换成了 currentColor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
