import { getJson } from "./http";
import type { BalanceResponse } from "./types";
import { balanceUrlOf } from "./url";

/**
 * 账户余额。
 *
 * 官方接口 `GET /user/balance` 返回的是字符串金额，这里顺手归一化一层，
 * 让面板那边不用关心字段名和空值。
 */

export interface BalanceSnapshot {
	available: boolean;
	currency: string;
	total: string;
	granted: string;
	toppedUp: string;
}

export async function fetchBalance(baseUrl: string, apiKey: string): Promise<BalanceSnapshot> {
	// 余额查一次很快，超时给短一点，别让面板空等半分钟
	const response = await getJson<BalanceResponse>(balanceUrlOf(baseUrl), apiKey, 15_000);
	const infos = Array.isArray(response.balance_infos) ? response.balance_infos : [];
	// 正常只有一个币种，万一有多个就取第一个
	const info = infos[0];

	return {
		available: response.is_available !== false,
		currency: info?.currency === "USD" ? "USD" : "CNY",
		total: info?.total_balance ?? "0",
		granted: info?.granted_balance ?? "0",
		toppedUp: info?.topped_up_balance ?? "0",
	};
}
