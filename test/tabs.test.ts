import { describe, expect, it } from "vitest";
import { Tabs } from "../src/lib/tui/components/tabs.js";

describe("Tabs", () => {
  it("ignores Kitty key release events so arrows do not skip the middle tab", () => {
    const tabs = new Tabs([
      { id: "overview", label: "Overview" },
      { id: "findings", label: "Findings" },
      { id: "timeline", label: "Timeline" },
    ]);

    tabs.handleInput("\x1b[1;1:1C");
    tabs.handleInput("\x1b[1;1:3C");

    expect(tabs.getActiveId()).toBe("findings");
  });

  it("still advances through tabs on separate right-arrow presses", () => {
    const tabs = new Tabs([
      { id: "overview", label: "Overview" },
      { id: "findings", label: "Findings" },
      { id: "timeline", label: "Timeline" },
    ]);

    tabs.handleInput("\x1b[C");
    tabs.handleInput("\x1b[C");

    expect(tabs.getActiveId()).toBe("timeline");
  });
});
