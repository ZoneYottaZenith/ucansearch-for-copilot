const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

const ui = {
	enabled: $("enabled"),
	statusBar: $("statusBar"),
	statusText: $("statusText"),
	connBadge: $("connBadge"),
	baseUrl: $("baseUrl"),
	apiKey: $("apiKey"),
	balance: $("balanceBadge"),
	keyHint: $("keyHint"),
	toggleKey: $("toggleKey"),
	defaultCount: $("defaultCount"),
	testBadge: $("testBadge"),
	testQuery: $("testQuery"),
	runSearch: $("runSearch"),
	testUrl: $("testUrl"),
	runFetch: $("runFetch"),
	output: $("output"),
	openSettings: $("openSettings"),
	toasts: $("toasts"),
};

const send = (message) => vscode.postMessage(message);

/** 用户动过密钥框才把新值回传，否则会把已存的密钥冲成空 */
let keyDirty = false;
let hasSavedKey = false;
/** 后端给的密钥掩码（首尾明文、中间打点），只用于回显 */
let keyMask = "";
/** 后端回传的当前配置，用来判断输入框里的值是不是真的改了 */
let latestState = null;

function toast(text, kind = "info") {
	if (!text) {
		return;
	}
	const el = document.createElement("div");
	el.className = `toast ${kind}`;
	el.textContent = text;
	ui.toasts.appendChild(el);
	requestAnimationFrame(() => el.classList.add("show"));

	// 同一时间最多留 3 条，多了叠成一片反而看不清
	while (ui.toasts.children.length > 3) {
		ui.toasts.firstElementChild.remove();
	}

	setTimeout(() => {
		el.classList.remove("show");
		setTimeout(() => el.remove(), 220);
	}, 2800);
}

function setBadge(el, text, state) {
	el.textContent = text;
	el.classList.toggle("ok", state === "ok");
	el.classList.toggle("bad", state === "bad");
}

/** 每次新动画自增，旧的那帧发现对不上就直接退出 */
let balanceAnimation = 0;

const REDUCED_MOTION =
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function money(currency, value) {
	const symbol = currency === "USD" ? "$" : "¥";
	const num = Number(value);
	return `${symbol}${Number.isFinite(num) ? num.toFixed(2) : "0.00"}`;
}

/** 从 from 涨到 to，约 0.7 秒，尾巴收得干净。 */
/** 请求后端重拉一次余额，先给个“正在刷”的视觉，免得点了像没点 */
function requestBalanceRefresh() {
	ui.balance.classList.add("refreshing");
	send({ type: "refreshBalance" });
}

function animateMoney(el, from, to, currency) {
	const token = ++balanceAnimation;
	const symbol = currency === "USD" ? "$" : "¥";
	const format = (value) => `${symbol}${value.toFixed(2)}`;

	if (REDUCED_MOTION || !Number.isFinite(to) || Math.abs(to - from) < 0.005) {
		el.textContent = Number.isFinite(to) ? format(to) : `${symbol}0.00`;
		return;
	}

	const duration = 700;
	const start = performance.now();
	const tick = (now) => {
		if (token !== balanceAnimation) {
			return;
		}
		const progress = Math.min(1, (now - start) / duration);
		const eased = 1 - Math.pow(1 - progress, 3);
		el.textContent = format(from + (to - from) * eased);
		if (progress < 1) {
			requestAnimationFrame(tick);
		}
	};
	requestAnimationFrame(tick);
}

function applyBalance(message) {
	const el = ui.balance;
	el.classList.remove("low");
	el.classList.remove("refreshing");

	if (message.none) {
		balanceAnimation++;
		el.textContent = "—";
		el.title = "配上 API Key 后显示余额";
		return;
	}

	if (message.error) {
		balanceAnimation++;
		el.textContent = "余额读取失败";
		el.title = message.error;
		return;
	}

	const total = Number(message.total);
	el.title = `总余额 ${money(message.currency, message.total)}（赠金 ${money(message.currency, message.granted)} · 充值 ${money(message.currency, message.toppedUp)}）`;
	// 每次都从 0 数到最新值：一次请求才花几厘钱，从旧值接着数的差值肉眼根本看不出来，
	// 等于点了刷新却毫无反应。从 0 起跳既看得出真的刷了，终点也还是真实余额
	animateMoney(el, 0, total, message.currency);
	if (message.available === false) {
		el.classList.add("low");
	}
}

