import { selectLearningRecommendation } from './lernpfad-recommendations';
import type {
  GeneratedLearningCourse,
  LearningCourseGenerationOptions,
  LearningCourseGenerationRequest,
  LearningGenerationDependencies,
  LearningGenerationErrorCode,
  LearningGenerationErrorDetails,
} from './lernpfad-generation-types';
import type {
  SharedGeneration,
  SharedGeneratorRequest,
  SharedLearningPathManifest
} from './lernpfad-shared';
import type {
  LearningLevel,
  LearningOfferType,
  LearningRecommendation,
  LearningReport,
  LearningTopic
} from './lernpfad-types';

type SharedLearningGroup = SharedGeneratorRequest['group'];
type SharedLearningOffer = SharedLearningPathManifest['offer'];
type RevalidatedRecommendation = {
  recommendation: LearningRecommendation & { topic: string; targetLevel: LearningLevel };
  contextThemes: string[];
};

const LEVEL_GROUPS: Record<LearningLevel, SharedLearningGroup> = {
  Einsteiger: 'einsteiger',
  Fortgeschritten: 'fortgeschrittene',
  Experte: 'experten'
};

const OFFER_NAMES: Record<LearningOfferType, SharedLearningOffer> = {
  weakness: 'schwaechen-ueben',
  practice: 'weitere-uebungen',
  deepen: 'vertiefungen'
};

const LEVELS = new Set<LearningLevel>(['Einsteiger', 'Fortgeschritten', 'Experte']);
const OFFERS = new Set<LearningOfferType>(['weakness', 'practice', 'deepen']);

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeTopic(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('de-DE');
}

export class LearningGenerationError extends Error {
  readonly code: LearningGenerationErrorCode;
  readonly details: LearningGenerationErrorDetails;

  constructor(
    code: LearningGenerationErrorCode,
    message: string,
    details: LearningGenerationErrorDetails = {}
  ) {
    super(message);
    this.name = 'LearningGenerationError';
    this.code = code;
    this.details = copy(details);
  }
}

function fail(
  code: LearningGenerationErrorCode,
  message: string,
  details: LearningGenerationErrorDetails = {}
): never {
  throw new LearningGenerationError(code, message, details);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) fail('ABORTED', 'Die Kurserzeugung wurde abgebrochen.');
}

function validateRequest(request: LearningCourseGenerationRequest): {
  courseUrl: string;
  recommendation: LearningRecommendation & { topic: string };
} {
  if (!request || typeof request !== 'object') {
    fail('INVALID_REQUEST', 'Die Kursempfehlung fehlt.');
  }
  const courseUrl = String(request.courseUrl || '').trim();
  const recommendation = request.recommendation;
  if (!courseUrl || !recommendation || typeof recommendation !== 'object') {
    fail('INVALID_REQUEST', 'Kursquelle und strukturierte Empfehlung werden benötigt.');
  }
  if (!OFFERS.has(recommendation.type)) {
    fail('INVALID_REQUEST', 'Der Angebotstyp wird nicht unterstützt.');
  }
  if (recommendation.taskCount !== 4) {
    fail('INVALID_REQUEST', 'Ein Lernpfad-Kurs enthält immer genau vier Aufgaben.');
  }
  const topic = typeof recommendation.topic === 'string' ? recommendation.topic.trim() : '';
  if (!topic) fail('INVALID_REQUEST', 'Für die Kurserzeugung fehlt ein Thema.');
  if (recommendation.targetLevel !== null && !LEVELS.has(recommendation.targetLevel)) {
    fail('MISSING_LEVEL', 'Für die Kurserzeugung fehlt ein gültiges Zielniveau.', { topic });
  }
  return {
    courseUrl,
    recommendation: { ...copy(recommendation), topic }
  };
}

function topicFor(
  report: LearningReport,
  type: LearningOfferType,
  requestedTopic: string
): LearningTopic | undefined {
  const wanted = normalizeTopic(requestedTopic);
  const topics = type === 'weakness' ? report.weaknessTopics : report.topics;
  return topics.find(topic => normalizeTopic(topic.topic) === wanted);
}

function uniqueThemes(values: Iterable<string>): string[] {
  const themes = new Map<string, string>();
  for (const value of values) {
    const display = String(value || '').trim().replace(/\s+/g, ' ').normalize('NFC');
    const normalized = normalizeTopic(display);
    if (normalized && !themes.has(normalized)) themes.set(normalized, display);
  }
  return [...themes.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'de'))
    .map(([, display]) => display);
}

function reportContextThemes(report: LearningReport): string[] {
  return uniqueThemes(report.topics.map(topic => topic.topic));
}

function catalogTopicUniverse(runtime: Awaited<ReturnType<LearningGenerationDependencies['loadRuntime']>>): string[] {
  const topics: string[] = [];
  for (const task of runtime.catalog.tasks) topics.push(...task.topics);
  return uniqueThemes(topics);
}

function sameThemeContext(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => normalizeTopic(value) === normalizeTopic(right[index]));
}

