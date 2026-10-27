/**
 * 密钥掩码。
 *
 * 只给界面看：保留首尾各 4 位，中间全换成圆点，长度跟原文一模一样，
 * 这样用户一眼能认出是哪把密钥，又不用把完整密钥摊在屏幕上。
 * 这个函数不碰 vscode，方便自检脚本直接测。
 */

const BULLET = "•";
const EDGE = 4;

export function maskSecret(key: string): string {
	const value = typeof key === "string" ? key.trim() : "";
	if (!value) {
		return "";
	}
	// 太短的密钥露头露尾等于全露，干脆整串打点
	if (value.length <= EDGE * 2) {
		return BULLET.repeat(value.length);
	}
	return `${value.slice(0, EDGE)}${BULLET.repeat(value.length - EDGE * 2)}${value.slice(-EDGE)}`;
}

/**
 * 密钥该不该收。
 *
 * HTTP 头只能装可见 ASCII，粘进中文、空格或掩码里的圆点，会让之后每一次请求
 * 都在请求层报错，而且看起来像“密钥没配置”。所以入口处就拦住。
 */
export function isPlausibleSecret(value: unknown): boolean {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed.length > 0 && /^[\x21-\x7e]+$/.test(trimmed);
}
