/** Runtime boundary to the shared Aufgabensammlung catalog and generator. */

export interface SharedCatalogTask {
  id: string;
  url: string;
  title: string;
  tags: string[];
  topics: string[];
  difficulty: number | null;
  network: number | null;
  operator: string | null;
}

export interface SharedCourseCatalog {
  schema: 'schullia-course-catalog';
  version: 1;
  curriculum?: SharedCurriculumCatalog;
  tasks: SharedCatalogTask[];
}

export interface SharedCurriculumCatalog {
  schema: 'schullia-sachsen-curriculum';
  version: 1;
  jurisdiction: string;
  source: string;
  themes: Record<string, Record<string, Record<string, string[]>>>;
  classRanges: Record<string, Record<string, { startGrade: number; endGrade: number }>>;
}

export type SharedSchoolType = 'oberschule' | 'gymnasium' | 'bgy';

export interface SharedCurriculumContextOptions {
  observedThemes: string[];
  grade?: number | null;
  schoolType?: SharedSchoolType | null;
}

export interface SharedCurriculumContext {
  observedThemes: string[];
  priorThemes: string[];
  allowedThemes: string[];
  curriculumThemes: string[];
  grade: number | null;
  gradeSource: 'explicit' | 'themes' | 'unavailable';
  schoolType: SharedSchoolType | null;
  unmappedObservedThemes: string[];
  gradeConflicts: string[];
}

export interface SharedGeneratorTask extends SharedCatalogTask {}

export interface SharedGeneratorRequest {
  themes: string[];
  /** `distributed` means OR filtering plus at least one separate task per theme. */
  themeMode?: 'all' | 'distributed';
  blockedThemes: string[];
  /** Topics already evidenced by @ADetails in the source course. */
  allowedThemes?: string[];
  /** Complete topic vocabulary used to reject unseen curricular co-topics. */
  curriculumThemes?: string[];
  count: number;
  group: 'einsteiger' | 'fortgeschrittene' | 'experten';
  strictCount: boolean;
  seed?: string | number;
  random?: () => number;
}

export interface SharedCourseDocument {
  url: string;
  content: string;
}

export interface SharedGeneration {
  tasks: SharedGeneratorTask[];
  documents: SharedCourseDocument[];
  source: string;
}

export interface SharedLearningPathManifest {
  v: 1;
  kind: 'lernpfad';
  offer: 'schwaechen-ueben' | 'weitere-uebungen' | 'vertiefungen';
  topic: string;
  secondaryTopics?: string[];
  level: 'einsteiger' | 'fortgeschrittene' | 'experten';
  grade?: number;
  schoolType?: SharedSchoolType;
  urls: string[];
}

export interface SharedCourseSource {
  build(documents: SharedCourseDocument[], options?: Record<string, unknown>): string;
}

export interface SharedCourseGenerator {
  schema: 'schullia-course-generator';
  version: 1;
  release: string;
  profiles: Record<string, unknown>;
  validateCatalog(catalog: unknown): SharedCourseCatalog;
  deriveCurriculumContext(
    catalog: SharedCourseCatalog,
    options: SharedCurriculumContextOptions
  ): SharedCurriculumContext;
  generate(
    catalog: SharedCourseCatalog,
    request: SharedGeneratorRequest,
    options?: Record<string, unknown>
  ): Promise<SharedGeneration>;
  learningPathSourceOptions(manifest: SharedLearningPathManifest): Record<string, unknown>;
  buildDirectCourseUrl(base: string, manifest: SharedLearningPathManifest): string;
  createSeededRandom(seed: string | number): () => number;
}

export interface SharedCourseRuntime {
  catalog: SharedCourseCatalog;
  generator: SharedCourseGenerator;
  assembler: SharedCourseSource;
  baseUrl: string;
}

type RuntimeWindow = Window & typeof globalThis & {
  SchulLiaCourseCatalog?: unknown;
  SchulLiaCourseGenerator?: unknown;
  SchulLiaCourseSource?: unknown;
};

export const SHARED_COURSE_BASE_URL = 'https://mint-the-gap.github.io/Aufgabensammlung/';
export const SHARED_COURSE_RELEASE = '1.0.10';
const LOAD_TIMEOUT_MS = 20_000;
const loads = new WeakMap<Document, Promise<SharedCourseRuntime>>();

function releasedAssetUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set('v', SHARED_COURSE_RELEASE);
  return url.href;
}

function runtimeWindow(doc: Document): RuntimeWindow {
  const win = doc.defaultView;
  if (!win) throw new Error('Der gemeinsame Kursgenerator benötigt ein Browserfenster.');
  return win as RuntimeWindow;
}

