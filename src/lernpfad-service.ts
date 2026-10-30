import { getCourseMarkdownUrl, readCourseMarkdown } from './store';
import { parseLearningCourse } from './lernpfad-course';
import { readLearningState } from './lernpfad-state';
import { buildLearningReport } from './lernpfad-recommendations';
import type { LearningReport } from './lernpfad-types';

let pending: { url: string; promise: Promise<LearningReport> } | null = null;
let latest: LearningReport | null = null;
const clone = (report: LearningReport): LearningReport => JSON.parse(JSON.stringify(report));

/** Explicit requests only; no background grading, writes, or result tracker. */
export async function getLearningRecommendations(): Promise<LearningReport> {
  const url = getCourseMarkdownUrl();
  if (!url) throw new Error('Die Kursquelle ist nicht erreichbar. Bitte den Kurs über seine Markdown-URL öffnen.');
  if (pending?.url === url) return clone(await pending.promise);
  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const course = parseLearningCourse(await readCourseMarkdown(url, {
        signal: controller.signal,
        cache: 'no-cache',
      }), url);
      const snapshot = await readLearningState(course);
      const report = buildLearningReport(course, snapshot);
      if (getCourseMarkdownUrl() !== url) throw new Error('Der Kurs wurde inzwischen gewechselt. Bitte erneut erstellen.');
      latest = clone(report);
      return report;
    } finally { clearTimeout(timeout); }
  })();
  pending = { url, promise };
  try { return clone(await promise); }
  finally { if (pending?.promise === promise) pending = null; }
}

export function getLastLearningRecommendations(): LearningReport | null {
  return latest?.courseUrl === getCourseMarkdownUrl() ? clone(latest) : null;
}
