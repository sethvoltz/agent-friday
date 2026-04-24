import type { AgentStatus, RegistryEntry, FridayEvent } from "@friday/shared";

// ── Reactive state ───────────────────────────────────────────

let connected = $state(false);
let lastError = $state<string | null>(null);

/** Live status overrides from agent:status events */
let statusOverrides = $state<Record<string, AgentStatus>>({});

/** Streaming text by agentName (full accumulated response, not diff) */
let streamingText = $state<Record<string, string>>({});

/** Counter that increments on any turn:complete or usage:logged — triggers invalidation */
let dataVersion = $state(0);

// ── EventSource management ───────────────────────────────────

let eventSource: EventSource | null = null;
let currentUrl: string | null = null;

export function connectSSE(url: string): void {
  // If already connected to this URL and the connection is alive, skip
  if (eventSource && currentUrl === url && eventSource.readyState !== EventSource.CLOSED) {
    return;
  }

  // Clean up any existing connection
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  currentUrl = url;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    connected = true;
    lastError = null;
  };

  eventSource.onerror = () => {
    connected = false;
    // EventSource auto-reconnects; just update state
  };

  // Listen for each event type
  eventSource.addEventListener("agent:status", (e) => {
    const data = JSON.parse(e.data) as FridayEvent & { type: "agent:status" };
    statusOverrides = { ...statusOverrides, [data.agentName]: data.status };
  });

  eventSource.addEventListener("agent:created", () => {
    dataVersion++;
  });

  eventSource.addEventListener("agent:destroyed", (e) => {
    const data = JSON.parse(e.data) as FridayEvent & { type: "agent:destroyed" };
    statusOverrides = { ...statusOverrides, [data.agentName]: "destroyed" };
    dataVersion++;
  });

  eventSource.addEventListener("session:updated", () => {
    dataVersion++;
  });

  eventSource.addEventListener("turn:streaming", (e) => {
    const data = JSON.parse(e.data) as FridayEvent & { type: "turn:streaming" };
    streamingText = { ...streamingText, [data.agentName]: data.text };
  });

  eventSource.addEventListener("turn:complete", (e) => {
    const data = JSON.parse(e.data) as FridayEvent & { type: "turn:complete" };
    // Clear streaming text for this agent — the completed turn will be in the refetched data
    const { [data.agentName]: _, ...rest } = streamingText;
    streamingText = rest;
    dataVersion++;
  });

  eventSource.addEventListener("usage:logged", () => {
    dataVersion++;
  });
}

export function disconnectSSE(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  currentUrl = null;
  connected = false;
}

// ── Accessors ────────────────────────────────────────────────

export function getConnection(): { connected: boolean; lastError: string | null } {
  return { connected, lastError };
}

export function getLiveStatus(agentName: string): AgentStatus | undefined {
  return statusOverrides[agentName];
}

export function getStreamingText(agentName: string): string | undefined {
  return streamingText[agentName];
}

export function getDataVersion(): number {
  return dataVersion;
}

export function clearStreaming(): void {
  streamingText = {};
}
