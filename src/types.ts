/**
 * 接口数据结构。
 *
 * 字段名严格照 DeepSeek 官方 Search / Fetch 文档写，统一 snake_case，
 * 不做驼峰转换——省得将来对不上文档时还要两边来回猜。
 */

/** 搜索结果里的一项。 */
export interface SearchResultItem {
	/** 排序分数，0-3，1.5 以上算优质结果。 */
	rerank_score?: number;
	title?: string;
	url?: string;
	/** 短摘要，约 100-200 字符，适合前端展示。 */
	snippet?: string;
	/** 长摘要，约 600-800 字符，适合喂给模型。 */
	summary?: string;
	/** 网页正文。搜索接口默认不返回正文，此字段恒为空串。 */
	content?: string;
	site_name?: string | null;
	site_icon?: string | null;
	/** 发布时间，UTC 的 RFC 3339 格式，未知时为 null。 */
	date?: string | null;
	/** 网页权威性，0-4，-1 表示未知，3 以上极权威。 */
	authority?: number;
}

export interface SearchResponse {
	results?: SearchResultItem[];
}

export interface FetchResponse {
	title?: string;
	content?: string;
}

/** 余额接口的说法：金额都是字符串。 */
export interface BalanceInfo {
	currency?: string;
	total_balance?: string;
	granted_balance?: string;
	topped_up_balance?: string;
}

export interface BalanceResponse {
	is_available?: boolean;
	balance_infos?: BalanceInfo[];
}

/** 官方错误体是 OpenAI 兼容格式，param 恒为 null。 */
export interface ErrorBody {
	error?: {
		message?: string;
		type?: string;
		param?: string | null;
		code?: string;
	};
}

/** 搜索工具入参。 */
export interface SearchToolInput {
	query: string;
	count?: number;
	ori_question?: string;
	localization?: string;
}

/** 抓取工具入参。 */
export interface FetchToolInput {
	url: string;
}
