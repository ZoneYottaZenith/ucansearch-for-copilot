"""
清单校验：不联网，只查静态一致性。

跑法：
    uv run --no-project python "测试脚本/清单校验.py"

查这些：
1. package.json 里工具 id 符合 VS Code 的命名规则（^(?!copilot_|vscode_)[\\w-]+$）
2. 每个工具的必填字段齐全，inputSchema 的 required 都能在 properties 里找到
3. activationEvents 跟工具 id 一一对应
4. 每个配置项都有 default（没有 default 的话面板读出来是 undefined）
5. panel.html 里的 %占位符% 都能被 panel.ts 替换掉（漏一个就是页面上明晃晃的 %XXX%）
6. panel.js 里 $("id") 引用的元素在 panel.html 里真的存在
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(message)


def main() -> int:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    contributes = package.get("contributes", {})
    tools = contributes.get("languageModelTools", [])

    check(bool(tools), "package.json 没有任何 languageModelTools")

    name_pattern = re.compile(r"^(?!copilot_|vscode_)[\w-]+$")
    tool_ids: list[str] = []

    for tool in tools:
        name = tool.get("name", "")
        tool_ids.append(name)
        check(bool(name_pattern.match(name)), f"工具 id 不合规：{name!r}")
        for field in ("displayName", "modelDescription"):
            check(bool(tool.get(field)), f"工具 {name} 缺字段 {field}")

        schema = tool.get("inputSchema")
        check(isinstance(schema, dict), f"工具 {name} 的 inputSchema 不是对象")
        if isinstance(schema, dict):
            check(schema.get("type") == "object", f"工具 {name} 的 inputSchema.type 必须是 object")
            properties = schema.get("properties") or {}
            for required in schema.get("required") or []:
                check(
                    required in properties,
                    f"工具 {name} 的 required 里有 {required!r}，但 properties 里没有",
                )

        if tool.get("canBeReferencedInPrompt"):
            ref = tool.get("toolReferenceName", "")
            check(bool(re.match(r"^[\w-]+$", ref)), f"工具 {name} 的 toolReferenceName 不合规：{ref!r}")

        # 关闭开关时，工具必须从 Copilot 的工具列表里消失。
        # 只靠代码里 dispose 是不够的：manifest 声明的工具数据还在，
        # 必须用 when 让 VS Code 在列工具时直接过滤掉。
        check(
            tool.get("when") == "config.ucansearch.enabled",
            f"工具 {name} 缺 when 条件，关闭开关后会残留在 Copilot 工具列表里",
        )

        # 图标：路径写错不会报错，只会安静地退回默认图标
        icon = tool.get("icon")
        if isinstance(icon, str):
            icon_paths = [icon]
        elif isinstance(icon, dict):
            icon_paths = [icon.get("light"), icon.get("dark")]
        else:
            icon_paths = []
        for icon_path in icon_paths:
            if icon_path:
                check(
                    (ROOT / icon_path).is_file(),
                    f"工具 {name} 的图标文件不存在：{icon_path}",
                )

    activation = package.get("activationEvents", [])
    for tool_id in tool_ids:
        check(
            f"onLanguageModelTool:{tool_id}" in activation,
            f"activationEvents 缺 onLanguageModelTool:{tool_id}",
        )

    # 工具集：tools 里引用的是 toolReferenceName，写错不会报错，只会安静地少一个成员
    tool_refs = {tool.get("toolReferenceName") for tool in tools if tool.get("toolReferenceName")}
    for tool_set in contributes.get("languageModelToolSets", []) or []:
        set_name = tool_set.get("name", "")
        check(bool(re.match(r"^[\w-]+$", set_name)), f"工具集 name 不合规：{set_name!r}")
        check(bool(tool_set.get("description")), f"工具集 {set_name} 缺 description")

        # 这个字段只吃 $(codicon)，填 SVG 路径会被 ThemeIcon.fromString 丢掉
        icon = tool_set.get("icon")
        if icon:
            check(
                bool(re.match(r"^\$\([\w-]+\)$", icon)),
                f"工具集 {set_name} 的 icon 只能是 $(图标名) 形式，收到 {icon!r}",
            )

        members = tool_set.get("tools") or []
        check(bool(members), f"工具集 {set_name} 的 tools 不能为空")
        for member in members:
            check(
                member in tool_refs,
                f"工具集 {set_name} 引用了 {member!r}，但没有工具用这个 toolReferenceName",
            )

    properties = contributes.get("configuration", {}).get("properties", {})
    for key, value in properties.items():
        check("default" in value, f"配置项 {key} 没有 default")

    # 占位符：panel.html 里出现的 %X%，panel.ts 里必须有一处 replace(/%X%/g, ...)
    html = (ROOT / "media" / "panel.html").read_text(encoding="utf-8")
    panel_ts = (ROOT / "src" / "panel.ts").read_text(encoding="utf-8")
    placeholders = set(re.findall(r"%([A-Z_]+)%", html))
    for placeholder in sorted(placeholders):
        check(
            f"/%{placeholder}%/g" in panel_ts,
            f"panel.html 用了 %{placeholder}%，但 panel.ts 没有替换它",
        )

    # DOM id：panel.js 里 $("xxx") 的每个 id 都要在 html 里存在
    script = (ROOT / "media" / "panel.js").read_text(encoding="utf-8")
    html_ids = set(re.findall(r'id="([\w-]+)"', html))
    for used in sorted(set(re.findall(r'\$\("([\w-]+)"\)', script))):
        check(used in html_ids, f"panel.js 引用了 #{used}，但 panel.html 里没有这个 id")

    total = checks
    if failures:
        print(f"❌ {len(failures)} 项不通过（共 {total} 项）")
        for item in failures:
            print(f"   - {item}")
        return 1

    print(f"✅ 全部通过（{total} 项）：工具 {', '.join(tool_ids)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
