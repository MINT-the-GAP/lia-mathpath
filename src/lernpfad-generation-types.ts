import type {
  LearningLevel,
  LearningOfferType,
  LearningRecommendation,
  LearningReport
} from './lernpfad-types';
import type { SharedCourseRuntime } from './lernpfad-shared';

export interface LearningCourseGenerationRequest {
  /** Exact source URL for which the displayed recommendation was produced. */
  courseUrl: string;
  /** Structured snapshot of the currently selected offer, never rendered UI text. */
  recommendation: LearningRecommendation;
}

export interface LearningCourseGenerationOptions {
  /** Makes the shared generator's random choice reproducible. */
  seed?: string | number;
  signal?: AbortSignal;
}

export interface GeneratedLearningCourse {
  sourceCourseUrl: string;
  type: LearningOfferType;
  topic: string;
  secondaryTopics: string[];
  targetLevel: LearningLevel;
  taskCount: 4;
  taskIds: string[];
  markdown: string;
  openingTarget: string;
  catalogVersion: number | string;
}

export type LearningGenerationErrorCode =
  | 'INVALID_REQUEST'
  | 'COURSE_CHANGED'
  | 'STALE_RECOMMENDATION'
  | 'OFFER_UNAVAILABLE'
  | 'MISSING_LEVEL'
  | 'NO_HIGHER_LEVEL'
  | 'CATALOG_UNAVAILABLE'
  | 'CATALOG_INVALID'
  | 'TOPIC_NOT_FOUND'
  | 'INSUFFICIENT_TASKS'
  | 'TASK_SOURCE_UNAVAILABLE'
  | 'UNSUPPORTED_DEPENDENCY'
  | 'MARKDOWN_INVALID'
  | 'TARGET_UNAVAILABLE'
  | 'COURSE_TOO_LARGE'
  | 'ABORTED'
  | 'GENERATION_FAILED';

export interface LearningGenerationErrorDetails {
  matchingTaskCount?: number;
  requiredTaskCount?: 4;
  topic?: string;
  secondaryTopics?: string[];
  targetLevel?: LearningLevel;
  causeCode?: string;
}

export interface LearningGenerationDependencies {
  getRecommendations(): Promise<LearningReport>;
  getCurrentCourseUrl(): string | null;
  loadRuntime(): Promise<SharedCourseRuntime>;
  fetcher?: typeof fetch;
}
