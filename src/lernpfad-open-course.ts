import { generateLearningCourse } from './lernpfad-generate-course';
import type {
  GeneratedLearningCourse,
  LearningCourseGenerationOptions,
  LearningCourseGenerationRequest
} from './lernpfad-generation-types';
import { generateAndOpenLearningCourse } from './lernpfad-open';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Open a previously generated result without running catalog selection again. */
export function openGeneratedLearningCourse(
  result: GeneratedLearningCourse,
  browser: Pick<Window, 'open'> = window
): Promise<GeneratedLearningCourse> {
  const snapshot = copy(result);
  return generateAndOpenLearningCourse(
    () => Promise.resolve(snapshot),
    browser
  ).then(copy);
}

/** Convenience operation that reserves a popup and then performs generation. */
export function openLearningCourse(
  request: LearningCourseGenerationRequest,
  options: LearningCourseGenerationOptions = {},
  browser: Pick<Window, 'open'> = window
): Promise<GeneratedLearningCourse> {
  return generateAndOpenLearningCourse(
    () => generateLearningCourse(request, options),
    browser
  );
}
