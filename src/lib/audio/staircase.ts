/**
 * Adaptive staircase algorithm for hearing threshold estimation.
 *
 * Implements a 2-down/1-up staircase (2 correct responses → decrease level,
 * 1 incorrect → increase level), which converges on the 70.7% correct
 * response threshold (Levitt, 1971). This is the standard method for
 * adaptive audiometry.
 *
 * The algorithm tracks:
 * - Current stimulus level (in dB HL)
 * - Number of reversals (direction changes)
 * - Response history
 *
 * After a fixed number of reversals, the threshold is estimated as the
 * average of the last N reversal points.
 *
 * Reference: Levitt, H. (1971). "Transformed up-down methods in
 * psychoacoustics." JASA 49(2B): 467-477.
 */

export type StaircaseConfig = {
  startLevel: number; // dB HL, starting stimulus level
  minLevel: number; // dB HL, floor (can't go below)
  maxLevel: number; // dB HL, ceiling (can't go above)
  initialStepSize: number; // dB, step size before first reversal
  stepSizeAfterReversal: number; // dB, step size after first reversal
  targetReversals: number; // total reversals before stopping
  reversalsForThreshold: number; // number of final reversals to average
  downRule: number; // consecutive correct responses to decrease (2 for 2-down)
};

export type StaircaseState = {
  currentLevel: number;
  reversals: number;
  responses: boolean[]; // true = correct, false = incorrect
  reversalPoints: number[]; // levels at which reversals occurred
  consecutiveCorrect: number;
  lastDirection: "up" | "down" | null;
  isComplete: boolean;
  threshold: number | null;
};

export function createStaircase(config: StaircaseConfig): StaircaseState {
  return {
    currentLevel: config.startLevel,
    reversals: 0,
    responses: [],
    reversalPoints: [],
    consecutiveCorrect: 0,
    lastDirection: null,
    isComplete: false,
    threshold: null,
  };
}

/**
 * Record a response and advance the staircase.
 * Returns the updated state and the next stimulus level to present.
 */
export function recordResponse(
  state: StaircaseState,
  correct: boolean,
  config: StaircaseConfig,
): { state: StaircaseState; nextLevel: number } {
  if (state.isComplete) {
    return { state, nextLevel: state.currentLevel };
  }

  const newResponses = [...state.responses, correct];
  let newConsecutiveCorrect = state.consecutiveCorrect;
  let newLevel = state.currentLevel;
  let newDirection = state.lastDirection;
  let newReversals = state.reversals;
  let newReversalPoints = [...state.reversalPoints];

  if (correct) {
    newConsecutiveCorrect++;
    // Check if we should decrease level (go down)
    if (newConsecutiveCorrect >= config.downRule) {
      const stepSize = newReversals > 0 ? config.stepSizeAfterReversal : config.initialStepSize;
      newLevel = Math.max(config.minLevel, newLevel - stepSize);
      // Check for reversal (were we going up?)
      if (newDirection === "up") {
        newReversals++;
        newReversalPoints.push(state.currentLevel);
      }
      newDirection = "down";
      newConsecutiveCorrect = 0;
    }
  } else {
    newConsecutiveCorrect = 0;
    // Increase level (go up)
    const stepSize = newReversals > 0 ? config.stepSizeAfterReversal : config.initialStepSize;
    newLevel = Math.min(config.maxLevel, newLevel + stepSize);
    // Check for reversal (were we going down?)
    if (newDirection === "down") {
      newReversals++;
      newReversalPoints.push(state.currentLevel);
    }
    newDirection = "up";
  }

  // Check if staircase is complete
  let isComplete = false;
  let threshold = null;
  if (newReversals >= config.targetReversals) {
    isComplete = true;
    // Average the last N reversal points
    const pointsToAverage = newReversalPoints.slice(-config.reversalsForThreshold);
    if (pointsToAverage.length > 0) {
      threshold = pointsToAverage.reduce((a, b) => a + b, 0) / pointsToAverage.length;
    }
  }

  const newState: StaircaseState = {
    currentLevel: newLevel,
    reversals: newReversals,
    responses: newResponses,
    reversalPoints: newReversalPoints,
    consecutiveCorrect: newConsecutiveCorrect,
    lastDirection: newDirection,
    isComplete,
    threshold,
  };

  return { state: newState, nextLevel: newLevel };
}

/**
 * Default configuration for a 90-second ear test.
 * Tests one frequency at a time. With ~5 reversals needed and
 * ~3 seconds per trial, this fits in roughly 90 seconds per frequency.
 *
 * For a full ear test, run this for each audiometric frequency.
 * The 90-second demo budget allows testing 1-2 frequencies.
 */
export const DEFAULT_STAIRCASE_CONFIG: StaircaseConfig = {
  startLevel: 25, // dB HL — start at a moderate level
  minLevel: -10, // dB HL
  maxLevel: 80, // dB HL
  initialStepSize: 5, // 5 dB steps initially
  stepSizeAfterReversal: 2, // 2 dB steps after first reversal
  targetReversals: 6, // 6 reversals to complete
  reversalsForThreshold: 4, // average last 4 reversal points
  downRule: 2, // 2-down: 2 correct responses to decrease
};
