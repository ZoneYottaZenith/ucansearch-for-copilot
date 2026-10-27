import * as vscode from "vscode";
import { fetchBalance } from "./balance";
import {
	DEFAULT_COUNT,
	clampInteger,
	getApiKey,
	getBaseUrl,
	getDefaultCount,
	isEnabled,
	setApiKey,
	setEnabled,
} from "./config";
import { ApiError } from "./http";
import { maskSecret } from "./mask";
import { callFetch, callSearch, formatFetchResult, formatSearchResults } from "./searchService";

const MEDIA_ROOT = "media";

const BAD_KEY_HINT = "密钥里只能有英文、数字和符号，检查一下是不是粘到了掩码";

interface PanelState {
	enabled: boolean;
	baseUrl: string;
	hasApiKey: boolean;
	/** 首尾明文、中间打点的密钥，用于回显；没密钥时为空串。 */
	keyMask: string;
	defaultCount: number;
}

type InboundMessage =
	| { type: "ready" }
	| { type: "setEnabled"; enabled: boolean }
	| {
			type: "save";
			baseUrl?: string;
			apiKey?: string;
			defaultCount?: number;
	  }
	| { type: "testSearch"; query: string; apiKey?: string }
	| { type: "testFetch"; url: string; apiKey?: string }
	| { type: "refreshBalance" }
	| { type: "openSettings" };

/**
 * 侧边栏面板。
 *
 * 只做三件事：看当前配置、改配置、当场试一次接口。
 * 密钥永远只往扩展里传，不回传给 webview。
 */