function applyEnabled(enabled) {
	ui.enabled.checked = enabled;
	ui.statusBar.classList.toggle("off", !enabled);
	ui.statusText.textContent = enabled
		? "已接入 · Copilot 能看到 UCanSearch 的两个工具"
		: "已分离 · 工具已注销，Copilot 保持原样";
}

function applyState(state) {
	if (!state) {
		return;
	}

	latestState = state;
	applyEnabled(state.enabled !== false);
	ui.baseUrl.value = state.baseUrl || "";
	ui.defaultCount.value = state.defaultCount ?? 5;

	hasSavedKey = state.hasApiKey === true;
	keyMask = typeof state.keyMask === "string" ? state.keyMask : "";
	if (!keyDirty) {
		showKeyMask();
	}
	ui.keyHint.textContent = hasSavedKey
		? "已保存到系统密钥库，重填会覆盖"
		: "存在系统密钥库，不写进设置文件";

	setBadge(ui.connBadge, hasSavedKey ? "已配置" : "未配置", hasSavedKey ? "ok" : undefined);
}

/**
 * 把密钥框显示成掩码：首尾明文、中间打点，长度跟原文一样。
 * 掩码是只读的，用户点进去就清空，方便直接敲新密钥。
 */
function showKeyMask() {
	ui.apiKey.value = keyMask;
	ui.apiKey.readOnly = Boolean(keyMask);
	// 掩码本身就是给人看的，不能拿密码框遮住（否则变成一串小圆点）
	ui.apiKey.type = keyMask ? "text" : "password";
	ui.apiKey.placeholder = hasSavedKey ? "已保存，重填会覆盖" : "sk-...";
	ui.toggleKey.textContent = "显示";
}

function showOutput(text) {
	ui.output.hidden = false;
	ui.output.textContent = text;
	ui.output.scrollTop = 0;
}

ui.enabled.addEventListener("change", () => {
	send({ type: "setEnabled", enabled: ui.enabled.checked });
});

ui.toggleKey.addEventListener("click", () => {
	// 掩码状态下没什么可藏的
	if (ui.apiKey.readOnly) {
		return;
	}
	const visible = ui.apiKey.type === "text";
	ui.apiKey.type = visible ? "password" : "text";
	ui.toggleKey.textContent = visible ? "显示" : "隐藏";
});

ui.apiKey.addEventListener("focus", () => {
	if (!ui.apiKey.readOnly) {
		return;
	}
	// 一点进来就把掩码让开，直接敲新密钥就行
	ui.apiKey.readOnly = false;
	ui.apiKey.value = "";
	ui.apiKey.type = "password";
	ui.toggleKey.textContent = "显示";
});

ui.apiKey.addEventListener("input", () => {
	keyDirty = true;
});

/*
 * 三个输入框都是失焦或回车就存，没有保存按钮。
 * 值跟已保存的一样就什么都不发，免得点进点出也弹一次“已保存”。
 */
function commitBaseUrl() {
	const value = ui.baseUrl.value.trim();
	// 两边都 trim 再比：配置里可能存着带空格的原值，不 trim 会白发一次
	if (!latestState || value === (latestState.baseUrl || "").trim()) {
		return;
	}
	send({ type: "save", baseUrl: value });
}

function commitCount() {
	const value = Number(ui.defaultCount.value) || 5;
	if (!latestState || value === latestState.defaultCount) {
		return;
	}
	send({ type: "save", defaultCount: value });
}

