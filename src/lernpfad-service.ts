import { getCourseMarkdownUrl, readCourseMarkdown } from './store';
import { parseLearningCourse } from './lernpfad-course';
import { readLearningState } from './lernpfad-state';
import { buildLearningReport } from './lernpfad-recommendations';
import { loadSharedCourseRuntime } from './lernpfad-shared';
import type { LearningReport } from './lernpfad-types';

let pending: { url: string; promise: Promise<LearningReport> } | null = null;
let latest: LearningReport | null = null;
const clone = (report: LearningReport): LearningReport => JSON.parse(JSON.stringify(report));
const topicKey = (value: string): string => value.trim().replace(/\s+/g, ' ')
  .normalize('NFC').toLocaleLowerCase('de-DE');

function uniqueTopics(values: string[]): string[] {
  const topics = new Map<string, string>();
  for (const value of values) {
    const display = String(value || '').trim().replace(/\s+/g, ' ').normalize('NFC');
    const key = topicKey(display);
    if (key && !topics.has(key)) topics.set(key, display);
  }
  return [...topics.values()];
}

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
      try {
        const runtime = await loadSharedCourseRuntime();
        const curriculum = runtime.generator.deriveCurriculumContext(runtime.catalog, {
          observedThemes: report.topics.map(topic => topic.topic),
          grade: report.context.grade,
          schoolType: report.context.schoolType
        });
        if (!Array.isArray(curriculum.allowedThemes) ||
            curriculum.allowedThemes.some(theme => typeof theme !== 'string')) {
          throw new Error('Der Lehrplankontext besitzt ein unbekanntes Format.');
        }
        report.secondaryTopicOptions.deepen = uniqueTopics(curriculum.allowedThemes);
        report.curriculumJurisdiction = runtime.catalog.curriculum?.jurisdiction || 'DE-SN';
      } catch {
        report.warnings.push(
          'Frühere Lehrplanthemen für Vertiefungen konnten nicht geladen werden; angezeigt werden nur Themen dieses Kurses.'
        );
      }
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
