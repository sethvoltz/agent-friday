import { EventEmitter } from "node:events";
import type { FridayEvent, FridayEventPayload } from "@friday/shared";

const BUFFER_SIZE = 200;

class EventBus extends EventEmitter {
  private seq = 0;
  private buffer: FridayEvent[] = [];

  publish(payload: FridayEventPayload): FridayEvent {
    const event: FridayEvent = {
      ...payload,
      seq: ++this.seq,
      ts: new Date().toISOString(),
    } as FridayEvent;

    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-BUFFER_SIZE);
    }

    this.emit("event", event);
    return event;
  }

  replaySince(lastSeq: number): FridayEvent[] {
    return this.buffer.filter((e) => e.seq > lastSeq);
  }

  /** Reset state — for testing only */
  _reset(): void {
    this.seq = 0;
    this.buffer = [];
    this.removeAllListeners();
  }
}

export const eventBus = new EventBus();