function commitApiKey() {
	if (!keyDirty) {
		// 只是点进来又走：把掩码填回去，什么都不发
		showKeyMask();
		return;
	}

	const value = ui.apiKey.value.trim();
	// HTTP 头只能放可见 ASCII，粘进中文或掩码里的圆点会让每次请求都报 ByteString 错
	if (value && !/^[\x21-\x7e]+$/.test(value)) {
		toast("密钥里只能有英文、数字和符号，检查一下是不是粘到了掩码", "error");
		keyDirty = false;
		showKeyMask();
		return;
	}
	send({ type: "save", apiKey: value });
}

for (const [element, commit] of [
	[ui.baseUrl, commitBaseUrl],
	[ui.defaultCount, commitCount],
	[ui.apiKey, commitApiKey],
]) {
	element.addEventListener("blur", commit);
	element.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			element.blur();
		}
	});
}

/**
 * 框里可能正显示掩码，那玩意儿只能看不能发。
 * 留空让后端自己从密钥库取真实密钥。
 */
function currentApiKey() {
	return ui.apiKey.readOnly ? "" : ui.apiKey.value;
}

ui.runSearch.addEventListener("click", () => {
	// 输入框空着就直接拿灰字示例去搜，省得用户还得先手打一遍
	const query = (ui.testQuery.value.trim() || ui.testQuery.placeholder).trim();
	if (!query) {
		toast("先填一个搜索词", "error");
		return;
	}
	ui.runSearch.disabled = true;
	setBadge(ui.testBadge, "搜索中…");
	showOutput("正在请求 /tools/search …");
	// 点了就顺手刷一眼余额，不用等搜索结果
	requestBalanceRefresh();
	send({ type: "testSearch", query, apiKey: currentApiKey() });
});

ui.runFetch.addEventListener("click", () => {
	// 空着就用灰字示例去抓，跟搜索那边一个规矩
	const url = (ui.testUrl.value.trim() || ui.testUrl.placeholder).trim();
	if (!url) {
		toast("先填一个网址", "error");
		return;
	}
	ui.runFetch.disabled = true;
	setBadge(ui.testBadge, "抓取中…");
	showOutput("正在请求 /tools/fetch …");
	send({ type: "testFetch", url, apiKey: currentApiKey() });
});

ui.testQuery.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		ui.runSearch.click();
	}
});

ui.testUrl.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		ui.runFetch.click();
	}
});

ui.openSettings.addEventListener("click", () => {
	send({ type: "openSettings" });
});

// 点余额胶囊手动刷一次，数钱不用等别人
ui.balance.addEventListener("click", requestBalanceRefresh);

window.addEventListener("message", (event) => {
	const message = event.data;
	if (!message || typeof message.type !== "string") {
		return;
	}

	if (message.type === "state") {
		applyState(message.state);
		return;
	}

	if (message.type === "enabledChanged") {
		applyEnabled(message.enabled === true);
		toast(message.enabled ? "已接入，Copilot 现在能看到两个工具" : "已分离，工具已注销", "success");
		return;
	}

	if (message.type === "balance") {
		applyBalance(message);
		return;
	}

	if (message.type === "saved") {
		keyDirty = false;
		if (message.error) {
			// 后端没写进去（比如粘到了掩码），把原来的掩码填回去，别让人以为存好了
			toast(message.error, "error");
			showKeyMask();
			return;
		}
		// 先清空明文；紧随其后的 state 会把新掩码填回来
		ui.apiKey.value = "";
		ui.apiKey.type = "password";
		ui.apiKey.readOnly = true;
		ui.toggleKey.textContent = "显示";
		toast("已保存", "success");
		return;
	}

	if (message.type === "test") {
		const isSearch = message.kind === "search";
		ui.runSearch.disabled = false;
		ui.runFetch.disabled = false;
		setBadge(ui.testBadge, message.ok ? "成功" : "失败", message.ok ? "ok" : "bad");
		showOutput(message.text || "");
		toast(
			message.ok ? (isSearch ? "搜索成功" : "抓取成功") : message.text || "请求失败",
			message.ok ? "success" : "error"
		);
	}
});

send({ type: "ready" });
