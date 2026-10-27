import { postJson } from "./http";
import type { FetchResponse, SearchResponse, SearchResultItem } from "./types";

/**
 * DeepSeek Search / Fetch 接口的直接封装。
 *
 * 这一层不引用 vscode，纯函数 + 纯 HTTP：
 * 工具调用和面板里的「测试」按钮都走这里，行为只有一份。
 */

export interface SearchRequest {
	baseUrl: string;
	apiKey: string;
	query: string;
	count?: number;
	ori_question?: string;
	localization?: string;
	signal?: AbortSignal;
}

export interface FetchRequest {
	baseUrl: string;
	apiKey: string;
	url: string;
	signal?: AbortSignal;
}

/** 官方限制：1-128 个 Unicode 字符，不能全是空白。 */
export function validateQuery(query: string): string | null {
	const value = typeof query === "string" ? query.trim() : "";
	if (!value) {
		return "搜索词不能为空";
	}
	const length = Array.from(value).length;
	if (length > 128) {
		return `搜索词最多 128 个字符，现在有 ${length} 个`;
	}
	return null;
}

/** 官方限制：不超 8192 字符、带 host 的 HTTP/HTTPS、不能带用户名密码。 */
export function validateUrl(url: string): string | null {
	const value = typeof url === "string" ? url.trim() : "";
	if (!value) {
		return "URL 不能为空";
	}
	if (value.length > 8192) {
		return "URL 太长（上限 8192 字符）";
	}
	if (!/^https?:\/\//i.test(value)) {
		return "URL 必须以 http:// 或 https:// 开头";
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return "URL 格式不合法";
	}
	if (!parsed.host) {
		return "URL 缺少主机名";
	}
	if (parsed.username || parsed.password) {
		return "URL 不能携带用户名或密码";
	}
	return null;
}

export async function callSearch(request: SearchRequest): Promise<SearchResponse> {
	const body: Record<string, unknown> = { query: request.query.trim() };
	// 没指定的字段一律不传，让官方默认值生效，避免我们替用户做决定
	if (request.count !== undefined) {
		body.count = request.count;
	}
	if (request.ori_question) {
		body.ori_question = request.ori_question;
	}
	if (request.localization) {
		body.localization = request.localization;
	}

	return postJson<SearchResponse>({
		url: `${request.baseUrl}/tools/search`,
		apiKey: request.apiKey,
		body,
		signal: request.signal,
	});
}

export async function callFetch(request: FetchRequest): Promise<FetchResponse> {
	return postJson<FetchResponse>({
		url: `${request.baseUrl}/tools/fetch`,
		apiKey: request.apiKey,
		body: { url: request.url.trim() },
		signal: request.signal,
	});
}

/** 把搜索结果排成模型好读的文本。 */
export function formatSearchResults(query: string, items: SearchResultItem[]): string {
	if (items.length === 0) {
		return `没有搜到「${query}」的结果。可以换更短的关键词、去掉限定词，或者放宽 after/before 的时间范围再试。`;
	}

	const blocks: string[] = [`搜索「${query}」，共 ${items.length} 条结果（按相关度排序）：`];
	for (const [index, item] of items.entries()) {
		blocks.push(formatSearchItem(index + 1, item));
	}

	return blocks.join("\n\n");
}

function formatSearchItem(index: number, item: SearchResultItem): string {
	const lines: string[] = [`${index}. ${pick(item.title, "(无标题)")}`];
	lines.push(`   链接：${pick(item.url, "(无链接)")}`);

	const meta: string[] = [];
	if (typeof item.rerank_score === "number") {
		meta.push(`相关度 ${item.rerank_score}`);
	}
	if (typeof item.authority === "number" && item.authority >= 0) {
		meta.push(`权威性 ${item.authority}`);
	}
	if (item.date) {
		meta.push(`发布 ${item.date}`);
	}
	if (item.site_name) {
		meta.push(`站点 ${item.site_name}`);
	}
	if (meta.length > 0) {
		lines.push(`   ${meta.join("｜")}`);
	}

	// summary 是给模型准备的 600-800 字版本，优先用它；没有才退回 snippet
	const summary = pick(item.summary, pick(item.snippet, ""));
	if (summary) {
		lines.push(`   摘要：${summary}`);
	}

	const content = (item.content ?? "").trim();
	if (content) {
		// 正文已经在这里给了，标签上就写清楚，省得模型再单独抓一次同一条链接
		lines.push(`   正文（已随本条返回，无需再抓取此链接）：${content}`);
	}

	return lines.join("\n");
}

/** 把抓取结果排成模型好读的文本。 */
export function formatFetchResult(url: string, response: FetchResponse): string {
	const title = pick(response.title, "(无标题)");
	const content = (response.content ?? "").trim();

	if (!content) {
		return `已抓取 ${url}，但页面没有可提取的正文。可能是纯前端渲染、图片站或需要登录。`;
	}

	return `标题：${title}\n链接：${url}\n\n正文（Markdown）：\n${content}`;
}

function pick(value: string | null | undefined, fallback: string): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed || fallback;
}
