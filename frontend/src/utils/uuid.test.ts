import { uuidv7 } from "@/utils/uuid";

const fixed = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

describe("uuidv7", () => {
  it("has the v7 layout", () => {
    expect(uuidv7(1_700_000_000_000, fixed)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts by time", () => {
    const a = uuidv7(1_700_000_000_000, fixed);
    const b = uuidv7(1_700_000_000_001, fixed);
    expect(a < b).toBe(true);
  });
});
