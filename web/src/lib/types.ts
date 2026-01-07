// Review item with prompt data
export interface ReviewItem {
  id: number;
  prompt_id: number;
  state: string;
  difficulty: number;
  stability: number;
  reps: number;
  lapses: number;
  due: string | null;
  last_review: string | null;
  prompt: string;
  correction: string | null;
  alternative: string | null;
  analysis_result: string | null;
  categories: string[];
}

// Statistics summary
export interface Stats {
  totalPrompts: number;
  correctionsCount: number;
  alternativesCount: number;
  itemsDueForReview: number;
  currentStreak: number;
  bestStreak: number;
}

// Streak data
export interface StreakData {
  current_streak: number;
  best_streak: number;
  last_review_date: string | null;
}

// Category count
export interface CategoryCount {
  category: string;
  count: number;
}

// Heatmap data (date -> review count)
export type HeatmapData = Record<string, number>;

// Rating result
export interface RatingResult {
  success: boolean;
  nextDue: string;
  currentStreak: number;
}
