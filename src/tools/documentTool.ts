import * as vscode from "vscode";
import { getApiKey, getBaseUrl, isEnabled } from "../config";
import {
	MAX_BYTES,
	callOcr,
	formatOcrResult,
	validateDocumentName,
} from "../documentService";
import type { DocumentToolInput } from "../types";
import { describeToolError, linkCancellation, textResult } from "./shared";

export const DOCUMENT_TOOL_ID = "ucansearch_read_document";

/**
 * 把本地 PDF / Word / PPT 交给 DeepSeek 的 OCR 接口认字。
 *
 * 模型只能传文字，碰不到硬盘也传不了二进制，所以这里代它把文件读出来上传；
 * 模型拿到的永远是识别后的文本。
 */
export function registerDocumentTool(secrets: vscode.SecretStorage): vscode.Disposable {
	return vscode.lm.registerTool<DocumentToolInput>(DOCUMENT_TOOL_ID, {
		prepareInvocation(options) {
			const path = typeof options.input?.path === "string" ? options.input.path : "";
			return {
				invocationMessage: `读取文件：${path || "(空)"}`,
			};
		},

		async invoke(options, token) {
			if (!isEnabled()) {
				return textResult(
					"UCanSearch 已在设置里关闭（ucansearch.enabled = false），本次没有读取文件。请告诉用户先打开它。"
				);
			}

			const input = options.input ?? ({} as DocumentToolInput);
			const raw = typeof input.path === "string" ? input.path.trim() : "";
			if (!raw) {
				return textResult("没给文件路径。需要一个本地 PDF / Word / PPT 的路径。");
			}

			const target = resolveTarget(raw);
			if (!target) {
				return textResult(`路径无法解析：${raw}`);
			}

			const name = targetPathName(target);
			const invalidName = validateDocumentName(name);
			if (invalidName) {
				return textResult(`「${name}」${invalidName}`);
			}

			let size: number;
			try {
				size = (await vscode.workspace.fs.stat(target)).size;
			} catch {
				return textResult(`找不到文件：${raw}。确认它不是文件夹，也不是拼错的路径。`);
			}
			if (size > MAX_BYTES) {
				return textResult(`文件有 ${formatSize(size)}，超过官方 100 MiB 上限，无法上传。`);
			}

			const apiKey = await getApiKey(secrets);
			if (!apiKey) {
				return textResult(
					"还没配置 DeepSeek API Key。请让用户在 UCanSearch 面板里填一下，或运行命令「UCanSearch: 设置 DeepSeek API Key」。"
				);
			}

			const cancellation = linkCancellation(token);
			try {
				const bytes = await vscode.workspace.fs.readFile(target);
				const response = await callOcr({
					baseUrl: getBaseUrl(),
					apiKey,
					fileName: name,
					bytes,
					signal: cancellation.signal,
				});
				return textResult(formatOcrResult(name, response));
			} catch (error) {
				return textResult(describeToolError("读取文件", error));
			} finally {
				cancellation.dispose();
			}
		},
	});
}

/** 绝对路径直接用；相对路径按工作区第一个文件夹补全。 */
export function resolveTarget(raw: string): vscode.Uri | undefined {
	if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
		return vscode.Uri.file(raw);
	}
	const root = vscode.workspace.workspaceFolders?.[0];
	if (!root) {
		return undefined;
	}
	return vscode.Uri.joinPath(root.uri, raw);
}

function targetPathName(uri: vscode.Uri): string {
	const parts = uri.path.split("/");
	return parts[parts.length - 1] || uri.path;
}

function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
