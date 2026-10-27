/**
 * 地址规范化。
 *
 * 单独放一个文件是因为它不依赖 vscode：工具、面板、测试脚本用的是同一份逻辑，
 * 少一份复制就少一处「测试过了但线上不是这段代码」。
 */

export const DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * 把用户填的地址整理成能直接拼 `/tools/search` 的形式。
 *
 * 用户可能填域名、带 /v1、带自建代理前缀，甚至直接粘贴完整接口地址。
 * 这里全部兜住，免得一个斜杠差异变成 404。
 */
export function normalizeBaseUrl(raw: unknown): string {
	let value = typeof raw === "string" ? raw.trim() : "";
	if (!value) {
		return `${DEFAULT_BASE_URL}/v1`;
	}
	// 粘贴了完整接口地址：切掉接口尾巴，回到基础地址
	value = value.replace(/\/tools\/(search|fetch)\/?$/i, "");
	value = value.replace(/\/+$/, "");
	// 已经带版本段就不再补，否则补 /v1
	if (!/\/v\d+[a-z0-9]*$/i.test(value)) {
		value = `${value}/v1`;
	}
	return value;
}

/**
 * 余额接口挂在根路径下（`/user/balance`，不带 /v1）。
 *
 * 所以先把版本段摘掉再拼，自建代理的前缀（如 /deepseek）依然保留。
 */
export function balanceUrlOf(baseUrl: string): string {
	return `${baseUrl.replace(/\/v\d+[a-z0-9]*$/i, "")}/user/balance`;
}
