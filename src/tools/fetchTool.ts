import * as vscode from "vscode";
import { getApiKey, getBaseUrl, isEnabled } from "../config";
import { callFetch, formatFetchResult, validateUrl } from "../searchService";
import type { FetchToolInput } from "../types";
import { describeToolError, linkCancellation, textResult } from "./shared";

export const FETCH_TOOL_ID = "ucansearch_fetch_web";

export function registerFetchTool(secrets: vscode.SecretStorage): vscode.Disposable {
	return vscode.lm.registerTool<FetchToolInput>(FETCH_TOOL_ID, {
		prepareInvocation(options) {
			const url = typeof options.input?.url === "string" ? options.input.url : "";
			return {
				invocationMessage: `抓取网页：${url || "(空)"}`,
			};
		},

		async invoke(options, token) {
			if (!isEnabled()) {
				return textResult(
					"UCanSearch 已在设置里关闭（ucansearch.enabled = false），本次没有联网。请告诉用户先打开它。"
				);
			}

			const input = options.input ?? ({} as FetchToolInput);
			const url = typeof input.url === "string" ? input.url : "";
			const invalid = validateUrl(url);
			if (invalid) {
				return textResult(`URL 不合法：${invalid}`);
			}

			const apiKey = await getApiKey(secrets);
			if (!apiKey) {
				return textResult(
					"还没配置 DeepSeek API Key。请让用户在 UCanSearch 面板里填一下，或运行命令「UCanSearch: 设置 DeepSeek API Key」。"
				);
			}

			const cancellation = linkCancellation(token);
			try {
				const response = await callFetch({
					baseUrl: getBaseUrl(),
					apiKey,
					url,
					signal: cancellation.signal,
				});
				return textResult(formatFetchResult(url, response));
			} catch (error) {
				return textResult(describeToolError("抓取", error));
			} finally {
				cancellation.dispose();
			}
		},
	});
}
