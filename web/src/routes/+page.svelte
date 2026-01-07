<script lang="ts">
	import { onMount } from 'svelte';
	import { statsStore } from '$lib/stores/stats';
	import { reviewStore, currentItem, progress, isSessionComplete } from '$lib/stores/review';
	import { formatCategory, REVIEW_SESSION_LIMIT } from '$lib/utils';
	import StatsCard from '../components/StatsCard.svelte';
	import StreakDisplay from '../components/StreakDisplay.svelte';
	import Heatmap from '../components/Heatmap.svelte';
	import Flashcard from '../components/Flashcard.svelte';
	import RatingButtons from '../components/RatingButtons.svelte';
	import ProgressBar from '../components/ProgressBar.svelte';

	let selectedCategory = $state<string | null>(null);

	onMount(() => {
		statsStore.load('week');
		// Auto-load review items
		reviewStore.load(REVIEW_SESSION_LIMIT);
	});

	function filterByCategory(category: string) {
		selectedCategory = category;
		reviewStore.load(REVIEW_SESSION_LIMIT, category);
	}

	function clearFilter() {
		selectedCategory = null;
		reviewStore.load(REVIEW_SESSION_LIMIT);
	}

	function reloadReview() {
		reviewStore.load(REVIEW_SESSION_LIMIT, selectedCategory || undefined);
		statsStore.load('week');
	}

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

		const state = $reviewStore;

		if (e.code === 'Space' && !state.showAnswer && $currentItem) {
			e.preventDefault();
			reviewStore.reveal();
			return;
		}

		if (state.showAnswer && ['1', '2', '3', '4'].includes(e.key)) {
			e.preventDefault();
			reviewStore.rate(parseInt(e.key) as 1 | 2 | 3 | 4);
			return;
		}

		if ((e.key === 'z' || e.key === 'Backspace') && state.canUndo) {
			e.preventDefault();
			reviewStore.undo();
			return;
		}

		if (e.key === 's' && !state.showAnswer && $currentItem) {
			e.preventDefault();
			reviewStore.skip();
			return;
		}
	}

	function handleRate(rating: 1 | 2 | 3 | 4) {
		reviewStore.rate(rating);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="page">
	<div class="page-header">
		<h1 class="page-title">Lingo</h1>
		<p class="page-subtitle">Your language learning companion</p>
	</div>

	{#if $statsStore.loading && $reviewStore.loading}
		<div class="loading">Loading...</div>
	{:else if $statsStore.error}
		<div class="error">{$statsStore.error}</div>
	{:else}
		<div class="layout">
			<!-- Left: Review Area -->
			<div class="review-area">
				{#if selectedCategory}
					<div class="filter-header">
						<span class="filter-badge">{formatCategory(selectedCategory)}</span>
						<button class="clear-filter" onclick={clearFilter}>Clear</button>
					</div>
				{/if}

				{#if $reviewStore.loading}
					<div class="review-card card">
						<div class="loading">Loading...</div>
					</div>
				{:else if $reviewStore.error}
					<div class="error">{$reviewStore.error}</div>
				{:else if $reviewStore.items.length === 0 || $isSessionComplete}
					<div class="review-card card empty-state">
						<div class="empty-icon">✨</div>
						<h3>All caught up!</h3>
						<p>No items to review right now.</p>
						{#if $isSessionComplete && $progress.completed > 0}
							<div class="session-summary">
								<span class="summary-text">Reviewed {$progress.completed} item{$progress.completed !== 1 ? 's' : ''}</span>
								<div class="rating-pills">
									<span class="pill again">{$reviewStore.ratingCounts[1]}</span>
									<span class="pill hard">{$reviewStore.ratingCounts[2]}</span>
									<span class="pill good">{$reviewStore.ratingCounts[3]}</span>
									<span class="pill easy">{$reviewStore.ratingCounts[4]}</span>
								</div>
							</div>
							<div class="complete-actions">
								{#if $reviewStore.canUndo}
									<button class="btn btn-secondary" onclick={() => reviewStore.undo()}>
										↩ Undo Last
									</button>
								{/if}
								<button class="btn btn-primary" onclick={reloadReview}>
									Start New Session
								</button>
							</div>
						{/if}
					</div>
				{:else if $currentItem}
					<div class="review-card">
						<ProgressBar current={$progress.current} total={$progress.total} />

						<div class="flashcard-wrapper">
							<Flashcard
								item={$currentItem}
								showAnswer={$reviewStore.showAnswer}
								onReveal={() => reviewStore.reveal()}
							/>
						</div>

						{#if $reviewStore.showAnswer}
							<div class="rating-section">
								<p class="rating-prompt">How well did you remember?</p>
								<RatingButtons onRate={handleRate} />
							</div>
						{/if}

						<div class="action-row">
							<button
								class="btn btn-secondary action-btn"
								onclick={() => reviewStore.undo()}
								disabled={!$reviewStore.canUndo}
							>
								↩ Undo <span class="kbd">z</span>
							</button>
							<button
								class="btn btn-secondary action-btn"
								onclick={() => reviewStore.skip()}
								disabled={$reviewStore.showAnswer}
							>
								Skip → <span class="kbd">s</span>
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Right: Stats Sidebar -->
			<div class="sidebar">
				<!-- Stats -->
				<div class="stats-grid">
					<StatsCard
						value={$statsStore.stats?.totalPrompts ?? 0}
						label="Prompts"
						icon="📝"
					/>
					<StatsCard
						value={$statsStore.stats?.correctionsCount ?? 0}
						label="Corrections"
						icon="✓"
					/>
					<StatsCard
						value={$statsStore.stats?.alternativesCount ?? 0}
						label="Alternatives"
						icon="💡"
					/>
					<StatsCard
						value={$statsStore.stats?.itemsDueForReview ?? 0}
						label="Due"
						icon="⏰"
					/>
				</div>

				<!-- Streak -->
				{#if $statsStore.streaks}
					<StreakDisplay
						current={$statsStore.streaks.current_streak}
						best={$statsStore.streaks.best_streak}
					/>
				{/if}

				<!-- Heatmap -->
				{#if $statsStore.heatmap}
					<Heatmap data={$statsStore.heatmap} />
				{/if}

				<!-- Categories -->
				{#if $statsStore.categories.length > 0}
					<div class="categories-section card">
						<h3 class="categories-title">Categories</h3>
						<div class="categories">
							{#each $statsStore.categories as cat}
								<button
									class="category-chip"
									class:active={selectedCategory === cat.category}
									onclick={() => filterByCategory(cat.category)}
								>
									<span class="category-name">{formatCategory(cat.category)}</span>
									<span class="category-count">{cat.count}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: 1fr 320px;
		gap: 2rem;
		align-items: start;
	}

	/* Review Area */
	.review-area {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.filter-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.filter-badge {
		padding: 0.375rem 0.75rem;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		text-transform: capitalize;
	}

	.clear-filter {
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.clear-filter:hover {
		color: var(--color-text);
	}

	.review-card {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.flashcard-wrapper {
		margin: 0.5rem 0;
	}

	.rating-section {
		text-align: center;
	}

	.rating-prompt {
		color: var(--color-text-muted);
		margin-bottom: 1rem;
		font-size: 0.9375rem;
	}

	.action-row {
		display: flex;
		justify-content: center;
		gap: 1rem;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.action-btn .kbd {
		font-size: 0.6875rem;
		opacity: 0.6;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
	}

	.empty-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
	}

	.empty-state h3 {
		margin-bottom: 0.5rem;
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin-bottom: 1.5rem;
	}

	.complete-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}

	.session-summary {
		margin-bottom: 1.5rem;
	}

	.summary-text {
		display: block;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
	}

	.rating-pills {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
	}

	.pill {
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.pill.again { background: rgba(199, 107, 107, 0.15); color: var(--color-error); }
	.pill.hard { background: rgba(212, 165, 90, 0.15); color: var(--color-warning); }
	.pill.good { background: rgba(122, 158, 126, 0.15); color: var(--color-success); }
	.pill.easy { background: var(--color-primary-soft); color: var(--color-primary); }

	/* Sidebar */
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.categories-section {
		padding: 1.25rem;
	}

	.categories-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.categories {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.category-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.category-chip:hover {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.category-chip.active {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	.category-name {
		text-transform: capitalize;
	}

	.category-count {
		background: var(--color-bg);
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	/* Responsive */
	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.sidebar {
			order: -1;
		}

		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	@media (max-width: 600px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