function compatibleGenerator(value: unknown): boolean {
  const generator = value as Partial<SharedCourseGenerator> | undefined;
  return Boolean(generator && generator.schema === 'schullia-course-generator' &&
    generator.version === 1 && generator.release === SHARED_COURSE_RELEASE &&
    typeof generator.validateCatalog === 'function' &&
    typeof generator.deriveCurriculumContext === 'function' &&
    typeof generator.generate === 'function');
}

function compatibleCatalog(value: unknown): boolean {
  const catalog = value as Partial<SharedCourseCatalog> | undefined;
  return Boolean(catalog && catalog.schema === 'schullia-course-catalog' &&
    catalog.version === 1 && Array.isArray(catalog.tasks) &&
    catalog.curriculum?.schema === 'schullia-sachsen-curriculum' &&
    catalog.curriculum.version === 1 && catalog.curriculum.jurisdiction === 'DE-SN');
}

function loadClassicScript(
  doc: Document,
  url: string,
  ready: () => boolean
): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = Array.from(doc.querySelectorAll('script[data-lia-mathpath-runtime]'))
      .find(node => (node as HTMLScriptElement).dataset.liaMathpathRuntime === url) as HTMLScriptElement | undefined;
    const owned = !script;
    if (!script) {
      script = doc.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.liaMathpathRuntime = url;
    }
    let done = false;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script!.removeEventListener('load', loaded);
      script!.removeEventListener('error', failed);
      if (error) {
        if (owned) script!.remove();
        reject(error);
      } else resolve();
    };
    const loaded = (): void => finish(ready() ? undefined :
      new Error('Ein Modul des gemeinsamen Kursgenerators besitzt nicht die erwartete Schnittstelle.'));
    const failed = (): void => finish(new Error('Der gemeinsame Kursgenerator konnte nicht geladen werden.'));
    const timer = setTimeout(() => finish(new Error('Das Laden des gemeinsamen Kursgenerators dauert zu lange.')), LOAD_TIMEOUT_MS);
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (owned) (doc.head || doc.documentElement).append(script);
  });
}

function validateRuntime(win: RuntimeWindow): Omit<SharedCourseRuntime, 'baseUrl'> {
  const assembler = win.SchulLiaCourseSource as Partial<SharedCourseSource> | undefined;
  const generator = win.SchulLiaCourseGenerator as Partial<SharedCourseGenerator> | undefined;
  const catalog = win.SchulLiaCourseCatalog as Partial<SharedCourseCatalog> | undefined;
  if (!assembler || typeof assembler.build !== 'function') {
    throw new Error('Der gemeinsame Kurs-Assembler ist nicht verfügbar.');
  }
  if (!generator || !compatibleGenerator(generator) ||
      typeof generator.validateCatalog !== 'function' || typeof generator.generate !== 'function' ||
      typeof generator.deriveCurriculumContext !== 'function' ||
      typeof generator.learningPathSourceOptions !== 'function' ||
      typeof generator.buildDirectCourseUrl !== 'function') {
    throw new Error('Die Version des gemeinsamen Kursgenerators wird von MathPath nicht unterstützt.');
  }
  if (!catalog || !compatibleCatalog(catalog)) {
    throw new Error('Die Version des Aufgabenkatalogs wird von MathPath nicht unterstützt.');
  }
  const checked = generator.validateCatalog(catalog);
  return {
    assembler: assembler as SharedCourseSource,
    generator: generator as SharedCourseGenerator,
    catalog: checked
  };
}

/** Load once per document; a rejected load is removed so the next click can retry. */
export function loadSharedCourseRuntime(
  doc: Document = document,
  baseUrl = SHARED_COURSE_BASE_URL
): Promise<SharedCourseRuntime> {
  const existing = loads.get(doc);
  if (existing) return existing;
  const normalizedBase = new URL(baseUrl, doc.baseURI).href.replace(/\/?$/, '/');
  const win = runtimeWindow(doc);
  const promise = (async () => {
    await loadClassicScript(doc, releasedAssetUrl(normalizedBase, 'assets/course-source.js'),
      () => win.SchulLiaCourseSource !== undefined);
    await loadClassicScript(doc, releasedAssetUrl(normalizedBase, 'assets/course-generator.js'),
      () => compatibleGenerator(win.SchulLiaCourseGenerator));
    await loadClassicScript(doc, releasedAssetUrl(normalizedBase, 'assets/course-catalog.js'),
      () => compatibleCatalog(win.SchulLiaCourseCatalog));
    return { ...validateRuntime(win), baseUrl: normalizedBase };
  })();
  loads.set(doc, promise);
  void promise.catch(() => { if (loads.get(doc) === promise) loads.delete(doc); });
  return promise;
}