async function revalidate(
  dependencies: LearningGenerationDependencies,
  courseUrl: string,
  requested: LearningRecommendation & { topic: string },
  signal?: AbortSignal
): Promise<RevalidatedRecommendation> {
  checkAbort(signal);
  if (dependencies.getCurrentCourseUrl() !== courseUrl) {
    fail('COURSE_CHANGED', 'Der Ausgangskurs wurde inzwischen gewechselt. Bitte Empfehlungen neu erstellen.');
  }
  const report = await dependencies.getRecommendations();
  checkAbort(signal);
  if (dependencies.getCurrentCourseUrl() !== courseUrl || report.courseUrl !== courseUrl) {
    fail('COURSE_CHANGED', 'Der Ausgangskurs wurde inzwischen gewechselt. Bitte Empfehlungen neu erstellen.');
  }
  const topic = topicFor(report, requested.type, requested.topic);
  const current = selectLearningRecommendation(requested.type, topic, report.phase);
  if (!current.available || !current.topic || !current.targetLevel) {
    if (requested.type === 'deepen' && topic?.level === 'Experte') {
      fail('NO_HIGHER_LEVEL', 'Oberhalb von Experte ist keine weitere Lernpfad-Stufe vorgesehen.', {
        topic: requested.topic,
        targetLevel: requested.targetLevel ?? undefined
      });
    }
    if (topic && !topic.level && requested.type !== 'weakness') {
      fail('MISSING_LEVEL', 'Für das gewählte Thema fehlt ein belegtes Zielniveau.', {
        topic: requested.topic
      });
    }
    fail('OFFER_UNAVAILABLE', current.reason || 'Dieses Lernpfad-Angebot ist derzeit nicht verfügbar.', {
      topic: requested.topic,
      targetLevel: requested.targetLevel ?? undefined
    });
  }
  if (
    normalizeTopic(current.topic) !== normalizeTopic(requested.topic) ||
    current.targetLevel !== requested.targetLevel ||
    current.taskCount !== 4
  ) {
    fail('STALE_RECOMMENDATION', 'Thema oder Zielniveau haben sich geändert. Bitte Empfehlungen neu erstellen.', {
      topic: requested.topic,
      targetLevel: requested.targetLevel ?? undefined
    });
  }
  return {
    recommendation: current as LearningRecommendation & { topic: string; targetLevel: LearningLevel },
    contextThemes: reportContextThemes(report)
  };
}

function sharedRequest(
  topic: string,
  group: SharedLearningGroup,
  allowedThemes: string[],
  curriculumThemes: string[],
  seed?: string | number
): SharedGeneratorRequest {
  const request: SharedGeneratorRequest = {
    themes: [topic],
    blockedThemes: [],
    allowedThemes: [...allowedThemes],
    curriculumThemes: [...curriculumThemes],
    count: 4,
    group,
    strictCount: true
  };
  if (seed !== undefined) request.seed = seed;
  return request;
}

function validateGenerated(
  output: SharedGeneration,
  requested: LearningRecommendation & { topic: string }
): void {
  const tasks = Array.isArray(output?.tasks) ? output.tasks : [];
  const ids = tasks.map(task => String(task?.id || '').trim());
  const urls = tasks.map(task => String(task?.url || '').trim());
  if (tasks.length !== 4 || ids.some(id => !id) || new Set(ids).size !== 4 ||
      urls.some(url => !url) || new Set(urls).size !== 4) {
    fail('INSUFFICIENT_TASKS', 'Es wurden nicht genau vier verschiedene passende Aufgaben ausgewählt.', {
      matchingTaskCount: new Set(ids.filter(Boolean)).size,
      requiredTaskCount: 4,
      topic: requested.topic,
      targetLevel: requested.targetLevel ?? undefined
    });
  }
  if (!String(output.source || '').trim()) {
    fail('MARKDOWN_INVALID', 'Der gemeinsame Generator hat keinen gültigen LiaScript-Quelltext erzeugt.', {
      topic: requested.topic,
      targetLevel: requested.targetLevel ?? undefined
    });
  }
}

function learningPathManifest(
  type: LearningOfferType,
  topic: string,
  group: SharedLearningGroup,
  urls: string[]
): SharedLearningPathManifest {
  return { v: 1, kind: 'lernpfad', offer: OFFER_NAMES[type], topic, level: group, urls: [...urls] };
}

/**
 * Create a generation service that never opens or navigates a browser window.
 * The current recommendation is checked both before and after shared generator
 * I/O so a delayed Freeze/Send transition cannot leak a stale weakness offer.
 */
