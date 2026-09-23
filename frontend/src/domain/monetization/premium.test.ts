import { formatRemaining, rewardAllowance, waitForPremiumChange } from "@/domain/monetization/premium";

describe("formatRemaining", () => {
  it("matches the PRD examples", () => {
    expect(formatRemaining(47 * 60_000)).toBe("47m");
    expect(formatRemaining((60 + 47) * 60_000)).toBe("1h 47m");
    expect(formatRemaining(((2 * 24) + 3) * 3_600_000)).toBe("2d 3h");
  });
  it("edges", () => {
    expect(formatRemaining(0)).toBe("");
    expect(formatRemaining(-5)).toBe("");
    expect(formatRemaining(30_000)).toBe("<1m");
    expect(formatRemaining(60 * 60_000)).toBe("1h 0m");
  });
});

describe("rewardAllowance", () => {
  it("counts whole hours against the daily cap", () => {
    expect(rewardAllowance(4, 0)).toEqual({ used: 0, left: 4, canWatch: true });
    expect(rewardAllowance(4, 3 * 3600)).toEqual({ used: 3, left: 1, canWatch: true });
    expect(rewardAllowance(4, 4 * 3600)).toEqual({ used: 4, left: 0, canWatch: false });
    expect(rewardAllowance(4, 9 * 3600)).toEqual({ used: 9, left: 0, canWatch: false });
  });
  it("a lowered cap applies immediately", () => expect(rewardAllowance(2, 3 * 3600).canWatch).toBe(false));
});

describe("waitForPremiumChange", () => {
  const noSleep = async () => {};

  it("confirms once the server's premium end moves later (stacking: it never resets)", async () => {
    let until: number | null = 1000;
    let polls = 0;
    const r = await waitForPremiumChange({ before: 1000, sleep: noSleep, readUntil: () => until, refresh: async () => { if (++polls === 3) until = 1000 + 3_600_000; } });
    expect(r).toBe("confirmed");
    expect(polls).toBe(3);
  });

  it("confirms the first grant when there was no premium before", async () => {
    let until: number | null = null;
    const r = await waitForPremiumChange({ before: null, sleep: noSleep, readUntil: () => until, refresh: async () => { until = 5; } });
    expect(r).toBe("confirmed");
  });

  it("times out (no reward was verified) without ever granting anything locally", async () => {
    let polls = 0;
    const r = await waitForPremiumChange({ before: 10, attempts: 4, sleep: noSleep, readUntil: () => 10, refresh: async () => { polls++; } });
    expect(r).toBe("timeout");
    expect(polls).toBe(4);
  });

  it("keeps trying through transient refresh failures", async () => {
    let n = 0;
    let until: number | null = 1;
    const r = await waitForPremiumChange({ before: 1, sleep: noSleep, readUntil: () => until, refresh: async () => { if (++n < 3) throw new Error("offline"); until = 99; } });
    expect(r).toBe("confirmed");
  });
});
