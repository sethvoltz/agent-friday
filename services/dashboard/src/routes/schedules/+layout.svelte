<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import { getLiveStatus, getDataVersion } from '$lib/events.svelte';
  import type { ScheduleListItem } from './+layout.server';

  let { data, children } = $props();

  // Re-fetch sidebar data when SSE events arrive
  let lastVersion = $state(getDataVersion());
  $effect(() => {
    const v = getDataVersion();
    if (v !== lastVersion) {
      lastVersion = v;
      invalidateAll();
    }
  });

  const schedules: ScheduleListItem[] = $derived(data.schedules ?? []);

  function statusDot(status: string): string {
    switch (status) {
      case 'active': return '\u25CF';
      case 'idle': return '\u25CB';
      case 'destroyed': return '\u25CC';
      default: return '\u25CB';
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'active': return 'status-active';
      case 'idle': return 'status-idle';
      case 'destroyed': return 'status-destroyed';
      default: return 'status-idle';
    }
  }

  function scheduleLabel(entry: ScheduleListItem['entry']): string {
    if (entry.schedule.cron) return entry.schedule.cron;
    if (entry.schedule.runAt) return 'one-shot';
    return '';
  }

  function fmtAge(d: string): string {
    const ms = Date.now() - new Date(d).getTime();
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  function isActive(path: string): boolean {
    return $page.url.pathname === path;
  }
</script>

<div class="schedules-layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <h2>Schedules</h2>
    </div>

    <div class="sidebar-content">
      {#each schedules as item}
        {@const liveStatus = getLiveStatus(item.name)}
        {@const effectiveStatus = liveStatus ?? item.entry.status}
        <a
          class="sidebar-item"
          class:active={isActive(`/schedules/${item.name}`)}
          class:paused={item.entry.paused}
          class:former={item.entry.status === 'destroyed'}
          href="/schedules/{item.name}"
        >
          <span class="item-dot {statusClass(effectiveStatus)}">{statusDot(effectiveStatus)}</span>
          <span class="item-name">{item.name}</span>
          {#if item.entry.paused && item.entry.status !== 'destroyed'}
            <span class="item-badge paused-badge">paused</span>
          {/if}
          <span class="item-cron">{scheduleLabel(item.entry)}</span>
        </a>
      {/each}
      {#if schedules.length === 0}
        <div class="sidebar-empty">
          No scheduled agents yet.
        </div>
      {/if}
    </div>

    <div class="sidebar-footer">
      <span class="schedule-count">{schedules.length} schedule{schedules.length !== 1 ? 's' : ''}</span>
    </div>
  </aside>

  <section class="content">
    {@render children()}
  </section>
</div>

<style>
  .schedules-layout {
    display: flex;
    gap: 1rem;
    height: calc(100vh - 4.5rem);
    margin: -1.5rem;
    padding: 1rem 1.5rem 1rem;
  }

  .sidebar {
    width: 280px;
    min-width: 280px;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 1rem 1rem 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .sidebar-header h2 {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0.5rem 0 0;
  }

  .sidebar-content {
    flex: 1;
    padding: 0.5rem 0;
    overflow-y: auto;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-decoration: none;
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .sidebar-item:hover { background: var(--bg-tertiary); }
  .sidebar-item.active {
    background: var(--accent-glow);
    color: var(--accent-primary);
  }
  .sidebar-item.former {
    opacity: 0.5;
  }
  .sidebar-item.paused {
    opacity: 0.7;
  }

  .item-dot { flex-shrink: 0; font-size: 0.6rem; }
  .item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-cron { font-size: 0.6rem; color: var(--text-tertiary); white-space: nowrap; font-family: var(--font-mono); }
  .item-badge {
    font-size: 0.6rem;
    padding: 0.05rem 0.35rem;
    border-radius: 99px;
    flex-shrink: 0;
  }
  .paused-badge {
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
  }

  .status-active { color: var(--status-ok); }
  .status-idle { color: var(--text-tertiary); }
  .status-destroyed { color: var(--text-tertiary); }

  .sidebar-empty {
    padding: 1.5rem 1rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-tertiary);
  }

  .sidebar-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .schedule-count {
    font-size: 0.7rem;
    color: var(--text-tertiary);
  }

  .content {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem 1rem;
    display: flex;
    flex-direction: column;
  }
</style>