export class PanelViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "ucansearch.panel";

	private view: vscode.WebviewView | undefined;

	/** 正在拉余额时不再叠一个请求，反正是同一个数字。 */
	private balancePending = false;

	/** 面板消息排队执行：上一条（比如存地址）没完，下一条别抢跑。 */
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly secrets: vscode.SecretStorage
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, MEDIA_ROOT);

		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaRoot],
		};

		void this.render(view.webview, mediaRoot).then((html) => {
			view.webview.html = html;
		});

		view.webview.onDidReceiveMessage((message: InboundMessage) => {
			this.queue = this.queue.then(() => this.handle(message)).catch(() => undefined);
		});
	}

	/** 命令面板改完配置后，让面板跟上。 */
	async refresh(): Promise<void> {
		await this.postState();
	}

	private async render(webview: vscode.Webview, mediaRoot: vscode.Uri): Promise<string> {
		const [template, cssUri, scriptUri] = await Promise.all([
			vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaRoot, "panel.html")),
			Promise.resolve(webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "panel.css"))),
			Promise.resolve(webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "panel.js"))),
		]);

		const nonce = createNonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} data: https:`,
			`style-src ${webview.cspSource}`,
			`font-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
		].join("; ");

		return new TextDecoder().decode(template)
			.replace(/%CSP%/g, csp)
			.replace(/%CSS_URI%/g, cssUri.toString())
			.replace(/%SCRIPT_URI%/g, scriptUri.toString())
			.replace(/%NONCE%/g, nonce);
	}

	private async handle(message: InboundMessage): Promise<void> {
		switch (message.type) {
			case "ready":
				await this.postState();
				void this.refreshBalance();
				return;

			case "setEnabled":
				await setEnabled(message.enabled === true);
				await this.postState();
				// 单独回一条，前端据此弹 Toast，不和状态刷新混在一起
				await this.post({ type: "enabledChanged", enabled: message.enabled === true });
				return;

			case "save": {
				const ok = await this.save(message);
				if (!ok) {
					await this.post({ type: "saved", error: BAD_KEY_HINT });
					return;
				}
				// 先告诉前端“存好了”，再推状态：这样密钥框里的明文会先清掉、随后换成新掩码
				await this.post({ type: "saved" });
				await this.postState();
				// 刚换的密钥可能不是同一张卡，余额跟着重拉
				void this.refreshBalance();
				return;
			}

			case "testSearch":
				await this.testSearch(message.query, message.apiKey);
				return;

			case "testFetch":
				await this.testFetch(message.url, message.apiKey);
				return;

			case "refreshBalance":
				await this.refreshBalance();
				return;

			case "openSettings":
				await vscode.commands.executeCommand("workbench.action.openSettings", "ucansearch");
				return;

			default:
				return;
		}
	}

	private async save(message: Extract<InboundMessage, { type: "save" }>): Promise<boolean> {
		const config = vscode.workspace.getConfiguration("ucansearch");

		if (typeof message.baseUrl === "string") {
			await config.update("baseUrl", message.baseUrl.trim(), vscode.ConfigurationTarget.Global);
		}
		if (typeof message.defaultCount === "number") {
			// 存之前先夹进 1-50，否则设置文件里会留下一个读取时又被夹一次的越界值
			const count = clampInteger(message.defaultCount, 1, 50, DEFAULT_COUNT);
			await config.update("defaultCount", count, vscode.ConfigurationTarget.Global);
		}
		// 只有用户真的动了密钥框才写，空字符串表示清除
		if (typeof message.apiKey === "string") {
			const ok = await setApiKey(this.secrets, message.apiKey);
			if (!ok) {
				return false;
			}
		}
		return true;
	}

	private async testSearch(query: string, apiKeyInput?: string): Promise<void> {
		const keyword = (query ?? "").trim();
		if (!keyword) {
			await this.post({ type: "test", kind: "search", ok: false, text: "先填一个搜索词。" });
			return;
		}

		const apiKey = (apiKeyInput ?? "").trim() || (await getApiKey(this.secrets));
		if (!apiKey) {
			await this.post({ type: "test", kind: "search", ok: false, text: "还没填 API Key。" });
			return;
		}

		try {
			const response = await callSearch({
				baseUrl: getBaseUrl(),
				apiKey,
				query: keyword,
				count: getDefaultCount(),
			});
			const items = Array.isArray(response.results) ? response.results : [];
			await this.post({
				type: "test",
				kind: "search",
				ok: true,
				text: formatSearchResults(keyword, items),
			});
			// 刚才这次搜索花了两分钱，余额顺手刷一下
			void this.refreshBalance();
		} catch (error) {
			await this.post({ type: "test", kind: "search", ok: false, text: describe(error) });
		}
	}

	private async testFetch(url: string, apiKeyInput?: string): Promise<void> {
		const target = (url ?? "").trim();
		if (!target) {
			await this.post({ type: "test", kind: "fetch", ok: false, text: "先填一个网址。" });
			return;
		}

		const apiKey = (apiKeyInput ?? "").trim() || (await getApiKey(this.secrets));
		if (!apiKey) {
			await this.post({ type: "test", kind: "fetch", ok: false, text: "还没填 API Key。" });
			return;
		}

		try {
			const response = await callFetch({ baseUrl: getBaseUrl(), apiKey, url: target });
			await this.post({
				type: "test",
				kind: "fetch",
				ok: true,
				text: formatFetchResult(target, response),
			});
			void this.refreshBalance();
		} catch (error) {
			await this.post({ type: "test", kind: "fetch", ok: false, text: describe(error) });
		}
	}

	private async postState(): Promise<void> {
		const apiKey = await getApiKey(this.secrets);
		const state: PanelState = {
			enabled: isEnabled(),
			baseUrl: vscode.workspace.getConfiguration("ucansearch").get<string>("baseUrl", ""),
			hasApiKey: Boolean(apiKey),
			keyMask: maskSecret(apiKey),
			defaultCount: getDefaultCount(),
		};
		await this.post({ type: "state", state });
	}

	private async post(message: unknown): Promise<void> {
		await this.view?.webview.postMessage(message);
	}

	/**
	 * 拉一次余额发给面板。
	 *
	 * 余额只是锦上添花：没密钥就发个“空”的，拉失败也只记下原因，不当成错误弹出来。
	 */
	private async refreshBalance(): Promise<void> {
		if (this.balancePending) {
			return;
		}

		const apiKey = await getApiKey(this.secrets);
		if (!apiKey) {
			await this.post({ type: "balance", none: true });
			return;
		}

		this.balancePending = true;
		try {
			const snapshot = await fetchBalance(getBaseUrl(), apiKey);
			await this.post({ type: "balance", ...snapshot });
		} catch (error) {
			await this.post({ type: "balance", error: describe(error) });
		} finally {
			this.balancePending = false;
		}
	}
}

function describe(error: unknown): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error ?? "未知错误");
}

function createNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let value = "";
	for (let index = 0; index < 32; index++) {
		value += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return value;
}
