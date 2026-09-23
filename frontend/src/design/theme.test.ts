import { themes } from "@/design/theme";

describe("design tokens", () => {
  it("light and dark expose the same keys", () => {
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort());
  });

  it("every color is a 6-digit hex, except scrim which is a translucent rgba", () => {
    for (const scheme of Object.values(themes)) {
      for (const [key, value] of Object.entries(scheme)) {
        if (key === "scrim") {
          expect(value).toMatch(/^rgba\(/);
        } else {
          expect(value).toMatch(/^#[0-9A-F]{6}$/i);
        }
      }
    }
  });
});
