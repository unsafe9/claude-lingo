import {
  FSRS,
  type Card,
  type Grade,
  Rating,
  State,
  createEmptyCard,
  generatorParameters,
} from "ts-fsrs";

// Initialize FSRS with optimized parameters
// - request_retention: 0.9 = target 90% recall rate
// - maximum_interval: 365 = max 1 year between reviews
// - enable_fuzz: true = add randomness to prevent clustering
const params = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: true,
});

const fsrs = new FSRS(params);

export { Rating, State };
export type { Grade };

// FSRS card state stored in database
export interface FSRSCardState {
  state: State;
  difficulty: number;
  stability: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  elapsedDays: number;
  learningSteps: number;
  lastReview: Date | null;
  due: Date;
}

// Create a new card with default FSRS state
export function createNewCard(): FSRSCardState {
  const card = createEmptyCard();
  return cardToState(card);
}

// Convert ts-fsrs Card to our database-friendly state
export function cardToState(card: Card): FSRSCardState {
  return {
    state: card.state,
    difficulty: card.difficulty,
    stability: card.stability,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduled_days,
    elapsedDays: card.elapsed_days,
    learningSteps: card.learning_steps,
    lastReview: card.last_review ?? null,
    due: card.due,
  };
}

// Convert our state back to ts-fsrs Card
export function stateToCard(state: FSRSCardState): Card {
  return {
    state: state.state,
    difficulty: state.difficulty,
    stability: state.stability,
    reps: state.reps,
    lapses: state.lapses,
    scheduled_days: state.scheduledDays,
    elapsed_days: state.elapsedDays,
    learning_steps: state.learningSteps,
    last_review: state.lastReview ?? undefined,
    due: state.due,
  };
}

// Rate a card and get the new state
// Note: Grade excludes Rating.Manual, so only Again(1), Hard(2), Good(3), Easy(4) are valid
export function rateCard(
  state: FSRSCardState,
  grade: Grade,
  now: Date = new Date()
): FSRSCardState {
  const card = stateToCard(state);
  const result = fsrs.repeat(card, now);
  const newCard = result[grade].card;
  return cardToState(newCard);
}

// Get the next review date for a card
export function getNextReviewDate(state: FSRSCardState): Date {
  return state.due;
}

// Convert 1-4 number rating to FSRS Grade
// 1 = Again (forgot), 2 = Hard, 3 = Good, 4 = Easy
// Note: Returns Grade type (excludes Rating.Manual)
export function numberToGrade(n: 1 | 2 | 3 | 4): Grade {
  switch (n) {
    case 1:
      return Rating.Again;
    case 2:
      return Rating.Hard;
    case 3:
      return Rating.Good;
    case 4:
      return Rating.Easy;
  }
}

// Convert FSRS Rating to descriptive string
export function ratingToString(rating: Rating): string {
  switch (rating) {
    case Rating.Again:
      return "Again";
    case Rating.Hard:
      return "Hard";
    case Rating.Good:
      return "Good";
    case Rating.Easy:
      return "Easy";
    default:
      return "Unknown";
  }
}

// Convert State to descriptive string
export function stateToString(state: State): string {
  switch (state) {
    case State.New:
      return "new";
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "unknown";
  }
}

// Parse state string back to State enum
export function stringToState(str: string): State {
  switch (str) {
    case "new":
      return State.New;
    case "learning":
      return State.Learning;
    case "review":
      return State.Review;
    case "relearning":
      return State.Relearning;
    default:
      return State.New;
  }
}

// Check if a card is due for review
export function isDue(state: FSRSCardState, now: Date = new Date()): boolean {
  return state.due <= now;
}

// Get retrievability (probability of recall) for a card
export function getRetrievability(
  state: FSRSCardState,
  now: Date = new Date()
): number {
  if (state.state === State.New) return 0;
  if (state.stability === 0) return 0;

  const elapsedDays =
    (now.getTime() - (state.lastReview?.getTime() ?? now.getTime())) /
    (1000 * 60 * 60 * 24);

  // FSRS forgetting curve: R = exp(t * ln(0.9) / S)
  // where t = elapsed time, S = stability
  return Math.exp((elapsedDays * Math.log(0.9)) / state.stability);
}
