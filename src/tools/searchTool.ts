import * as vscode from "vscode";
import {
	clampInteger,
	getApiKey,
	getBaseUrl,
	getDefaultCount,
	isEnabled,
} from "../config";
import { callSearch, formatSearchResults, validateQuery } from "../searchService";
import type { SearchToolInput } from "../types";
import { describeToolError, linkCancellation, textResult, toStringOrUndefined } from "./shared";

export const SEARCH_TOOL_ID = "ucansearch_query_web";

export function registerSearchTool(secrets: vscode.SecretStorage): vscode.Disposable {
	return vscode.lm.registerTool<SearchToolInput>(SEARCH_TOOL_ID, {
		prepareInvocation(options) {
			const query = typeof options.input?.query === "string" ? options.input.query : "";
			return {
				invocationMessage: `搜索网页：${query || "(空)"}`,
			};
		},

		async invoke(options, token) {
			if (!isEnabled()) {
				return textResult(
					"UCanSearch 已在设置里关闭（ucansearch.enabled = false），本次没有联网。请告诉用户先打开它。"
				);
			}

			const input = options.input ?? ({} as SearchToolInput);
			const query = typeof input.query === "string" ? input.query : "";
			const invalid = validateQuery(query);
			if (invalid) {
				return textResult(`搜索词不合法：${invalid}`);
			}

			const apiKey = await getApiKey(secrets);
			if (!apiKey) {
				return textResult(
					"还没配置 DeepSeek API Key。请让用户在 UCanSearch 面板里填一下，或运行命令「UCanSearch: 设置 DeepSeek API Key」。"
				);
			}

			const defaultCount = getDefaultCount();
			const count =
				input.count === undefined ? defaultCount : clampInteger(input.count, 1, 50, defaultCount);

			const cancellation = linkCancellation(token);
			try {
				const response = await callSearch({
					baseUrl: getBaseUrl(),
					apiKey,
					query,
					count,
					ori_question: toStringOrUndefined(input.ori_question),
					localization: toStringOrUndefined(input.localization),
					signal: cancellation.signal,
				});

				const items = Array.isArray(response.results) ? response.results : [];
				return textResult(formatSearchResults(query, items));
			} catch (error) {
				return textResult(describeToolError("搜索", error));
			} finally {
				cancellation.dispose();
			}
		},
	});
}
