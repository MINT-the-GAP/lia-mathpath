import type { LearningCourse, LearningStateSnapshot, LearningTask, LearningTaskState } from './lernpfad-types';
import {
  decodeLiaScriptGzipDataCourse,
  isLiaScriptGzipDataCourseUri,
} from './course-data-uri.js';

type Row = { id: unknown; version: unknown; data: unknown; created?: unknown };
type NativeTables = { quiz: Row[]; survey: Row[] };
type FreezeReader = { read(): unknown };
type RuntimeWindow = Window & typeof globalThis & {
  __liaFreezeLearningStateV1__?: FreezeReader;
  __liaFreezeV2LifecycleV1__?: unknown;
  __liaSubmissionDemo?: unknown;
};
const EMPTY: NativeTables = { quiz: [], survey: [] };
const TIMEOUT = 2000;
const NO_NATIVE_RECORD = Symbol('no-native-record');

function isNativeCourseIdentity(value: string): boolean {
  if (/^https?:\/\//i.test(value) || /^parent:schullia-[a-z0-9][a-z0-9-]{7,159}$/i.test(value)) return true;
  return isLiaScriptGzipDataCourseUri(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable(task: LearningTask, reason: string): LearningTaskState {
  return { taskId: task.id, status: 'unavailable', source: 'none', reason };
}

/** score is not a correctness measure: LiaScript also stores score:1 on failure. */
export function classifyNativeLearningState(task: LearningTask, raw: unknown, source = 'indexeddb'): LearningTaskState {
  if (!record(raw) || ![-1, 0, 1].includes(raw.solved as number) ||
      typeof raw.trial !== 'number' || !Number.isFinite(raw.trial) || raw.trial < 0) {
    return unavailable(task, 'Für diese Aufgabe liegt kein lesbarer Bearbeitungsstand vor.');
  }
  const base = { taskId: task.id, source };
  if (raw.solved === 1) return { ...base, status: 'correct', reason: 'Die letzte Prüfung war richtig.' };
  if (raw.solved === -1) return { ...base, status: 'unavailable', reason: 'Die Lösung wurde aufgedeckt; eine eigene richtige Antwort ist nicht belegt.' };
  if (raw.trial > 0) return { ...base, status: 'wrong', reason: 'Die aktuelle Antwort wurde noch nicht richtig geprüft.' };
  // A real zero-attempt record is evidence; missing records are handled by the
  // course-level "not completed" policy in projectLearningState.
  return { ...base, status: 'unanswered', reason: 'Es ist noch keine Prüfung gespeichert.' };
}

function manualState(task: LearningTask, value: unknown): LearningTaskState | null {
  if (task.points === null || task.points <= 0 || !['number', 'string'].includes(typeof value)) return null;
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > task.points) return null;
  return { taskId: task.id, source: 'freeze-manual', earnedPoints: parsed,
    maximumPoints: task.points, status: parsed === task.points ? 'correct' : parsed === 0 ? 'wrong' : 'partial',
    reason: 'Die aktuelle manuelle Punktekorrektur wurde übernommen.' };
}

/** LiaScript uses the major course version for its stored exercise records. */
export function nativeCourseVersion(version: string | null): number | null {
  if (!version || !/^\d+(?:\.\d+){0,2}$/.test(version.trim())) return null;
  return Number(version.split('.')[0]);
}

function nativeElement(task: LearningTask, course: LearningCourse, rows: Row[]): unknown {
  const version = nativeCourseVersion(course.version);
  if (version === null || task.nativeIndex === null) return undefined;
  const matches = rows.filter(row => row.id === task.sectionIndex && row.version === version);
  if (!matches.length) return NO_NATIVE_RECORD;
  matches.sort((a, b) => Number(b.created || 0) - Number(a.created || 0));
  const data = matches[0]?.data;
  const expected = course.tasks.filter(other => other.sectionIndex === task.sectionIndex && other.table === task.table).length;
  if (!Array.isArray(data) || data.length !== expected) return undefined;
  return data[task.nativeIndex];
}

function frozenElement(task: LearningTask, payload: unknown): unknown {
  if (!record(payload) || !Array.isArray(payload.s) || task.nativeIndex === null) return undefined;
  let result: unknown;
  for (const slide of payload.s) {
    if (!record(slide)) continue;
    for (const table of [slide.quiz, slide.quizEval]) {
      if (!record(table)) continue;
      const elements = table[String(task.sectionIndex)];
      if (Array.isArray(elements) && elements[task.nativeIndex] !== undefined) result = elements[task.nativeIndex];
    }
  }
  return result;
}

function validIdentity(course: LearningCourse, bridge: Record<string, unknown>): boolean {
  return bridge.version === 1 && bridge.courseUrl === course.url &&
    typeof bridge.courseVersion === 'string' && bridge.courseVersion === course.version;
}

/** Pure projection used by UI and tests. Missing compatible records are the
 * explicit "not completed" case; malformed or ambiguous records stay unavailable. */
export function projectLearningState(
  course: LearningCourse,
  tables: NativeTables,
  bridge: unknown = null,
  freezePresent = false,
): LearningStateSnapshot {
  const warnings: string[] = [];
  let phase: LearningStateSnapshot['phase'] = 'live';
  if (record(bridge) && validIdentity(course, bridge)) {
    phase = ['live', 'collect', 'grading', 'review', 'unavailable'].includes(String(bridge.phase))
      ? bridge.phase as LearningStateSnapshot['phase'] : 'unavailable';
  } else if (freezePresent) {
    phase = 'unavailable';
    warnings.push('Freeze stellt für diesen Kurs noch keinen passenden freigegebenen Lernstand bereit.');
  } else if (course.sendMode) {
    phase = 'collect';
  }
  if (phase === 'collect' || phase === 'grading' || phase === 'unavailable') {
    const reason = phase === 'collect' || phase === 'grading'
      ? 'Ergebnisse werden erst nach der vorgesehenen Send-Auswertung freigegeben.'
      : 'Der Lernstand ist derzeit nicht zuverlässig verfügbar.';
    warnings.push(reason);
    return { phase, warnings, states: course.tasks.map(task => unavailable(task, reason)) };
  }
  if (course.version === null) warnings.push('Ohne Kursversion können gespeicherte Antworten nicht sicher zugeordnet werden.');
  const states = course.tasks.map(task => {
    if (!task.mappingSafe || task.nativeIndex === null || task.table === null) {
      return unavailable(task, 'Die Aufgabe kann keinem eindeutigen nativen Bearbeitungsstand zugeordnet werden.');
    }
    if (phase === 'review' && record(bridge)) {
      const key = task.hash + '::task::' + (task.taskIndex + 1);
      const award = manualState(task, record(bridge.manualAwards) ? bridge.manualAwards[key] : undefined);
      if (award) return award;
      if (task.table === 'survey') return unavailable(task, 'Für die offene Antwort liegt keine manuelle Bewertung vor.');
      return classifyNativeLearningState(task, frozenElement(task, bridge.payload), 'freeze-snapshot');
    }
    if (task.table === 'survey') return unavailable(task, 'Für die offene Antwort liegt keine automatische Bewertung vor.');
    const element = nativeElement(task, course, tables.quiz);
    if (element === NO_NATIVE_RECORD) {
      return { taskId: task.id, status: 'unanswered' as const, source: 'indexeddb',
        reason: 'Für diese Aufgabe ist noch keine Prüfung gespeichert.' };
    }
    return classifyNativeLearningState(task, element);
  });
  return { phase, warnings, states };
}

/** Exact URL only: never read a different course with the same filename. */
export async function readNativeLearningTables(courseUrl: string, factory?: IDBFactory): Promise<NativeTables> {
  if (!factory || !isNativeCourseIdentity(courseUrl)) return EMPTY;
  if (isLiaScriptGzipDataCourseUri(courseUrl)) {
    try { decodeLiaScriptGzipDataCourse(courseUrl); }
    catch { return EMPTY; }
  }
  return new Promise(resolve => {
    let db: IDBDatabase | undefined;
    let finished = false;
    const finish = (tables: NativeTables): void => {
      if (finished) { db?.close(); return; }
      finished = true;
      clearTimeout(timer);
      db?.close();
      resolve(tables);
    };
    const timer = setTimeout(() => finish(EMPTY), TIMEOUT);
    try {
      const request = factory.open(courseUrl);
      request.onupgradeneeded = () => { request.transaction?.abort(); finish(EMPTY); };
      request.onerror = request.onblocked = () => finish(EMPTY);
      request.onsuccess = () => {
        db = request.result;
        if (finished) { db.close(); return; }
        const names = ['quiz', 'survey'].filter(name => db!.objectStoreNames.contains(name));
        if (!names.length) { finish(EMPTY); return; }
        try {
          const tx = db.transaction(names, 'readonly');
          const tables: NativeTables = { quiz: [], survey: [] };
          for (const name of names) {
            const read = tx.objectStore(name).getAll();
            read.onsuccess = () => { tables[name as keyof NativeTables] = read.result; };
          }
          tx.oncomplete = () => finish(tables);
          tx.onabort = tx.onerror = () => finish(EMPTY);
        } catch { finish(EMPTY); }
      };
    } catch { finish(EMPTY); }
  });
}

function freezeContext(win: RuntimeWindow): { bridge: unknown; present: boolean } {
  const classes = win.document.body?.classList;
  const protectedState = !!(classes?.contains('lia-course-frozen') ||
    classes?.contains('lia-send-collect') || classes?.contains('lia-send-grading') ||
    classes?.contains('lia-send-review'));
  // A Freeze import alone is not a protected result state. Older published
  // variants expose lifecycle/bootstrap globals but no learning-state reader;
  // in an ordinary live course MathPath must still read LiaScript's native
  // readonly state. Frozen and Send phases remain closed without a valid bridge.
  const present = !!win.__liaFreezeLearningStateV1__ || protectedState;
  let bridge: unknown = null;
  try { bridge = win.__liaFreezeLearningStateV1__?.read(); } catch { /* never infer live from a failed bridge */ }
  return { bridge, present };
}

/** Fresh read per click; no observer, event listener, port patch, or state write. */
export async function readLearningState(course: LearningCourse, win: RuntimeWindow = window): Promise<LearningStateSnapshot> {
  const initial = freezeContext(win);
  const gated = projectLearningState(course, EMPTY, initial.bridge, initial.present);
  if (gated.phase !== 'live') return gated;
  let factory: IDBFactory | undefined;
  try { factory = win.indexedDB; } catch { /* browser can deny persistent storage */ }
  const tables = await readNativeLearningTables(course.url, factory);
  // A delayed Freeze bootstrap or Send phase transition may occur while IDB opens.
  const current = freezeContext(win);
  const snapshot = projectLearningState(course, tables, current.bridge, current.present);
  if (!factory && snapshot.phase === 'live') snapshot.warnings.push('Gespeicherte Antworten sind in diesem Browser nicht lesbar.');
  return snapshot;
}
