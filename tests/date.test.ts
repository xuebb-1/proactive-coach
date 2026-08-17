import { describe, expect, it } from "vitest";
import { todayKey, endOfToday } from "@/lib/date";

/**
 * 回归测试：日期 key 必须按北京时间算，与服务器时区无关。
 * Vercel 上 morning cron 在 UTC 23:30 触发（= 北京次日 07:30），如果按 UTC
 * 日期落库，morning 计划会挂在"昨天"，4 小时后的 lunch 查不到今天的计划，
 * 每天都会重复生成一次——这组测试锁住这个 bug。
 */
describe("todayKey (Asia/Shanghai)", () => {
  it("morning cron at 23:30 UTC files under the NEXT Beijing day", () => {
    expect(todayKey(new Date("2026-08-16T23:30:00Z"))).toBe("2026-08-17");
  });

  it("lunch cron at 04:00 UTC files under the same Beijing day as that morning", () => {
    expect(todayKey(new Date("2026-08-17T04:00:00Z"))).toBe("2026-08-17");
  });

  it("evening cron at 12:30 UTC still the same Beijing day", () => {
    expect(todayKey(new Date("2026-08-17T12:30:00Z"))).toBe("2026-08-17");
  });

  it("Beijing midnight boundary: 15:59 UTC is today, 16:00 UTC is tomorrow", () => {
    expect(todayKey(new Date("2026-08-17T15:59:59Z"))).toBe("2026-08-17");
    expect(todayKey(new Date("2026-08-17T16:00:00Z"))).toBe("2026-08-18");
  });
});

describe("endOfToday (Asia/Shanghai)", () => {
  it("is Beijing 23:59:59.999 expressed as an absolute instant", () => {
    // 北京 2026-08-17 23:59:59.999 == UTC 2026-08-17 15:59:59.999
    expect(endOfToday(new Date("2026-08-16T23:30:00Z")).toISOString()).toBe(
      "2026-08-17T15:59:59.999Z"
    );
  });

  it("stays within the same day key as its input", () => {
    for (const iso of ["2026-08-16T23:30:00Z", "2026-08-17T04:00:00Z", "2026-08-17T15:59:59Z"]) {
      const d = new Date(iso);
      expect(todayKey(endOfToday(d))).toBe(todayKey(d));
    }
  });
});
