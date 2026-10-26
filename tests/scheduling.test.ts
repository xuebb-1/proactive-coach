import { describe, expect, it } from "vitest";
import { endOfDayForTimeZone, todayKeyForTimeZone } from "@/lib/date";
import { findDueAgentTriggers } from "@/lib/scheduling/due-users";
import { getAsyncAgentMode } from "@/lib/scheduling/mode";

const profile = {
  userId: "user-1",
  timezone: "America/New_York",
  morningTime: "07:30",
  lunchTime: "12:00",
  eveningTime: "20:30",
};

describe("timezone-aware scheduling", () => {
  it("uses the DST offset on the spring-forward day", () => {
    const now = new Date("2026-03-08T11:30:00.000Z");
    expect(todayKeyForTimeZone(profile.timezone, now)).toBe("2026-03-08");
    expect(findDueAgentTriggers([profile], now)).toMatchObject([
      { userId: "user-1", trigger: "morning", dateKey: "2026-03-08" },
    ]);
    expect(endOfDayForTimeZone(profile.timezone, now).toISOString()).toBe("2026-03-09T03:59:59.999Z");
  });

  it("uses the standard-time offset after the fall-back transition", () => {
    const now = new Date("2026-11-01T12:30:00.000Z");
    expect(findDueAgentTriggers([profile], now)[0]).toMatchObject({
      trigger: "morning",
      dateKey: "2026-11-01",
    });
  });

  it("emits stable per-user event keys", () => {
    const now = new Date("2026-03-08T16:02:00.000Z");
    expect(findDueAgentTriggers([profile], now)[0]?.dedupeKey).toBe(
      "agent-daily:user-1:2026-03-08:lunch"
    );
  });

  it("fans out 50 simultaneous users into 50 unique events", () => {
    const profiles = Array.from({ length: 50 }, (_, index) => ({
      ...profile,
      userId: `user-${index}`,
    }));
    const due = findDueAgentTriggers(profiles, new Date("2026-03-08T11:30:00.000Z"));
    expect(due).toHaveLength(50);
    expect(new Set(due.map((item) => item.dedupeKey)).size).toBe(50);
  });

  it("opens the five-minute window at the scheduled minute and closes it exactly at its end", () => {
    const dueAt = (instant: string) => findDueAgentTriggers([profile], new Date(instant));
    expect(dueAt("2026-03-08T11:29:59Z")).toHaveLength(0);
    expect(dueAt("2026-03-08T11:30:00Z")).toHaveLength(1);
    expect(dueAt("2026-03-08T11:34:59Z")).toHaveLength(1);
    expect(dueAt("2026-03-08T11:35:00Z")).toHaveLength(0);
  });

  it("uses one event key for both occurrences of a fall-back local hour", () => {
    const early = { ...profile, morningTime: "01:30" };
    const first = findDueAgentTriggers([early], new Date("2026-11-01T05:30:00Z"));
    const repeated = findDueAgentTriggers([early], new Date("2026-11-01T06:30:00Z"));
    expect(first).toHaveLength(1);
    expect(repeated).toHaveLength(1);
    expect(first[0].dedupeKey).toBe(repeated[0].dedupeKey);
  });

  it("selects only due users using each user's local time", () => {
    const users = [profile, { ...profile, userId: "shanghai", timezone: "Asia/Shanghai" }];
    const due = findDueAgentTriggers(users, new Date("2026-03-08T11:30:00Z"));
    expect(due.map(item => item.userId)).toEqual(["user-1"]);
  });
});

describe("rollout flags", () => {
  it("defaults to the rollback-safe disabled state", () => {
    expect(getAsyncAgentMode({})).toBe("disabled");
  });

  it("supports shadow calculation without event delivery", () => {
    expect(
      getAsyncAgentMode({
        ASYNC_AGENT_ENABLED: "true",
        ASYNC_AGENT_SHADOW: "true",
      })
    ).toBe("shadow");
  });

  it("requires both explicit switches for live delivery", () => {
    expect(
      getAsyncAgentMode({
        ASYNC_AGENT_ENABLED: "true",
        ASYNC_AGENT_SHADOW: "false",
      })
    ).toBe("live");
  });
});
