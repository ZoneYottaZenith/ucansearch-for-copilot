import * as vscode from "vscode";
import { ApiError } from "../http";

/** 工具的返回统一走文本：模型读得懂，出错也不会变成红色异常堆栈。 */
export function textResult(text: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

/** 把异常翻译成一句模型能据此决策的话。 */
export function describeToolError(action: string, error: unknown): string {
	if (error instanceof ApiError) {
		return `${action}失败：${error.message}`;
	}
	const message = error instanceof Error ? error.message : String(error ?? "");
	return message ? `${action}失败：${message}` : `${action}失败，原因未知`;
}

/** 把工具取消信号接到 fetch 的 AbortController 上。 */
export function linkCancellation(token: vscode.CancellationToken): {
	signal: AbortSignal;
	dispose: () => void;
} {
	const controller = new AbortController();
	const subscription = token.onCancellationRequested(() => controller.abort());
	return {
		signal: controller.signal,
		dispose: () => subscription.dispose(),
	};
}

/** 模型偶尔会把数字给成字符串，统一收一遍。 */
export function toStringOrUndefined(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}
