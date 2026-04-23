<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Friday Dashboard</title>
</svelte:head>

<main>
  <h1>Friday Dashboard</h1>

  <section>
    <h2>Configuration</h2>
    <p class="config-path">
      {data.configPath}
      {#if !data.configExists}
        <span class="badge warning">not found — using defaults</span>
      {:else}
        <span class="badge ok">loaded</span>
      {/if}
    </p>
    <pre><code>{JSON.stringify(data.config, null, 2)}</code></pre>
  </section>
</main>

<style>
  main {
    max-width: 720px;
    margin: 2rem auto;
    font-family: system-ui, -apple-system, sans-serif;
    padding: 0 1rem;
  }

  h1 {
    border-bottom: 2px solid #333;
    padding-bottom: 0.5rem;
  }

  .config-path {
    font-family: monospace;
    font-size: 0.85rem;
    color: #666;
  }

  .badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.75rem;
    margin-left: 0.5rem;
  }

  .badge.ok {
    background: #d4edda;
    color: #155724;
  }

  .badge.warning {
    background: #fff3cd;
    color: #856404;
  }

  pre {
    background: #f4f4f4;
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.85rem;
  }
</style>
