import { createLearningCourseGenerator } from './lernpfad-generation';
import type {
  GeneratedLearningCourse,
  LearningCourseGenerationOptions,
  LearningCourseGenerationRequest
} from './lernpfad-generation-types';
import { getLearningRecommendations } from './lernpfad-service';
import { loadSharedCourseRuntime } from './lernpfad-shared';
import { getCourseMarkdownUrl } from './store';

let generate: ReturnType<typeof createLearningCourseGenerator> | null = null;

/**
 * Generate and prepare a four-task Lernpfad course without opening a window.
 * The UI transport deliberately remains separate so this function is equally
 * usable from tests and the structured MathPath API.
 */
export function generateLearningCourse(
  request: LearningCourseGenerationRequest,
  options: LearningCourseGenerationOptions = {}
): Promise<GeneratedLearningCourse> {
  generate ??= createLearningCourseGenerator({
    getRecommendations: getLearningRecommendations,
    getCurrentCourseUrl: getCourseMarkdownUrl,
    loadRuntime: () => loadSharedCourseRuntime(),
    fetcher: window.fetch.bind(window)
  });
  return generate(request, options);
}
