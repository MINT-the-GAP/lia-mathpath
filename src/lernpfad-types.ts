/** Data shared by the read-only course/state adapters and recommendation UI. */
export type LearningLevel = 'Einsteiger' | 'Fortgeschritten' | 'Experte';
export type LearningStatus = 'correct' | 'wrong' | 'partial' | 'unanswered' | 'unavailable';

export interface LearningTask {
  id: string;
  hash: string;
  sectionIndex: number;
  taskIndex: number;
  nativeIndex: number | null;
  table: 'quiz' | 'survey' | null;
  tags: string[];
  points: number | null;
  level: LearningLevel | null;
  mappingSafe: boolean;
  sourceLine: number;
}

export interface LearningCourse {
  url: string;
  version: string | null;
  tasks: LearningTask[];
  warnings: string[];
  sendMode: boolean;
}

export interface LearningTaskState {
  taskId: string;
  status: LearningStatus;
  source: string;
  reason: string;
  earnedPoints?: number;
  maximumPoints?: number;
}

export interface LearningStateSnapshot {
  states: LearningTaskState[];
  warnings: string[];
  phase: 'live' | 'collect' | 'grading' | 'review' | 'unavailable';
}

export type LearningOfferType = 'weakness' | 'practice' | 'deepen';
export interface LearningTopic {
  topic: string;
  taskCount: number;
  weaknessCount: number;
  partialCount: number;
  unavailableCount: number;
  level: LearningLevel | null;
  levelReason: string;
}

export interface LearningRecommendation {
  type: LearningOfferType;
  topic: string | null;
  targetLevel: LearningLevel | null;
  taskCount: 4;
  available: boolean;
  reason: string;
}

export interface LearningReport {
  courseUrl: string;
  phase: LearningStateSnapshot['phase'];
  topics: LearningTopic[];
  weaknessTopics: LearningTopic[];
  recommendations: LearningRecommendation[];
  statusCounts: Record<LearningStatus, number>;
  warnings: string[];
}
