<script lang="ts">
	import type { ReviewItem } from '$lib/types';
	import { formatCategory } from '$lib/utils';

	interface Props {
		item: ReviewItem;
		showAnswer: boolean;
		onReveal: () => void;
	}

	let { item, showAnswer, onReveal }: Props = $props();
</script>

<div class="flashcard">
	{#if !showAnswer}
		<!-- Front: Original prompt -->
		<div class="card-face card-front">
			<div class="card-label">Your text</div>
			<div class="card-content">{item.prompt}</div>

			{#if item.categories.length > 0}
				<div class="card-categories">
					{#each item.categories as cat}
						<span class="category-badge">{formatCategory(cat)}</span>
					{/each}
				</div>
			{/if}

			<button class="btn btn-primary reveal-btn" onclick={onReveal}>
				Show Answer
				<span class="kbd">Space</span>
			</button>
		</div>
	{:else}
		<!-- Back: Correction/Alternative -->
		<div class="card-face card-back">
			<div class="card-section original">
				<div class="card-label">Your text</div>
				<div class="card-original">{item.prompt}</div>
			</div>

			{#if item.correction}
				<div class="card-section">
					<div class="card-label">Correction</div>
					<div class="card-content correction">{item.correction}</div>
				</div>
			{/if}

			{#if item.alternative}
				<div class="card-section">
					<div class="card-label">Better alternative</div>
					<div class="card-content alternative">{item.alternative}</div>
				</div>
			{/if}

			{#if item.analysis_result}
				<div class="card-section">
					<div class="card-label">Explanation</div>
					<div class="card-explanation">{item.analysis_result}</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.flashcard {
		width: 100%;
		max-width: 600px;
		margin: 0 auto;
	}

	.card-face {
		padding: 1.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.card-front {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card-back {
		background: var(--color-surface-warm);
	}

	.card-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 0.375rem;
	}

	.card-content {
		font-size: 1.125rem;
		line-height: 1.5;
	}

	.card-original {
		font-size: 1rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.card-content.correction {
		color: var(--color-success);
	}

	.card-content.alternative {
		color: var(--color-primary);
	}

	.card-section {
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.card-section.original {
		background: var(--color-bg);
		margin: -1.5rem -1.5rem 1rem -1.5rem;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
	}

	.card-section:last-child {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: none;
	}

	.card-explanation {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.card-categories {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.category-badge {
		font-size: 0.6875rem;
		padding: 0.1875rem 0.5rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		text-transform: capitalize;
	}

	.reveal-btn {
		align-self: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.reveal-btn .kbd {
		opacity: 0.7;
	}
</style>