export function createLearningCourseGenerator(dependencies: LearningGenerationDependencies): (
  request: LearningCourseGenerationRequest,
  options?: LearningCourseGenerationOptions
) => Promise<GeneratedLearningCourse> {
  return async (input, options = {}) => {
    const { courseUrl, recommendation } = validateRequest(input);
    checkAbort(options.signal);
    const validated = await revalidate(dependencies, courseUrl, recommendation, options.signal);
    const current = validated.recommendation;
    const group = LEVEL_GROUPS[current.targetLevel];
    let output: SharedGeneration;
    let openingTarget = '';
    let catalogVersion: number | string = '';
    let runtimeLoaded = false;
    try {
      const runtime = await dependencies.loadRuntime();
      runtimeLoaded = true;
      checkAbort(options.signal);
      const generatorRequest = sharedRequest(
        recommendation.topic,
        group,
        validated.contextThemes,
        catalogTopicUniverse(runtime),
        options.seed
      );
      const sourceManifest = learningPathManifest(current.type, recommendation.topic, group, []);
      const generatorOptions: Record<string, unknown> = {
        assembler: runtime.assembler,
        signal: options.signal,
        sourceOptions: runtime.generator.learningPathSourceOptions(sourceManifest)
      };
      if (dependencies.fetcher) generatorOptions.fetch = dependencies.fetcher;
      output = await runtime.generator.generate(runtime.catalog, copy(generatorRequest), generatorOptions);
      validateGenerated(output, recommendation);
      const urls = output.tasks.map(task => task.url);
      const manifest = learningPathManifest(current.type, recommendation.topic, group, urls);
      openingTarget = runtime.generator.buildDirectCourseUrl(
        new URL('index.html', runtime.baseUrl).href,
        manifest
      );
      catalogVersion = runtime.catalog.version;
      if (!String(openingTarget || '').trim()) {
        fail('TARGET_UNAVAILABLE', 'Für den erzeugten Kurs konnte kein Öffnungsziel erstellt werden.', {
          topic: recommendation.topic,
          targetLevel: recommendation.targetLevel ?? undefined
        });
      }
    } catch (error) {
      if (error instanceof LearningGenerationError) throw error;
      const value = error as {
        code?: unknown;
        message?: unknown;
        matchingTaskCount?: unknown;
        details?: { matchingTaskCount?: unknown; available?: unknown };
      };
      const causeCode = typeof value?.code === 'string' ? value.code : '';
      const mapping: Partial<Record<string, LearningGenerationErrorCode>> = {
        CATALOG_UNAVAILABLE: 'CATALOG_UNAVAILABLE',
        INVALID_CATALOG: 'CATALOG_INVALID',
        CATALOG_INVALID: 'CATALOG_INVALID',
        NO_TASKS: 'TOPIC_NOT_FOUND',
        INSUFFICIENT_TASKS: 'INSUFFICIENT_TASKS',
        FETCH_FAILED: 'TASK_SOURCE_UNAVAILABLE',
        TASK_SOURCE_UNAVAILABLE: 'TASK_SOURCE_UNAVAILABLE',
        ASSEMBLER_MISSING: 'UNSUPPORTED_DEPENDENCY',
        UNSUPPORTED_DEPENDENCY: 'UNSUPPORTED_DEPENDENCY',
        BUILD_FAILED: 'MARKDOWN_INVALID',
        MARKDOWN_INVALID: 'MARKDOWN_INVALID',
        TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
        COURSE_TOO_LARGE: 'COURSE_TOO_LARGE',
        ABORTED: 'ABORTED'
      };
      const message = typeof value?.message === 'string' ? value.message : '';
      const loadingCode: LearningGenerationErrorCode = /version|schnittstelle|katalog/i.test(message)
        ? 'CATALOG_INVALID'
        : 'CATALOG_UNAVAILABLE';
      let code = mapping[causeCode] || (options.signal?.aborted
        ? 'ABORTED'
        : runtimeLoaded ? 'GENERATION_FAILED' : loadingCode);
      if (causeCode === 'BUILD_FAILED' &&
          /unterschiedlich|vorlage|template|import|definition|abhängigkeit/i.test(message)) {
        code = 'UNSUPPORTED_DEPENDENCY';
      }
      const matchingTaskCount = typeof value?.matchingTaskCount === 'number'
        ? value.matchingTaskCount
        : typeof value?.details?.matchingTaskCount === 'number'
          ? value.details.matchingTaskCount
          : typeof value?.details?.available === 'number'
            ? value.details.available
            : undefined;
      throw new LearningGenerationError(
        code,
        message
          ? message
          : 'Der Lernpfad-Kurs konnte nicht erzeugt werden.',
        {
          causeCode: causeCode || undefined,
          matchingTaskCount,
          requiredTaskCount: code === 'INSUFFICIENT_TASKS' ? 4 : undefined,
          topic: recommendation.topic,
          targetLevel: recommendation.targetLevel ?? undefined
        }
      );
    }
    checkAbort(options.signal);

    const refreshed = await revalidate(dependencies, courseUrl, recommendation, options.signal);
    if (!sameThemeContext(validated.contextThemes, refreshed.contextThemes)) {
      fail('STALE_RECOMMENDATION', 'Der belegte Lernkontext hat sich geändert. Bitte Empfehlungen neu erstellen.', {
        topic: recommendation.topic,
        targetLevel: recommendation.targetLevel ?? undefined
      });
    }
    const result: GeneratedLearningCourse = {
      sourceCourseUrl: courseUrl,
      type: current.type,
      topic: recommendation.topic,
      targetLevel: current.targetLevel,
      taskCount: 4,
      taskIds: output.tasks.map(task => task.id),
      markdown: output.source,
      openingTarget,
      catalogVersion
    };
    return copy(result);
  };
}
