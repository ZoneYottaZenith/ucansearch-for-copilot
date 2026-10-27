import type { ErrorBody } from "./types";

/**
 * 请求公共层：超时、限流重试、错误翻译。
 *
 * Search 和 Fetch 都是只读接口，重试不会产生副作用，所以 408/429/5xx 直接退避重发。
 * 4xx 里的 400/401/402/403/404 是确定性错误，重发没用，原样报给模型。
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 800;
const DEFAULT_TIMEOUT_MS = 30_000;

const STATUS_HINTS: Record<number, string> = {
	400: "请求不合法：参数超出范围或格式错误",
	401: "API Key 缺失或无效，检查一下密钥",
	402: "账户余额不足，充值后再试",
	403: "抓取被目标站点的安全策略拒绝",
	404: "没能从该地址取到可用正文：URL 不可用、被站点拦截，或者页面没有可提取的正文",
	408: "读取请求体超时",
	413: "请求体超过大小限制",
	429: "触发限速，稍后重试",
	500: "服务端内部错误",
	504: "下游请求超时",
};

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = "ApiError";
	}
}

export interface PostJsonOptions {
	url: string;
	apiKey: string;
	body: unknown;
	/** 外层取消信号（工具被取消时传进来）。 */
	signal?: AbortSignal;
	timeoutMs?: number;
}

interface RequestJsonOptions {
	url: string;
	apiKey: string;
	method: "GET" | "POST";
	body?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export function postJson<T>(options: PostJsonOptions): Promise<T> {
	return requestJson<T>({ ...options, method: "POST" });
}

/** 只读查询用（目前就余额这一个）。 */
export function getJson<T>(url: string, apiKey: string, timeoutMs?: number): Promise<T> {
	return requestJson<T>({ url, apiKey, method: "GET", timeoutMs });
}

async function requestJson<T>(options: RequestJsonOptions): Promise<T> {
	let lastError: unknown = undefined;

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (options.signal?.aborted) {
			throw new ApiError("已取消");
		}

		const controller = new AbortController();
		const forwardAbort = () => controller.abort();
		options.signal?.addEventListener("abort", forwardAbort, { once: true });
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		// 定时器跟着单次尝试走：重试时重新计时，不会累加成一次超长等待
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const cleanup = () => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", forwardAbort);
		};

		try {
			const response = await fetch(options.url, {
				method: options.method,
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					...(options.method === "POST" ? { "Content-Type": "application/json" } : {}),
				},
				...(options.method === "POST" ? { body: JSON.stringify(options.body) } : {}),
				signal: controller.signal,
			});
			cleanup();

			const raw = await response.text();

			if (!response.ok) {
				const error = new ApiError(describeFailure(response.status, raw), response.status);
				if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
					lastError = error;
					await sleep(BASE_DELAY_MS * 2 ** attempt, options.signal);
					continue;
				}
				throw error;
			}

			try {
				return JSON.parse(raw) as T;
			} catch {
				throw new ApiError("接口返回的不是 JSON，地址可能指到了网页而不是 API");
			}
		} catch (error) {
			cleanup();

			if (options.signal?.aborted) {
				throw new ApiError("已取消");
			}
			// 自己抛的 ApiError 直接往上报，别被下面当成网络异常再包一层
			if (error instanceof ApiError) {
				throw error;
			}
			if (controller.signal.aborted) {
				throw new ApiError(`请求超时（${timeoutMs} 毫秒），网络不通或上游太慢`);
			}

			lastError = error;
			if (attempt < MAX_ATTEMPTS - 1) {
				await sleep(BASE_DELAY_MS * 2 ** attempt, options.signal);
				continue;
			}
		}
	}

	throw new ApiError(describeNetworkError(lastError));
}

/** 把 HTTP 状态和上游原话拼成一句能看懂的话。 */
function describeFailure(status: number, raw: string): string {
	const hint = STATUS_HINTS[status];
	const head = hint ? `HTTP ${status}：${hint}` : `HTTP ${status}`;

	let detail = "";
	try {
		const parsed = JSON.parse(raw) as ErrorBody;
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new ApiError("已取消"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
