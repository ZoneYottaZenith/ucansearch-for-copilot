import * as vscode from "vscode";
import { isPlausibleSecret } from "./mask";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./url";

/**
 * 配置读写。
 *
 * API Key 放 SecretStorage，不落进设置文件——设置文件经常被同步、被截图、被贴到群里。
 */

const SECTION = "ucansearch";
const SECRET_KEY = "ucansearch.apiKey";

export const DEFAULT_COUNT = 5;

function config() {
	return vscode.workspace.getConfiguration(SECTION);
}

/** 把任意值收进 [min, max] 的整数，坏值退回默认。 */
export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(num)));
}

export function isEnabled(): boolean {
	return config().get<boolean>("enabled", true);
}

export async function setEnabled(value: boolean): Promise<void> {
	await config().update("enabled", value, vscode.ConfigurationTarget.Global);
}

export function getBaseUrl(): string {
	return normalizeBaseUrl(config().get<unknown>("baseUrl", DEFAULT_BASE_URL));
}

export function getDefaultCount(): number {
	return clampInteger(config().get<unknown>("defaultCount", DEFAULT_COUNT), 1, 50, DEFAULT_COUNT);
}
export async function getApiKey(secrets: vscode.SecretStorage): Promise<string> {
	return (await secrets.get(SECRET_KEY)) ?? "";
}

/**
 * 写密钥。空串表示清除。
 *
 * 返回 false 表示内容不像密钥（带了中文、空格或掩码圆点），什么都没写。
 */
export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<boolean> {
	const trimmed = key.trim();
	if (trimmed && !isPlausibleSecret(trimmed)) {
		return false;
	}
	if (trimmed) {
		await secrets.store(SECRET_KEY, trimmed);
	} else {
		await secrets.delete(SECRET_KEY);
	}
	return true;
}
