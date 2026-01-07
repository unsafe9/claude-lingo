<script lang="ts">
	interface Props {
		onRate: (rating: 1 | 2 | 3 | 4) => void;
		disabled?: boolean;
	}

	let { onRate, disabled = false }: Props = $props();

	const ratings = [
		{ value: 1 as const, label: 'Again', key: '1', class: 'btn-again', desc: 'Forgot completely' },
		{ value: 2 as const, label: 'Hard', key: '2', class: 'btn-hard', desc: 'Struggled to recall' },
		{ value: 3 as const, label: 'Good', key: '3', class: 'btn-good', desc: 'Recalled with effort' },
		{ value: 4 as const, label: 'Easy', key: '4', class: 'btn-easy', desc: 'Instantly recalled' }
	];
</script>

<div class="rating-buttons">
	{#each ratings as rating}
		<button
			class="rating-btn btn {rating.class}"
			onclick={() => onRate(rating.value)}
			{disabled}
		>
			<span class="rating-label">{rating.label}</span>
			<span class="rating-desc">{rating.desc}</span>
			<span class="kbd">{rating.key}</span>
		</button>
	{/each}
</div>

<style>
	.rating-buttons {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
		max-width: 600px;
		margin: 0 auto;
	}

	.rating-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1rem;
		gap: 0.25rem;
		min-height: 80px;
	}

	.rating-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.rating-label {
		font-weight: 600;
		font-size: 1rem;
	}

	.rating-desc {
		font-size: 0.6875rem;
		opacity: 0.85;
		text-align: center;
	}

	.rating-btn .kbd {
		margin-top: 0.25rem;
		background: rgba(255, 255, 255, 0.2);
		border-color: rgba(255, 255, 255, 0.3);
		color: inherit;
	}

	@media (max-width: 480px) {
		.rating-buttons {
			grid-template-columns: repeat(2, 1fr);
		}

		.rating-desc {
			display: none;
		}
	}
</style>
