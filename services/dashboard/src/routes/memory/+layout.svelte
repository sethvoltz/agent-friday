<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import { getDataVersion } from '$lib/events.svelte';
  import type { MemoryEntry } from '@friday/memory';

  let { data, children } = $props();

  // Re-fetch when SSE events arrive
  let lastVersion = $state(getDataVersion());
  $effect(() => {
    const v = getDataVersion();
    if (v !== lastVersion) {
      lastVersion = v;
      invalidateAll();
    }
  });

  const memories: MemoryEntry[] = $derived(data.memories ?? []);
  const allTags: string[] = $derived(data.allTags ?? []);

  // Tag filter state — all selected by default
  let selectedTags = $state<Set<string>>(new Set());
  let showFilter = $state(false);

  // Initialize selectedTags when allTags loads
  $effect(() => {
    if (selectedTags.size === 0 && allTags.length > 0) {
      selectedTags = new Set(allTags);
    }
  });

  const allSelected = $derived(selectedTags.size === allTags.length);
  const filterLabel = $derived(
    allSelected || allTags.length === 0
      ? 'All tags'
      : `${selectedTags.size} of ${allTags.length} tags`
  );

  // Tag counts for display
  const tagCounts = $derived(() => {
    const counts = new Map<string, number>();
    for (const m of memories) {
      for (const t of m.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return counts;
  });

  // Filtered memories based on selected tags
  const filteredMemories = $derived(
    allSelected || allTags.length === 0
      ? memories
      : memories.filter(m =>
          m.tags.length === 0 || m.tags.some(t => selectedTags.has(t))
        )
  );

  function toggleTag(tag: string) {
    const next = new Set(selectedTags);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    selectedTags = next;
  }

  function selectAll() {
    selectedTags = new Set(allTags);
  }

  function selectNone() {
    selectedTags = new Set();
  }

  function isActive(path: string): boolean {
    return $page.url.pathname === path;
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
</script>

<div class="memory-layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <h2>Memory</h2>
      {#if allTags.length > 0}
        <div class="filter-wrapper">
          <button class="filter-btn" onclick={() => showFilter = !showFilter}>
            {filterLabel} ▾
          </button>
          {#if showFilter}
            <div class="filter-dropdown">
              <div class="filter-actions">
                <button onclick={selectAll} class="filter-action" disabled={allSelected}>All</button>
                <button onclick={selectNone} class="filter-action" disabled={selectedTags.size === 0}>None</button>
              </div>
              {#each allTags as tag}
                <label class="filter-option">
                  <input
                    type="checkbox"
                    checked={selectedTags.has(tag)}
                    onchange={() => toggleTag(tag)}
                  />
                  <span class="filter-tag-name">{tag}</span>
                  <span class="filter-tag-count">({tagCounts().get(tag) ?? 0})</span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="sidebar-content">
      {#each filteredMemories as memory}
        <a
          class="sidebar-item"
          class:active={isActive(`/memory/${memory.id}`)}
          href="/memory/{memory.id}"
        >
          <span class="item-icon">📝</span>
          <span class="item-name">{memory.title}</span>
          {#if memory.recallCount > 0}
            <span class="item-recall">{memory.recallCount}x</span>
          {/if}
          <span class="item-date">{fmtAge(memory.updatedAt)}</span>
        </a>
      {/each}
      {#if filteredMemories.length === 0}
        <div class="sidebar-empty">
          {#if memories.length === 0}
            No memories saved yet.
          {:else}
            No memories match the selected tags.
          {/if}
        </div>
      {/if}
    </div>

    <div class="sidebar-footer">
      <span class="memory-count">
        {filteredMemories.length}{filteredMemories.length !== memories.length ? ` of ${memories.length}` : ''} memories
      </span>
    </div>
  </aside>

  <section class="content">
    {@render children()}
  </section>
</div>

<style>
  .memory-layout {
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

  .filter-wrapper {
    position: relative;
    margin-top: 0.5rem;
  }

  .filter-btn {
    width: 100%;
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
  }
  .filter-btn:hover {
    border-color: var(--border-primary);
    color: var(--text-primary);
  }

  .filter-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
    z-index: 10;
    max-height: 200px;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .filter-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 0.25rem;
  }

  .filter-action {
    font-size: 0.7rem;
    color: var(--accent-primary);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .filter-action:disabled {
    color: var(--text-tertiary);
    cursor: default;
  }

  .filter-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .filter-option:hover {
    background: var(--bg-tertiary);
  }

  .filter-option input {
    margin: 0;
    accent-color: var(--accent-primary);
  }

  .filter-tag-name {
    flex: 1;
  }

  .filter-tag-count {
    color: var(--text-tertiary);
    font-size: 0.7rem;
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

  .item-icon { font-size: 0.85rem; flex-shrink: 0; width: 1.1rem; text-align: center; }
  .item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-date { font-size: 0.65rem; color: var(--text-tertiary); white-space: nowrap; }
  .item-recall { font-size: 0.65rem; color: var(--text-tertiary); white-space: nowrap; }

  .sidebar-empty {
    padding: 1.5rem 1rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-tertiary);
  }

  .sidebar-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border-subtle);
    text-align: center;
  }

  .memory-count {
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
