export type RuntimeLearningTask = {
  taskIndex: number;
  nativeIndex: number;
  table: 'quiz';
  outcome: 'correct' | 'wrong' | 'resolved' | 'open';
  trial: number;
};

export type RuntimeLearningState = {
  version: 1;
  slides: Record<string, RuntimeLearningTask[]>;
};

type LearningWindow = Window & typeof globalThis;

export function installRuntimeLearningState(win?: LearningWindow): void;
export function readRuntimeLearningState(win?: LearningWindow): RuntimeLearningState;
