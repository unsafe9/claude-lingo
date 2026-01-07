import { writable, derived, get } from 'svelte/store';
import { getReviewDue, rateReviewItem } from '../api';
import type { ReviewItem } from '../types';

// Action history entry for undo
interface ActionHistoryEntry {
  type: 'rate' | 'skip';
  itemIndex: number;
  rating?: 1 | 2 | 3 | 4;
  // For skip: the original items array before skip
  previousItems?: ReviewItem[];
}

// Session state
interface ReviewSession {
  items: ReviewItem[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  completed: number;
  showAnswer: boolean;
  // Undo support
  lastAction: ActionHistoryEntry | null;
  canUndo: boolean;
  // Rating stats
  ratingCounts: { 1: number; 2: number; 3: number; 4: number };
}

const initialState: ReviewSession = {
  items: [],
  currentIndex: 0,
  loading: false,
  error: null,
  completed: 0,
  showAnswer: false,
  lastAction: null,
  canUndo: false,
  ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0 }
};

function createReviewStore() {
  const { subscribe, set, update } = writable<ReviewSession>(initialState);

  return {
    subscribe,

    // Load items due for review
    async load(limit = 20, category?: string) {
      update(s => ({ ...s, loading: true, error: null }));
      try {
        const { items } = await getReviewDue(limit, category);
        set({
          items,
          currentIndex: 0,
          loading: false,
          error: null,
          completed: 0,
          showAnswer: false,
          lastAction: null,
          canUndo: false,
          ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0 }
        });
      } catch (e) {
        update(s => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load items'
        }));
      }
    },

    // Show the answer (flip card)
    reveal() {
      update(s => ({ ...s, showAnswer: true }));
    },

    // Rate current item and move to next
    async rate(rating: 1 | 2 | 3 | 4) {
      const state = get({ subscribe });
      const item = state.items[state.currentIndex];
      if (!item) return;

      try {
        await rateReviewItem(item.id, rating);
        update(s => ({
          ...s,
          currentIndex: s.currentIndex + 1,
          completed: s.completed + 1,
          showAnswer: false,
          lastAction: { type: 'rate', itemIndex: s.currentIndex, rating },
          canUndo: true,
          ratingCounts: {
            ...s.ratingCounts,
            [rating]: s.ratingCounts[rating] + 1
          }
        }));
      } catch (e) {
        update(s => ({
          ...s,
          error: e instanceof Error ? e.message : 'Failed to rate item'
        }));
      }
    },

    // Undo last action (rating or skip)
    undo() {
      update(s => {
        if (!s.canUndo || !s.lastAction) return s;
        const action = s.lastAction;

        if (action.type === 'rate') {
          return {
            ...s,
            currentIndex: action.itemIndex,
            completed: s.completed - 1,
            showAnswer: true, // Show answer since they already saw it
            canUndo: false,
            lastAction: null,
            ratingCounts: {
              ...s.ratingCounts,
              [action.rating!]: s.ratingCounts[action.rating!] - 1
            }
          };
        } else if (action.type === 'skip' && action.previousItems) {
          return {
            ...s,
            items: action.previousItems,
            currentIndex: action.itemIndex,
            showAnswer: false,
            canUndo: false,
            lastAction: null
          };
        }

        return s;
      });
    },

    // Skip current item (move to end of queue)
    skip() {
      update(s => {
        if (s.currentIndex >= s.items.length) return s;
        const currentItem = s.items[s.currentIndex];
        const previousItems = [...s.items];
        const newItems = [
          ...s.items.slice(0, s.currentIndex),
          ...s.items.slice(s.currentIndex + 1),
          currentItem
        ];
        return {
          ...s,
          items: newItems,
          showAnswer: false,
          lastAction: { type: 'skip', itemIndex: s.currentIndex, previousItems },
          canUndo: true
        };
      });
    }
  };
}

export const reviewStore = createReviewStore();

// Derived stores
export const currentItem = derived(reviewStore, $s =>
  $s.items[$s.currentIndex] ?? null
);

export const progress = derived(reviewStore, $s => ({
  current: $s.currentIndex + 1,
  total: $s.items.length,
  completed: $s.completed
}));

export const isSessionComplete = derived(reviewStore, $s =>
  $s.items.length > 0 && $s.currentIndex >= $s.items.length
);
