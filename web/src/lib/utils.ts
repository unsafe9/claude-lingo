export function formatCategory(cat: string): string {
  return cat.replace(/_/g, ' ');
}

export const REVIEW_SESSION_LIMIT = 20;

export const HEATMAP_MONTHS = 6;

export const HEATMAP_INTENSITY_THRESHOLDS = {
  LOW: 2,
  MEDIUM: 5,
  HIGH: 10
} as const;
