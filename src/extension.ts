import * as vscode from "vscode";
import {
	getApiKey,
	getBaseUrl,
	getDefaultCount,
	isEnabled,
	setApiKey,
} from "./config";
import { ApiError } from "./http";
import { PanelViewProvider } from "./panel";
import { callSearch, formatSearchResults, validateQuery } from "./searchService";
import { registerFetchTool } from "./tools/fetchTool";
import { registerSearchTool } from "./tools/searchTool";

export function activate(context: vscode.ExtensionContext): void {
	const panel = new PanelViewProvider(context, context.secrets);

	/**
	 * 工具注册是可摘的。
	 *
	 * 关闭开关时必须真的把注册摘掉，让 Copilot 的工具列表里根本看不到它们；
	 * 只做"注册着但执行时拒绝"的话，模型照样会尝试调用，那不叫分离。
	 * 全程只碰自己的注册，不动 Copilot 的任何设置、内置工具或配置项。
	 */
	let tools: vscode.Disposable | undefined;

	const syncTools = (): void => {
		const enabled = isEnabled();
		if (enabled && !tools) {
			tools = vscode.Disposable.from(
				registerSearchTool(context.secrets),
				registerFetchTool(context.secrets)
			);
		} else if (!enabled && tools) {
			tools.dispose();
			tools = undefined;
		}
	};

	syncTools();

	context.subscriptions.push(
		new vscode.Disposable(() => tools?.dispose()),

		// 用户在设置页直接改开关时，也要跟着注册/注销
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration("ucansearch.enabled")) {
				return;
			}
			syncTools();
			void panel.refresh();
		}),

		vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, panel, {
			webviewOptions: { retainContextWhenHidden: true },
		}),

		vscode.commands.registerCommand("ucansearch.openPanel", async () => {
			await vscode.commands.executeCommand("workbench.view.extension.ucansearch");
			await vscode.commands.executeCommand("ucansearch.panel.focus");
		}),

		vscode.commands.registerCommand("ucansearch.setApiKey", async () => {
			const existing = await getApiKey(context.secrets);
			const value = await vscode.window.showInputBox({
				title: "UCanSearch：DeepSeek API Key",
				prompt: existing
					? "已经存过一把密钥，重新输入会覆盖；留空则清除。"
					: "在 platform.deepseek.com/api_keys 申请后粘贴到这里。",
				password: true,
				ignoreFocusOut: true,
				placeHolder: "sk-...",
			});
			if (value === undefined) {
				return;
			}
			const saved = await setApiKey(context.secrets, value);
			if (!saved) {
				void vscode.window.showWarningMessage(
					"密钥里只能有英文、数字和符号，检查一下是不是粘到了掩码。这次没有保存。"
				);
				return;
			}
			await panel.refresh();
			void vscode.window.showInformationMessage(
				value.trim() ? "API Key 已保存到系统密钥库。" : "API Key 已清除。"
			);
		}),

		vscode.commands.registerCommand("ucansearch.testSearch", async () => {
			const query = await vscode.window.showInputBox({
				title: "UCanSearch：测试搜索",
				prompt: "输入一个搜索词，直接打一次 DeepSeek Search 接口。",
				ignoreFocusOut: true,
				placeHolder: "DeepSeek V4.1 Flash 1017 lang:zh",
				validateInput: (value) => validateQuery(value),
			});
			if (!query) {
				return;
			}

			const apiKey = await getApiKey(context.secrets);
			if (!apiKey) {
				void vscode.window.showWarningMessage("还没配置 API Key，先用「UCanSearch: 设置 DeepSeek API Key」。");
				return;
			}

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `正在搜索：${query}` },
				async () => {
					try {
						const response = await callSearch({
							baseUrl: getBaseUrl(),
							apiKey,
							query,
							count: getDefaultCount(),
						});
						const items = Array.isArray(response.results) ? response.results : [];
						const text = formatSearchResults(query, items);

						const document = await vscode.workspace.openTextDocument({
							content: text,
							language: "markdown",
						});
						await vscode.window.showTextDocument(document, { preview: true });
					} catch (error) {
						const message = error instanceof ApiError ? error.message : String(error);
						void vscode.window.showErrorMessage(`搜索失败：${message}`);
					}
				}
			);
		})
	);
}

export function deactivate(): void {
	// 工具注册都挂在 context.subscriptions 上，由 VS Code 统一回收
}
