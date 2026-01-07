<script lang="ts">
	import type { HeatmapData } from '$lib/types';
	import { HEATMAP_MONTHS, HEATMAP_INTENSITY_THRESHOLDS } from '$lib/utils';

	interface Props {
		data: HeatmapData;
		months?: number;
	}

	let { data, months = HEATMAP_MONTHS }: Props = $props();

	function generateCalendar() {
		const today = new Date();
		const weeks: { date: Date; count: number }[][] = [];
		let currentWeek: { date: Date; count: number }[] = [];

		const startDate = new Date(today);
		startDate.setMonth(startDate.getMonth() - months);
		startDate.setDate(startDate.getDate() - startDate.getDay());

		const current = new Date(startDate);

		while (current <= today) {
			const dateStr = current.toISOString().split('T')[0];
			currentWeek.push({
				date: new Date(current),
				count: data[dateStr] || 0
			});

			if (current.getDay() === 6) {
				weeks.push(currentWeek);
				currentWeek = [];
			}

			current.setDate(current.getDate() + 1);
		}

		if (currentWeek.length > 0) {
			weeks.push(currentWeek);
		}

		return weeks;
	}

	function getIntensity(count: number): number {
		if (count === 0) return 0;
		if (count <= HEATMAP_INTENSITY_THRESHOLDS.LOW) return 1;
		if (count <= HEATMAP_INTENSITY_THRESHOLDS.MEDIUM) return 2;
		if (count <= HEATMAP_INTENSITY_THRESHOLDS.HIGH) return 3;
		return 4;
	}

	function formatDate(date: Date): string {
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	let weeks = $derived(generateCalendar());
</script>

<div class="heatmap card">
	<div class="heatmap-header">
		<span class="heatmap-title">Activity</span>
		<div class="heatmap-legend">
			<span class="legend-label">Less</span>
			<div class="legend-scale">
				<div class="day intensity-0"></div>
				<div class="day intensity-1"></div>
				<div class="day intensity-2"></div>
				<div class="day intensity-3"></div>
				<div class="day intensity-4"></div>
			</div>
			<span class="legend-label">More</span>
		</div>
	</div>
	<div class="heatmap-grid">
		{#each weeks as week}
			<div class="week">
				{#each week as day}
					<div
						class="day intensity-{getIntensity(day.count)}"
						title="{formatDate(day.date)}: {day.count} review{day.count !== 1 ? 's' : ''}"
					></div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.heatmap {
		padding: 0.75rem 1rem;
	}

	.heatmap-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.heatmap-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.heatmap-grid {
		display: flex;
		gap: 2px;
		overflow-x: auto;
	}

	.week {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.day {
		width: 8px;
		height: 8px;
		border-radius: 1px;
	}

	/* Warm terracotta color scale */
	.day.intensity-0 {
		background: var(--color-border);
	}

	.day.intensity-1 {
		background: #f5ddd4;
	}

	.day.intensity-2 {
		background: #e8b8a5;
	}

	.day.intensity-3 {
		background: #d4916e;
	}

	.day.intensity-4 {
		background: #b56a4d;
	}

	@media (prefers-color-scheme: dark) {
		.day.intensity-0 {
			background: #2a2723;
		}

		.day.intensity-1 {
			background: #4a3830;
		}

		.day.intensity-2 {
			background: #6b4a3a;
		}

		.day.intensity-3 {
			background: #a06850;
		}

		.day.intensity-4 {
			background: #d4916e;
		}
	}

	.heatmap-legend {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.legend-label {
		font-size: 0.5625rem;
		color: var(--color-text-muted);
	}

	.legend-scale {
		display: flex;
		gap: 1px;
	}
</style>
