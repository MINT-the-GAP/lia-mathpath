const MAX_DIRECT_COURSE_URL_LENGTH = 32_000;
const DIRECT_COURSE_ORIGIN = 'https://mint-the-gap.github.io';
const DIRECT_COURSE_PATH = '/Aufgabensammlung/course.html';
export const DIRECT_COURSE_RELEASE = '1.0.7';

export type LearningCourseOpenErrorCode =
  | 'POPUP_BLOCKED'
  | 'INVALID_OPENING_TARGET'
  | 'OPEN_FAILED';

export class LearningCourseOpenError extends Error {
  readonly code: LearningCourseOpenErrorCode;
  constructor(code: LearningCourseOpenErrorCode, message: string) {
    super(message);
    this.name = 'LearningCourseOpenError';
    this.code = code;
  }
}

type OpenedWindow = Pick<Window, 'closed' | 'close' | 'opener'> & {
  location: Pick<Location, 'replace'>;
};
type BrowserWindow = Pick<Window, 'open'>;

function validateOpeningTarget(value: string): string {
  const target = String(value || '');
  if (!target || target.length > MAX_DIRECT_COURSE_URL_LENGTH) {
    throw new LearningCourseOpenError(
      'INVALID_OPENING_TARGET',
      'Der erzeugte Kurslink ist leer oder für die sichere Übergabe zu groß.'
    );
  }
  try {
    const url = new URL(target);
    const supportedSearch = url.search === '' || url.search === `?v=${DIRECT_COURSE_RELEASE}`;
    if (url.origin !== DIRECT_COURSE_ORIGIN || url.pathname !== DIRECT_COURSE_PATH ||
        !supportedSearch || !url.hash.startsWith('#course=')) throw new Error('unexpected target');
    return url.href;
  } catch (_) {
    throw new LearningCourseOpenError(
      'INVALID_OPENING_TARGET',
      'Das Öffnungsziel des erzeugten Kurses wird nicht unterstützt.'
    );
  }
}

/**
 * Reserve the popup before the first await, then navigate only after the pure
 * generation succeeds. A failed build never leaves a partially generated page.
 */
export async function generateAndOpenLearningCourse<T extends { openingTarget: string }>(
  generate: () => Promise<T>,
  browser: BrowserWindow = window
): Promise<T> {
  let popup: OpenedWindow | null = null;
  try {
    popup = browser.open('about:blank', '_blank') as OpenedWindow | null;
  } catch (_) {
    popup = null;
  }
  if (!popup || popup.closed) {
    throw new LearningCourseOpenError(
      'POPUP_BLOCKED',
      'Das neue Kursfenster wurde vom Browser blockiert. Erlaube Pop-ups und versuche es erneut.'
    );
  }
  try {
    popup.opener = null;
    const result = await generate();
    const target = validateOpeningTarget(result.openingTarget);
    if (popup.closed) {
      throw new LearningCourseOpenError(
        'OPEN_FAILED',
        'Das vorbereitete Kursfenster wurde geschlossen. Bitte versuche es erneut.'
      );
    }
    popup.location.replace(target);
    return result;
  } catch (error) {
    try { if (!popup.closed) popup.close(); } catch (_) { /* best effort */ }
    if (error instanceof LearningCourseOpenError) throw error;
    throw error;
  }
}
