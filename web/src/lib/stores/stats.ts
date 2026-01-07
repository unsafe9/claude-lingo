import { writable } from 'svelte/store';
import { getReviewStats, getStreaks, getHeatmap, getCategories } from '../api';
import type { Stats, StreakData, HeatmapData, CategoryCount } from '../types';
import { HEATMAP_MONTHS } from '../utils';

interface StatsState {
  stats: Stats | null;
  streaks: StreakData | null;
  heatmap: HeatmapData | null;
  categories: CategoryCount[];
  loading: boolean;
  error: string | null;
}

const initialState: StatsState = {
  stats: null,
  streaks: null,
  heatmap: null,
  categories: [],
  loading: false,
  error: null
};

function createStatsStore() {
  const { subscribe, set, update } = writable<StatsState>(initialState);

  return {
    subscribe,

    // Load all stats data
    async load(range: 'day' | 'week' | 'month' | 'all' = 'week') {
      update(s => ({ ...s, loading: true, error: null }));
      try {
        const [stats, streaks, heatmap, categories] = await Promise.all([
          getReviewStats(range),
          getStreaks(),
          getHeatmap(HEATMAP_MONTHS),
          getCategories()
        ]);
        set({
          stats,
          streaks,
          heatmap,
          categories,
          loading: false,
          error: null
        });
      } catch (e) {
        update(s => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load stats'
        }));
      }
    },

  };
}

export const statsStore = createStatsStore();
