import { describe, it, expect, beforeEach } from "vitest";
import { eventBus } from "./bus.js";

beforeEach(() => {
  eventBus._reset();
});

describe("EventBus", () => {
  it("assigns incrementing seq and ts on publish", () => {
    const e1 = eventBus.publish({ type: "agent:destroyed", agentName: "a" });
    const e2 = eventBus.publish({ type: "agent:destroyed", agentName: "b" });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.ts).toBeTruthy();
    expect(e2.ts).toBeTruthy();
  });

  it("emits events to listeners", () => {
    const received: any[] = [];
    eventBus.on("event", (e) => received.push(e));

    eventBus.publish({ type: "agent:destroyed", agentName: "test" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("agent:destroyed");
    expect(received[0].agentName).toBe("test");
  });

  it("replays events since a given seq", () => {
    eventBus.publish({ type: "agent:destroyed", agentName: "a" });
    eventBus.publish({ type: "agent:destroyed", agentName: "b" });
    eventBus.publish({ type: "agent:destroyed", agentName: "c" });

    const replay = eventBus.replaySince(1);
    expect(replay).toHaveLength(2);
    expect(replay[0].seq).toBe(2);
    expect(replay[1].seq).toBe(3);
  });

  it("returns empty array when no events after seq", () => {
    eventBus.publish({ type: "agent:destroyed", agentName: "a" });
    expect(eventBus.replaySince(1)).toHaveLength(0);
    expect(eventBus.replaySince(999)).toHaveLength(0);
  });

  it("caps buffer at 200 entries", () => {
    for (let i = 0; i < 250; i++) {
      eventBus.publish({ type: "agent:destroyed", agentName: `a${i}` });
    }

    const all = eventBus.replaySince(0);
    expect(all).toHaveLength(200);
    expect(all[0].seq).toBe(51);
    expect(all[all.length - 1].seq).toBe(250);
  });
});
