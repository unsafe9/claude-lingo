<script lang="ts">
	interface Props {
		value: number | string;
		label: string;
		icon?: string;
	}

	let { value, label, icon }: Props = $props();
</script>

<div class="stats-card card">
	<div class="stats-row">
		{#if icon}
			<span class="stats-icon">{icon}</span>
		{/if}
		<span class="stat-value">{value}</span>
	</div>
	<div class="stat-label">{label}</div>
</div>

<style>
	.stats-card {
		padding: 0.75rem;
		text-align: center;
	}

	.stats-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
	}

	.stats-icon {
		font-size: 0.875rem;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1;
	}

	.stat-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}
</style>
