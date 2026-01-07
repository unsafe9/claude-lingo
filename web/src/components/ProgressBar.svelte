<script lang="ts">
	interface Props {
		current: number;
		total: number;
	}

	let { current, total }: Props = $props();

	let percentage = $derived(total > 0 ? Math.round((current / total) * 100) : 0);
</script>

<div class="progress-container">
	<div class="progress-info">
		<span class="progress-text">{current} of {total}</span>
		<span class="progress-percent">{percentage}%</span>
	</div>
	<div class="progress-bar">
		<div class="progress-fill" style="width: {percentage}%"></div>
	</div>
</div>

<style>
	.progress-container {
		width: 100%;
		max-width: 600px;
		margin: 0 auto;
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
	}

	.progress-text {
		color: var(--color-text-muted);
	}

	.progress-percent {
		font-weight: 600;
	}

	.progress-bar {
		height: 8px;
		background: var(--color-border);
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-primary);
		border-radius: 4px;
		transition: width 0.3s ease;
	}
</style>
