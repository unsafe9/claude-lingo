<script lang="ts">
	interface Props {
		current: number;
		best: number;
	}

	let { current, best }: Props = $props();
</script>

<div class="streak-display card">
	<div class="streak-row">
		<span class="streak-fire">🔥</span>
		<span class="streak-value">{current}</span>
		<span class="streak-label">day streak</span>
		<span class="streak-best">Best: {best}</span>
	</div>
</div>

<style>
	.streak-display {
		padding: 0.75rem 1rem;
	}

	.streak-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.streak-fire {
		font-size: 1.25rem;
	}

	.streak-value {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1;
	}

	.streak-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.streak-best {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
