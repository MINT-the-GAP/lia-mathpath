// Shared interfaces and global declarations for lia-mathpath.
import type { LearningReport } from './lernpfad-types';
import type {
  GeneratedLearningCourse,
  LearningCourseGenerationOptions,
  LearningCourseGenerationRequest
} from './lernpfad-generation-types';

export interface GlossaryEntry {
  term: string;
  explanation: string;
  tags: string[];
  links: string[];
  aliases?: string[];
}

export interface TaskAttempt {
  taskId: string;
  wrongCount: number;
  tags: string[];
}

export interface MathPathStore {
  glossary: Record<string, GlossaryEntry>;
  glossaryAliases: Record<string, string>;
  attempts: Record<string, TaskAttempt>;
}

declare global {
  interface Window {
    __LIA_MATHPATH__: {
      getLearningRecommendations: () => Promise<LearningReport>;
      getLastLearningRecommendations: () => LearningReport | null;
      generateLearningCourse: (
        request: LearningCourseGenerationRequest,
        options?: LearningCourseGenerationOptions
      ) => Promise<GeneratedLearningCourse>;
      openGeneratedLearningCourse: (
        result: GeneratedLearningCourse
      ) => Promise<GeneratedLearningCourse>;
      openLearningCourse: (
        request: LearningCourseGenerationRequest,
        options?: LearningCourseGenerationOptions
      ) => Promise<GeneratedLearningCourse>;
      setGlossary: (entries: GlossaryEntry[]) => number;
      loadGlossaryMarkdown: (markdown: string) => number;
      getGlossary: (term: string) => GlossaryEntry | null;
      setTooltips: (mode: string) => boolean;
      tooltipsEnabled: () => boolean;
      recordWrongAttempt: (taskId: string, tags?: string[]) => number;
      generateLearningToken: (studentId?: string) => string;
      exportState: () => unknown;
      importState: (payload: unknown) => boolean;
    };
  }
}

export {};
