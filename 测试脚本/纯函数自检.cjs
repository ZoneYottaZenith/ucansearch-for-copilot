/**
 * 纯函数自检：不联网、不起 VS Code，直接测编译后的逻辑。
 *
 * 跑法：
 *    npm run compile
 *    node "测试脚本/纯函数自检.cjs"
 *
 * 测的是 out/ 里的真实产物，不是这里另抄一份实现。
 */

const path = require("node:path");
const fs = require("node:fs");

const outDir = path.join(__dirname, "..", "out");
if (!fs.existsSync(path.join(outDir, "searchService.js"))) {
	console.error("找不到 out/，先跑 npm run compile");
	process.exit(1);
}

const { normalizeBaseUrl, balanceUrlOf } = require(path.join(outDir, "url.js"));
const { maskSecret, isPlausibleSecret } = require(path.join(outDir, "mask.js"));
const {
	validateQuery,
	validateUrl,
	formatSearchResults,
	formatFetchResult,
} = require(path.join(outDir, "searchService.js"));

const failures = [];
let passed = 0;

function test(name, fn) {
	try {
		fn();
		passed++;
	} catch (error) {
		failures.push(`${name}\n     ${error.message}`);
	}
}

function equal(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
	}
}

function ok(value, label) {
	if (!value) {
		throw new Error(`${label}：期望为真，实际是 ${JSON.stringify(value)}`);
	}
}

function includes(haystack, needle, label) {
	if (!String(haystack).includes(needle)) {
		throw new Error(`${label}：输出里找不到 ${JSON.stringify(needle)}\n     实际：${String(haystack).slice(0, 300)}`);
	}
}

// ---- 地址规范化 ----
test("空值回落到官方地址", () => {
	equal(normalizeBaseUrl(""), "https://api.deepseek.com/v1", "空字符串");
	equal(normalizeBaseUrl(undefined), "https://api.deepseek.com/v1", "undefined");
	equal(normalizeBaseUrl(null), "https://api.deepseek.com/v1", "null");
});

test("裸域名补 /v1", () => {
	equal(normalizeBaseUrl("https://api.deepseek.com"), "https://api.deepseek.com/v1", "无斜杠");
	equal(normalizeBaseUrl("https://api.deepseek.com/"), "https://api.deepseek.com/v1", "单斜杠");
	equal(normalizeBaseUrl("https://api.deepseek.com///"), "https://api.deepseek.com/v1", "多斜杠");
});

