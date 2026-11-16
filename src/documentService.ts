import { ApiError } from "./http";
import type { OcrPage, OcrResponse } from "./types";

/**
 * DeepSeek OCR 接口的封装。
 *
 * 跟 searchService 一样不引用 vscode，纯 HTTP：
 * 工具和面板里的「读取文件」都走这里，行为只有一份。
 *
 * 官方规则（https://api-docs.deepseek.com/zh-cn/guides/ocr）：
 *   - POST {base}/tools/ocr，multipart/form-data
 *   - 只要两个字段，file 和 purpose；purpose 必须排在 file 前面
 *   - 文件上限 100 MiB、1000 页；上传 120 秒内完成，总时长 180 秒
 *   - 成功后按页计费，所以这里不重试
 */

/** 只收文字，不要文档里的图：够用，也省 token。 */
const PURPOSE = "text_recognition";

/** 官方总时限 180 秒（含上传），留一点余量。 */
const TIMEOUT_MS = 200_000;

/** 回给模型的文本预算，超了就截断并说明还剩多少页。 */
const MAX_CHARS = 120_000;

export const MAX_BYTES = 100 * 1024 * 1024;

/** 只认这些扩展名；图片不在支持范围（按需求排除）。 */
export const SUPPORTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".ppt", ".pptx"];

export interface OcrRequest {
	baseUrl: string;
	apiKey: string;
	/** 文件在磁盘上的真实名字，会作为 multipart 的文件名发给上游。 */
	fileName: string;
	bytes: Uint8Array;
	signal?: AbortSignal;
}

/** 扩展名是否在支持列表里（不区分大小写）。 */
export function validateDocumentName(fileName: string): string | null {
	const lower = fileName.toLowerCase();
	if (SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
		return null;
	}
	return `只支持 ${SUPPORTED_EXTENSIONS.join("、")}，这个文件不是`;
}

export async function callOcr(request: OcrRequest): Promise<OcrResponse> {
	if (request.bytes.byteLength > MAX_BYTES) {
		throw new ApiError(`文件超过 100 MiB，官方接口不收这么大的文件`);
	}

	// purpose 必须放在 file 之前，官方明确要求，反了会 400
	const form = new FormData();
	form.append("purpose", PURPOSE);
	form.append("file", new Blob([request.bytes]), request.fileName);

	const controller = new AbortController();
	const forwardAbort = () => controller.abort();
	request.signal?.addEventListener("abort", forwardAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	let raw: string;
	let status: number;
	try {
		const response = await fetch(`${request.baseUrl}/tools/ocr`, {
			method: "POST",
			// Content-Type 交给 fetch 自己带 boundary，手写一定错
			headers: { Authorization: `Bearer ${request.apiKey}` },
			body: form,
			signal: controller.signal,
		});
		status = response.status;
		raw = await response.text();
	} catch (error) {
		if (request.signal?.aborted) {
			throw new ApiError("已取消");
		}
		if (controller.signal.aborted) {
			throw new ApiError("识别超时（超过 180 秒），文件页数太多或太大，建议拆分后再试");
		}
		throw new ApiError(describeNetworkError(error));
	} finally {
		clearTimeout(timer);
		request.signal?.removeEventListener("abort", forwardAbort);
	}

	// 识别过程中服务端会垫换行保活，前导空白对 JSON 解析无害
	const text = raw.replace(/^\s+/, "");

	if (status < 200 || status >= 300) {
		throw new ApiError(describeFailure(status, text), status);
	}

	let body: OcrResponse;
	try {
		body = JSON.parse(text) as OcrResponse;
	} catch {
		throw new ApiError("接口返回的不是 JSON，地址可能指到了网页而不是 API");
	}

	// 状态码已经是 200 也可能是错误对象（识别开始后失败或超时）
	const message = body.error?.message;
	if (message) {
		throw new ApiError(`识别失败：${message}`, status);
	}

	return body;
}

/** 把分页结果拼成模型好读的文本，超预算就截断并说清剩多少。 */
export function formatOcrResult(fileName: string, response: OcrResponse): string {
	const pages: OcrPage[] = Array.isArray(response.pages) ? response.pages : [];
	if (pages.length === 0) {
		return `「${fileName}」没有识别出文字，可能是空文件或全为图片且无法识别。`;
	}

	const total = typeof response.page_count === "number" ? response.page_count : pages.length;
	const blocks: string[] = [`「${fileName}」共 ${total} 页，按页返回识别文字：`];
	let used = blocks[0].length;
	let truncatedAt = 0;

	for (const page of pages) {
		const index = typeof page.index === "number" ? page.index + 1 : truncatedAt + 1;
		const text = typeof page.text === "string" ? page.text.trim() : "";
		const partial = page.finish_reason === "length" ? "（该页输出达到上限，内容不完整）" : "";
		const block = `\n--- 第 ${index} 页${partial} ---\n${text || "(空)"}`;

		if (used + block.length > MAX_CHARS) {
			break;
		}
		blocks.push(block);
		used += block.length;
		truncatedAt = index;
	}

	if (truncatedAt < total) {
		blocks.push(
			`\n--- 已省略 ---\n全文超出长度预算，第 ${truncatedAt + 1} 页之后没有返回。需要后面的内容就告诉用户改用更小的文件或分段读取。`
		);
	}

	return blocks.join("");
}

/** 把 HTTP 状态和上游原话拼成一句能看懂的话。 */
function describeFailure(status: number, raw: string): string {
	const hints: Record<number, string> = {
		400: "表单或 purpose 不合法，或文件无法处理（比如设了打开密码、格式不支持）",
		401: "API Key 缺失或无效",
		402: "账户余额不足，充值后再试",
		408: "上传太慢或中途停顿超过 30 秒",
		413: "文件超过 100 MiB",
		429: "同时进行的识别太多，稍后再试",
		500: "服务端处理文件失败",
		503: "服务繁忙，稍后再试",
		504: "上传与提交超过总时长（180 秒），文件太大或页数太多",
	};

	const hint = hints[status];
	const head = hint ? `HTTP ${status}：${hint}` : `HTTP ${status}`;

	let detail = "";
	try {
		const parsed = JSON.parse(raw) as { error?: { message?: string } };
		detail = parsed.error?.message ?? "";
	} catch {
		detail = raw.trim().slice(0, 200);
	}
	return detail ? `${head}（上游原话：${detail}）` : head;
}

function describeNetworkError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error ?? "");
	if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
		return "域名解析失败，检查一下接口地址是否写错";
	}
	if (/ECONNREFUSED/i.test(message)) {
		return "连接被拒绝，对方端口没开放或地址不对";
	}
	if (/CERT|SSL|TLS/i.test(message)) {
		return "TLS 握手失败，证书有问题或被代理拦截";
	}
	return message ? `请求失败：${message}` : "请求失败，原因未知";
}
