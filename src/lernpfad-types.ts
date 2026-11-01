/** Data shared by the read-only course/state adapters and recommendation UI. */
export type LearningLevel = 'Einsteiger' | 'Fortgeschritten' | 'Experte';
export type LearningStatus = 'correct' | 'wrong' | 'partial' | 'unanswered' | 'unavailable';
export type LearningSchoolType = 'oberschule' | 'gymnasium' | 'bgy';
export type LearningContextSource = 'header-tags' | 'comment' | 'title' | 'url';

/** Source-evidenced course context; missing or conflicting evidence stays null. */
export interface LearningCourseContext {
  grade: number | null;
  gradeSource: LearningContextSource | null;
  schoolType: LearningSchoolType | null;
  schoolTypeSource: LearningContextSource | null;
  headerTags: string[];
}

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
  context: LearningCourseContext;
  tasks: LearningTask[];
  warnings: string[];
  sendMode: boolean;
}

export interface LearningTaskState {
  taskId: string;
  status: LearningStatus;
  source: string;
  reason: string;
  /** Persisted failed checks before the current/final result. */
  failedAttempts?: number;
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
  /** Number of tasks with failed checks or a current learning need. */
  weaknessCount: number;
  /** Sum of persisted failed checks for this topic. */
  failedAttemptCount: number;
  /** Unanswered tasks; each contributes one point to weaknessScore. */
  unansweredCount: number;
  /** Failed attempts plus one point for every otherwise uncounted learning need. */
  weaknessScore: number;
  partialCount: number;
  unavailableCount: number;
  level: LearningLevel | null;
  levelReason: string;
}

export interface LearningRecommendation {
  type: LearningOfferType;
  topic: string | null;
  /** Optional additional topics; each receives its own task. */
  secondaryTopics: string[];
  targetLevel: LearningLevel | null;
  taskCount: 4;
  available: boolean;
  reason: string;
}

export interface LearningReport {
  courseUrl: string;
  context: LearningCourseContext;
  phase: LearningStateSnapshot['phase'];
  topics: LearningTopic[];
  weaknessTopics: LearningTopic[];
  /** Selectable secondary topics per offer; deepen includes prior Saxon curriculum topics. */
  secondaryTopicOptions: Record<LearningOfferType, string[]>;
  curriculumJurisdiction: string | null;
  recommendations: LearningRecommendation[];
  statusCounts: Record<LearningStatus, number>;
  warnings: string[];
}
