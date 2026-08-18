// Shared interfaces and global declarations for lia-mathpath.

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
      setGlossary: (entries: GlossaryEntry[]) => number;
      loadGlossaryMarkdown: (markdown: string) => number;
      getGlossary: (term: string) => GlossaryEntry | null;
      recordWrongAttempt: (taskId: string, tags?: string[]) => number;
      generateLearningToken: (studentId?: string) => string;
      exportState: () => unknown;
      importState: (payload: unknown) => boolean;
    };
  }
}

export {};
