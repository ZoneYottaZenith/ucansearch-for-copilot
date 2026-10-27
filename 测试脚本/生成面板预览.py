"""
把面板渲染成静态 HTML，方便用浏览器直接看排版。

webview 里有三个东西会挡住预览：
1. %CSP% / %CSS_URI% / %SCRIPT_URI% / %NONCE% 占位符（由 panel.ts 运行时替换）
2. acquireVsCodeApi() 在普通浏览器里不存在
3. 没有任何 state 回传，界面是空的

这里一次性全部补齐，只写进 测试脚本/输出/，不碰源码。

跑法：
    uv run --no-project python "测试脚本/生成面板预览.py"
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "media" / "panel.html"
TARGET = ROOT / "测试脚本" / "输出" / "预览面板.html"

# 预览用的假状态：模拟"已接入 + 存过密钥"
MOCK_STATE = """{
				enabled: true,
				baseUrl: "https://api.deepseek.com",
				hasApiKey: true,
				keyMask: "sk-a••••••••••••••••••••4567",
				defaultCount: 5
			}"""

# 余额晚一点才到，正好看清递增动画
MOCK_BALANCE = """{
					type: "balance",
					available: true,
					currency: "CNY",
					total: "12.34",
					granted: "2.00",
					toppedUp: "10.34"
				}"""

MOCK = f"""<script>
	// 模拟 VS Code 的 webview 桥：收到 ready 就回一份 state，再补一条余额
	// 所有发出的消息都记到 window.__sent，方便自检脚本断言
	window.__sent = [];
	window.acquireVsCodeApi = () => ({{
		postMessage(message) {{
			window.__sent.push(message);
			if (message && message.type === "ready") {{
				setTimeout(() => window.postMessage({{ type: "state", state: {MOCK_STATE} }}, "*"), 30);
				setTimeout(() => window.postMessage({MOCK_BALANCE}, "*"), 400);
			}}
		}},
		setState() {{}},
		getState() {{ return {{}}; }}
	}});
</script>"""

# 预览环境里没有 VS Code 的主题变量，手动补一套，才能看出深浅主题下的对比度
DARK_VARS = """<style>
	:root {
		--vscode-foreground: #cccccc;
		--vscode-descriptionForeground: #9d9d9d;
		--vscode-input-background: #313131;
		--vscode-input-foreground: #cccccc;
		--vscode-input-border: #3c3c3c;
		--vscode-input-placeholderForeground: #8f8f8f;
		--vscode-button-background: #0078d4;
		--vscode-button-foreground: #ffffff;
		--vscode-widget-border: #454545;
		--vscode-focusBorder: #0078d4;
		--vscode-textCodeBlock-background: #1f1f1f;
		--vscode-notifications-background: #1f1f1f;
		--vscode-testing-iconPassed: #3fb950;
		--vscode-errorForeground: #f85149;
	}
	body { background: #1f1f1f; }
</style>"""

LIGHT_VARS = """<style>
	:root {
		--vscode-foreground: #3b3b3b;
		--vscode-descriptionForeground: #6f6f6f;
		--vscode-input-background: #ffffff;
		--vscode-input-foreground: #3b3b3b;
		--vscode-input-border: #cecece;
		--vscode-input-placeholderForeground: #999999;
		--vscode-button-background: #005fb8;
		--vscode-button-foreground: #ffffff;
		--vscode-widget-border: #e5e5e5;
		--vscode-focusBorder: #005fb8;
		--vscode-textCodeBlock-background: #f6f6f6;
		--vscode-notifications-background: #ffffff;
		--vscode-testing-iconPassed: #1a7f37;
		--vscode-errorForeground: #c72e2e;
	}
	body { background: #ffffff; }
</style>"""


def build(theme: str) -> str:
    html = SOURCE.read_text(encoding="utf-8")
    # 预览是本地看效果，CSP 直接放开：真实 webview 里用的是 panel.ts 拼的那份
    html = html.replace(
        "%CSP%",
        "default-src * 'unsafe-inline' 'unsafe-eval' data: file: blob:",
    )
    html = html.replace("%CSS_URI%", "../../media/panel.css")
    html = html.replace("%SCRIPT_URI%", "../../media/panel.js")
    html = html.replace("%NONCE%", "preview")

    # 主题变量 + mock 都要在文档渲染前就位
    inject = (DARK_VARS if theme == "dark" else LIGHT_VARS) + MOCK
    html = html.replace("</head>", f"{inject}</head>", 1)
    return html


def main() -> int:
    if not SOURCE.exists():
        print(f"找不到 {SOURCE}")
        return 1

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    for theme, name in (("light", "预览面板-浅色.html"), ("dark", "预览面板-深色.html")):
        path = TARGET.parent / name
        path.write_text(build(theme), encoding="utf-8")
        print(f"已生成 {path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