test("已带 /v1 不重复补", () => {
	equal(normalizeBaseUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1", "标准写法");
	equal(normalizeBaseUrl("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1", "带尾斜杠");
	equal(normalizeBaseUrl("  https://api.deepseek.com/v1  "), "https://api.deepseek.com/v1", "带空格");
});

test("粘贴完整接口地址能自动削回基础地址", () => {
	equal(
		normalizeBaseUrl("https://api.deepseek.com/v1/tools/search"),
		"https://api.deepseek.com/v1",
		"search 接口"
	);
	equal(
		normalizeBaseUrl("https://api.deepseek.com/v1/tools/fetch"),
		"https://api.deepseek.com/v1",
		"fetch 接口"
	);
});

test("自建代理前缀保留", () => {
	equal(normalizeBaseUrl("https://proxy.example.com/deepseek"), "https://proxy.example.com/deepseek/v1", "代理");
	equal(normalizeBaseUrl("https://proxy.example.com/deepseek/v1"), "https://proxy.example.com/deepseek/v1", "代理带 v1");
});

test("非 vN 形式的版本段不硬补", () => {
	equal(normalizeBaseUrl("https://x.com/v1beta"), "https://x.com/v1beta", "v1beta");
});

// ---- 搜索词校验 ----
test("搜索词校验", () => {
	ok(validateQuery("") !== null, "空串应报错");
	ok(validateQuery("   ") !== null, "全空格应报错");
	equal(validateQuery("DeepSeek"), null, "正常词");
	equal(validateQuery("a".repeat(128)), null, "128 字符合法");
	ok(validateQuery("a".repeat(129)) !== null, "129 字符应报错");
});

// ---- URL 校验 ----
test("URL 校验", () => {
	ok(validateUrl("") !== null, "空串应报错");
	ok(validateUrl("ftp://example.com") !== null, "非 http(s) 应报错");
	ok(validateUrl("not a url") !== null, "乱写应报错");
	ok(validateUrl("https://user:pass@example.com") !== null, "带账号密码应报错");
	equal(validateUrl("https://example.com/a?b=1"), null, "正常 URL");
	equal(validateUrl("http://localhost:3000"), null, "本地地址");
});

// ---- 搜索结果的排版 ----
test("没有结果时给出可操作的建议", () => {
	const text = formatSearchResults("不存在的东西", []);
	includes(text, "没有搜到", "空结果提示");
	includes(text, "宽", "应提示放宽条件");
});

test("正常结果带上标题、链接和评分", () => {
	const items = [
		{
			title: "DeepSeek V4 发布",
			url: "https://example.com/v4",
			summary: "长摘要内容",
			rerank_score: 2.4,
			authority: 3,
			date: "2026-06-01T00:00:00+00:00",
			site_name: "Example News",
		},
	];
	const text = formatSearchResults("DeepSeek V4", items);
	includes(text, "DeepSeek V4 发布", "标题");
	includes(text, "https://example.com/v4", "链接");
	includes(text, "长摘要内容", "摘要");
	includes(text, "相关度 2.4", "相关度");
	includes(text, "权威性 3", "权威性");
	includes(text, "共 1 条", "条数");
});

test("summary 为空时退回 snippet", () => {
	const items = [{ title: "t", url: "https://a.com", summary: "", snippet: "短摘要兜底" }];
	includes(formatSearchResults("q", items), "短摘要兜底", "snippet 兜底");
});

test("缺标题缺链接也不崩", () => {
	const text = formatSearchResults("q", [{}]);
	includes(text, "(无标题)", "占位标题");
	includes(text, "(无链接)", "占位链接");
});

test("正文原样返回，不做任何截断", () => {
	const body = "x".repeat(200);
	const text = formatSearchResults("q", [{ title: "t", url: "https://a.com", content: body }]);
	includes(text, body, "正文应一字不少");
	ok(!text.includes("已截断"), "不应出现截断提示");
	includes(text, "无需再抓取", "要提醒模型不必再抓一次");
});

test("条数再多也全部保留，不省略", () => {
	const items = Array.from({ length: 40 }, (_, index) => ({
		title: `标题 ${index}`,
		url: `https://a.com/${index}`,
		summary: "y".repeat(900),
	}));
	const text = formatSearchResults("q", items);
	includes(text, "共 40 条", "条数如实报告");
	includes(text, "标题 39", "最后一条也要在");
	ok(!text.includes("因篇幅省略"), "不应出现省略提示");
});

// ---- 抓取结果排版 ----
test("抓取正常返回标题和正文", () => {
	const text = formatFetchResult("https://a.com", { title: "标题", content: "# Hello" });
	includes(text, "标题", "标题");
	includes(text, "https://a.com", "链接");
	includes(text, "# Hello", "正文");
});

test("抓取到的正文为空时说人话", () => {
	const text = formatFetchResult("https://a.com", { title: "标题", content: "   " });
	includes(text, "没有可提取的正文", "空正文提示");
});

test("抓取正文再长也不截断", () => {
	const body = "z".repeat(500);
	const text = formatFetchResult("https://a.com", { title: "t", content: body });
	includes(text, body, "正文应一字不少");
	ok(!text.includes("已截断"), "不应出现截断说明");
});

test("密钥掩码：首尾明文、长度不变", () => {
	const key = "sk-abcdefghijklmnopqrstuvwxyz0123";
	const masked = maskSecret(key);
	equal(masked.length, key.length, "长度应与原文一致");
	ok(masked.startsWith("sk-a"), "前 4 位保留");
	ok(masked.endsWith("0123"), "后 4 位保留");
	ok(masked.includes("••••"), "中间是圆点");
	ok(!masked.includes("ghij"), "中间不能露出来");
});

test("密钥掩码：空串和短密钥", () => {
	equal(maskSecret(""), "", "空串返回空串");
	equal(maskSecret("  "), "", "全空白当作空");
	equal(maskSecret("abc123"), "••••••", "8 位以内整串打点");
});

test("密钥校验：只收可见 ASCII", () => {
	ok(isPlausibleSecret("sk-abc123"), "正常密钥应通过");
	ok(isPlausibleSecret("  sk-abc123  "), "前后空格会被 trim");
	ok(!isPlausibleSecret("sk-a••••••4567"), "掩码里的圆点必须拒绝");
	ok(!isPlausibleSecret("sk-密钥"), "中文必须拒绝");
	ok(!isPlausibleSecret("sk abc"), "中间空格必须拒绝");
	ok(!isPlausibleSecret("   "), "全空白必须拒绝");
	ok(!isPlausibleSecret(""), "空串必须拒绝");
});

// ---- 汇总 ----
if (failures.length > 0) {
	console.error(`❌ ${failures.length} 项不通过（共 ${passed + failures.length} 项）\n`);
	for (const item of failures) {
		console.error(`   - ${item}`);
	}
	process.exit(1);
}

console.log(`✅ 全部通过（${passed} 项）`);
