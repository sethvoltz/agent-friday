<script lang="ts">
  let { data } = $props();

  // Compute usage stats
  const entries = data.usageEntries;
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  function sumEntries(list: typeof entries) {
    let cost = 0, input = 0, output = 0, cacheCreation = 0, cacheRead = 0, duration = 0;
    for (const e of list) {
      cost += e.costUsd ?? 0;
      input += e.inputTokens;
      output += e.outputTokens;
      cacheCreation += e.cacheCreationTokens;
      cacheRead += e.cacheReadTokens;
      duration += e.durationMs;
    }
    const cacheTotal = cacheCreation + cacheRead;
    return {
      turns: list.length, cost, input, output, cacheCreation, cacheRead, duration,
      cacheRate: cacheTotal > 0 ? Math.round((cacheRead / cacheTotal) * 100) : 0,
      avgCost: list.length > 0 ? cost / list.length : 0,
    };
  }

  const todayEntries = entries.filter(e => new Date(e.timestamp).getTime() >= todayStart);
  const weekEntries = entries.filter(e => new Date(e.timestamp).getTime() >= weekStart);

  const allStats = sumEntries(entries);
  const todayStats = sumEntries(todayEntries);
  const weekStats = sumEntries(weekEntries);

  // Session aggregates
  const sessionMap = new Map<string, { type: string; turns: number; cost: number; lastAt: string }>();
  for (const e of entries) {
    const existing = sessionMap.get(e.sessionId);
    if (existing) {
      existing.turns++;
      existing.cost += e.costUsd ?? 0;
      existing.lastAt = e.timestamp;
    } else {
      sessionMap.set(e.sessionId, {
        type: e.sessionType,
        turns: 1,
        cost: e.costUsd ?? 0,
        lastAt: e.timestamp,
      });
    }
  }
  const sessionList = [...sessionMap.entries()]
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  // Cost per turn for the bar chart (last 20 turns)
  const recentTurns = entries.slice(-20);
  const maxTurnCost = Math.max(...recentTurns.map(e => e.costUsd ?? 0), 0.001);

  // Helpers
  function fmtCost(n: number) { return `$${n.toFixed(4)}`; }
  function fmtDuration(ms: number) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  function fmtAge(iso: string) {
    const diff = now - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function fmtTokens(n: number) { return n.toLocaleString(); }
</script>

<svelte:head>
  <title>Friday Dashboard</title>
</svelte:head>

<div class="dashboard">
  <!-- Status Bar -->
  <div class="status-bar card">
    <div class="status-left">
      <span class="pulse" class:offline={!data.daemonOnline}></span>
      <span class="status-text">
        {#if data.daemonOnline}
          Online
          {#if data.health}
            &middot; PID {data.health.pid} &middot; up {fmtDuration(data.health.uptimeMs)}
          {/if}
        {:else}
          Offline
        {/if}
      </span>
    </div>
    <div class="status-right">
      <span class="badge" class:ok={data.configExists} class:warn={!data.configExists}>
        {data.configExists ? 'Config loaded' : 'Using defaults'}
      </span>
    </div>
  </div>

  <!-- Stats Row -->
  <div class="stats-row">
    <div class="card stat-card">
      <div class="stat">
        <span class="stat-label">Today</span>
        <span class="stat-value">{fmtCost(todayStats.cost)}</span>
        <span class="stat-detail">{todayStats.turns} turns &middot; avg {fmtCost(todayStats.avgCost)}</span>
      </div>
    </div>
    <div class="card stat-card">
      <div class="stat">
        <span class="stat-label">This Week</span>
        <span class="stat-value">{fmtCost(weekStats.cost)}</span>
        <span class="stat-detail">{weekStats.turns} turns &middot; avg {fmtCost(weekStats.avgCost)}</span>
      </div>
    </div>
    <div class="card stat-card">
      <div class="stat">
        <span class="stat-label">Cache Hit Rate</span>
        <span class="stat-value">{allStats.cacheRate}%</span>
        <span class="stat-detail">{fmtTokens(allStats.cacheRead)} / {fmtTokens(allStats.cacheRead + allStats.cacheCreation)} tokens</span>
      </div>
    </div>
    <div class="card stat-card">
      <div class="stat">
        <span class="stat-label">Agent Time</span>
        <span class="stat-value">{fmtDuration(allStats.duration)}</span>
        <span class="stat-detail">{allStats.turns} total turns</span>
      </div>
    </div>
  </div>

  <!-- Main Grid -->
  <div class="main-grid">
    <!-- Cost Per Turn Chart -->
    <div class="card chart-card">
      <div class="card-header">
        <h2>Cost Per Turn</h2>
        <span class="stat-detail">Last {recentTurns.length} turns</span>
      </div>
      <div class="bar-chart">
        {#each recentTurns as turn, i}
          {@const cost = turn.costUsd ?? 0}
          {@const pct = (cost / maxTurnCost) * 100}
          <div class="bar-row">
            <span class="bar-label">#{entries.length - recentTurns.length + i + 1}</span>
            <div class="bar-track">
              <div
                class="bar-fill"
                style="width: {pct}%"
              ></div>
            </div>
            <span class="bar-value">{fmtCost(cost)}</span>
          </div>
        {/each}
        {#if recentTurns.length === 0}
          <p class="empty-state">No usage data yet</p>
        {/if}
      </div>
    </div>

    <!-- Token Breakdown -->
    <div class="card">
      <div class="card-header">
        <h2>Token Breakdown</h2>
        <span class="stat-detail">All time</span>
      </div>
      <div class="token-grid">
        <div class="token-item">
          <span class="token-label">Input</span>
          <span class="token-value">{fmtTokens(allStats.input)}</span>
        </div>
        <div class="token-item">
          <span class="token-label">Output</span>
          <span class="token-value">{fmtTokens(allStats.output)}</span>
        </div>
        <div class="token-item">
          <span class="token-label">Cache Creation</span>
          <span class="token-value">{fmtTokens(allStats.cacheCreation)}</span>
        </div>
        <div class="token-item accent">
          <span class="token-label">Cache Read</span>
          <span class="token-value">{fmtTokens(allStats.cacheRead)}</span>
        </div>
      </div>

      <!-- Cache ratio bar -->
      <div class="cache-bar">
        <div class="cache-bar-label">Cache efficiency</div>
        <div class="cache-bar-track">
          <div class="cache-bar-read" style="width: {allStats.cacheRate}%"></div>
        </div>
        <div class="cache-bar-pct">{allStats.cacheRate}%</div>
      </div>
    </div>

    <!-- Sessions -->
    <div class="card sessions-card">
      <div class="card-header">
        <h2>Sessions</h2>
        <span class="stat-detail">{sessionList.length} total</span>
      </div>
      {#if sessionList.length === 0}
        <p class="empty-state">No sessions yet</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Type</th>
              <th>Turns</th>
              <th>Cost</th>
              <th>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {#each sessionList as session}
              <tr>
                <td>{session.id.slice(0, 8)}&hellip;</td>
                <td>
                  <span class="badge" class:ok={session.type === 'orchestrator'} class:warn={session.type !== 'orchestrator'}>
                    {session.type}
                  </span>
                </td>
                <td>{session.turns}</td>
                <td>{fmtCost(session.cost)}</td>
                <td>{fmtAge(session.lastAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Config -->
    <div class="card config-card">
      <div class="card-header">
        <h2>Configuration</h2>
        <span class="badge" class:ok={data.configExists} class:warn={!data.configExists}>
          {data.configExists ? 'loaded' : 'defaults'}
        </span>
      </div>
      <div class="config-path">{data.configPath}</div>
      <pre class="code-block"><code>{JSON.stringify(data.config, null, 2)}</code></pre>
    </div>
  </div>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Status Bar */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .status-text {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .status-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Stats Row */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .stat-card {
    padding: 1rem 1.25rem;
  }

  /* Main Grid */
  .main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    min-width: 0;
    align-items: stretch;
  }

  .main-grid > :global(*) {
    min-width: 0;
  }

  .chart-card {
    display: flex;
    flex-direction: column;
  }

  .chart-card .bar-chart {
    flex: 1;
    min-height: 0;
  }

  .sessions-card,
  .config-card {
    grid-column: 1 / -1;
  }

  /* Bar chart */
  .bar-chart {
    max-height: 440px;
    overflow-y: auto;
  }

  /* Token grid */
  .token-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .token-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }

  .token-item.accent {
    background: var(--accent-glow);
  }

  .token-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }

  .token-value {
    font-family: var(--font-mono);
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  /* Cache bar */
  .cache-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .cache-bar-label {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    min-width: 7rem;
  }

  .cache-bar-track {
    flex: 1;
    height: 0.5rem;
    background: var(--bg-tertiary);
    border-radius: 3px;
    overflow: hidden;
  }

  .cache-bar-read {
    height: 100%;
    background: var(--chart-cache);
    border-radius: 3px;
    transition: width var(--transition-normal);
  }

  .cache-bar-pct {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-secondary);
    min-width: 2.5rem;
    text-align: right;
  }

  /* Config */
  .config-path {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-bottom: 0.75rem;
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 2rem;
    color: var(--text-tertiary);
    font-size: 0.85rem;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .stats-row {
      grid-template-columns: repeat(2, 1fr);
    }

    .main-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
