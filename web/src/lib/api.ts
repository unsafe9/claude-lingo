import type { ReviewItem, Stats, StreakData, CategoryCount, HeatmapData, RatingResult } from './types';

const API_BASE = '/api';

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Get items due for review
export async function getReviewDue(limit = 20, category?: string): Promise<{ items: ReviewItem[]; totalDue: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (category) params.set('category', category);
  return fetchJson(`/review/due?${params}`);
}

// Get review statistics
export async function getReviewStats(range: 'day' | 'week' | 'month' | 'all' = 'week'): Promise<Stats> {
  return fetchJson(`/review/stats?range=${range}`);
}

// Rate a review item
export async function rateReviewItem(id: number, rating: 1 | 2 | 3 | 4): Promise<RatingResult> {
  return fetchJson(`/review/${id}/rate`, {
    method: 'POST',
    body: JSON.stringify({ rating })
  });
}

// Get streak data
export async function getStreaks(): Promise<StreakData> {
  return fetchJson('/streaks');
}

// Get heatmap data
export async function getHeatmap(months = 6): Promise<HeatmapData> {
  return fetchJson(`/heatmap?months=${months}`);
}

// Get categories with counts
export async function getCategories(): Promise<CategoryCount[]> {
  return fetchJson('/categories');
}
