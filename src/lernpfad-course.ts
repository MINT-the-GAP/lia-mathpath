import { parseAssignmentDetails } from './adetails';
import type {
  LearningContextSource, LearningCourse, LearningCourseContext, LearningLevel,
  LearningSchoolType, LearningTask
} from './lernpfad-types';

type NativeTable = 'quiz' | 'survey';
type SourceLine = { text: string; line: number; dynamic?: boolean; nativeTable?: NativeTable };
type Section = { index: number; lines: SourceLine[]; level: LearningLevel | null; unsafe: boolean };
type MacroCall = { name: string; args: string | null; start: number; end: number };
type Fence = {
  character: string;
  length: number;
  ascii: boolean;
  sourceLine: number;
  nativeTables: Set<NativeTable>;
};

// These public macros each expand to one native quiz in the inspected Freeze
// declaration parser. Unknown expansions are never assigned guessed native IDs.
const QUIZ_MACROS = new Set((
  'orthography orthographytext rectQuiz rectQuizC circleQuiz circleQuizC liaQuiz liaQuizC ' +
  'TextmarkerQuiz Kachelfolge KachelfolgeN CreatePoint ErzeugePunkt PointOnGraph PunktGraph ' +
  'PointsOnGraph PunkteAufGraph Rekonstruktion Reconstruction PerimeterQuiz UmfangQuiz ' +
  'AreaQuiz FlaecheQuiz ConstructionQuiz KonstruktionQuiz KoordQuiz GeometrieQuiz ' +
  'CoordinateQuiz GeometryQuiz'
).toLowerCase().split(' '));
const NON_QUIZ_MACROS = new Set([
  'adetails', 'explain', 'tooltip', 'lernpfad', 'resetter', 'abgabe', 'auswertung',
  'input', 'output', 'uid', 'canvas', 'algebrite.check', 'algebrite.check_expression'
]);
const CONTEXT_SOURCES: LearningContextSource[] = ['header-tags', 'comment', 'title', 'url'];

function emptyCourseContext(): LearningCourseContext {
  return { grade: null, gradeSource: null, schoolType: null, schoolTypeSource: null, headerTags: [] };
}

function headerFieldParts(lines: string[], fieldName: string): string[] {
  const parts: string[] = [];
  let active = false;
  for (const raw of lines) {
    const line = raw.replace(/^\s*<!--\s?/, '').replace(/\s*-->\s*$/, '');
    const field = line.match(/^\s*([a-z][\w-]*):\s*(.*?)\s*$/i);
    if (field) {
      active = field[1].toLowerCase() === fieldName.toLowerCase();
      if (active && field[2] && !/^[>|][+-]?$/.test(field[2])) parts.push(field[2]);
      continue;
    }
    if (active && /^\s+\S/.test(line)) {
      const continuation = line.trim().replace(/^-\s*/, '');
      if (continuation) parts.push(continuation);
    } else if (line.trim()) active = false;
  }
  return parts;
}

function splitHeaderTagList(value: string): string[] {
  const source = value.trim().replace(/^\[([\s\S]*)\]$/, '$1');
  const values: string[] = [];
  let start = 0;
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') { index++; continue; }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if ((character === '`' || character === '"' || character === "'") &&
        source.slice(start, index).trim() === '') {
      quote = character;
    } else if (character === ',' || character === ';') {
      values.push(source.slice(start, index));
      start = index + 1;
    }
  }
  values.push(source.slice(start));
  return values;
}

function parseHeaderTags(parts: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const raw of splitHeaderTagList(part)) {
      const tag = raw.trim().replace(/^([`'"])([\s\S]*)\1$/, '$2').trim();
      const identity = tag.normalize('NFC').toLocaleLowerCase('de');
      if (!tag || seen.has(identity)) continue;
      seen.add(identity);
      tags.push(tag);
    }
  }
  return tags;
}

function decodedEvidence(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function validGrade(value: string): number | null {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 1 && grade <= 13 ? grade : null;
}

function gradesFromText(value: string): number[] {
  const grades = new Set<number>();
  const label = '(?:klasse(?:n|nstufe)?|jahrgang(?:sstufe|stufe)?|jg\\.?|kl\\.?)';
  const expressions = [
    new RegExp('\\b' + label + '\\s*[:=._-]?\\s*(\\d{1,2})(?:\\s*(?:-|\\u2013|\\u2014|/|bis|und)\\s*(\\d{1,2}))?', 'gi'),
    new RegExp('\\b(\\d{1,2})(?:\\s*(?:-|\\u2013|\\u2014|/|bis|und)\\s*(\\d{1,2}))?\\s*\\.?\\s*' + label + '\\b', 'gi')
  ];
  for (const expression of expressions) {
    let match: RegExpExecArray | null;
    while ((match = expression.exec(value)) !== null) {
      for (const candidate of match.slice(1, 3)) {
        const grade = candidate ? validGrade(candidate) : null;
        if (grade !== null) grades.add(grade);
      }
    }
  }
  return [...grades];
}

function gradesFromUrl(value: string): number[] {
  const decoded = decodedEvidence(value);
  const grades = new Set(gradesFromText(decoded.replace(/[_/]+/g, ' ')));
  const expressions = [
    /(?:^|[\/_-])lia[._-]?(\d{1,2})(?=[._\/-])/gi,
    /\/(\d{1,2})\/(?:mathematik|mathe)(?:\/|$)/gi,
    /\/(?:mathematik|mathe)\/(\d{1,2})(?:\/|$)/gi
  ];
  for (const expression of expressions) {
    let match: RegExpExecArray | null;
    while ((match = expression.exec(decoded)) !== null) {
      const grade = validGrade(match[1]);
      if (grade !== null) grades.add(grade);
    }
  }
  return [...grades];
}

function schoolTypesFromText(value: string): LearningSchoolType[] {
  let normalized = decodedEvidence(value).normalize('NFC').toLocaleLowerCase('de').replace(/[_/]+/g, ' ');
  const schools = new Set<LearningSchoolType>();
  const bgy = /\bberuf\w*\s+gymnasi(?:um|en)\b|\bberufsgymnasi(?:um|en)\b|\bbgy\b/gi;
  if (bgy.test(normalized)) schools.add('bgy');
  normalized = normalized.replace(bgy, ' ');
  if (/\boberschul(?:e|en)\b/i.test(normalized)) schools.add('oberschule');
  if (/\bgymnasi(?:um|en)\b/i.test(normalized)) schools.add('gymnasium');
  return [...schools];
}

function resolveContextValue<T>(
  values: Record<LearningContextSource, T[]>, kind: 'Klassenstufen' | 'Schularten', warnings: string[]
): { value: T | null; source: LearningContextSource | null } {
  const locations: Record<LearningContextSource, string> = {
    'header-tags': 'den Kurskopf-Tags', comment: 'dem Kurskommentar',
    title: 'dem Kurstitel', url: 'der Kurs-URL'
  };
  for (const source of CONTEXT_SOURCES) {
    const candidates = [...new Set(values[source])];
    if (!candidates.length) continue;
    if (candidates.length > 1) {
      warnings.push(`In ${locations[source]} sind mehrere ${kind} angegeben; der entsprechende Kurskontext bleibt unbekannt.`);
      return { value: null, source: null };
    }
    return { value: candidates[0], source };
  }
  return { value: null, source: null };
}

function inferCourseContext(
  headerTags: string[], comment: string | null, title: string | null, url: string, warnings: string[]
): LearningCourseContext {
  const evidence: Record<LearningContextSource, string> = {
    'header-tags': headerTags.join('\n'), comment: comment || '', title: title || '', url
  };
  const gradeValues = {} as Record<LearningContextSource, number[]>;
  const schoolValues = {} as Record<LearningContextSource, LearningSchoolType[]>;
  for (const source of CONTEXT_SOURCES) {
    gradeValues[source] = source === 'url' ? gradesFromUrl(evidence[source]) : gradesFromText(evidence[source]);
    schoolValues[source] = schoolTypesFromText(evidence[source]);
  }
  const grade = resolveContextValue(gradeValues, 'Klassenstufen', warnings);
  const school = resolveContextValue(schoolValues, 'Schularten', warnings);
  return {
    grade: grade.value, gradeSource: grade.source,
    schoolType: school.value, schoolTypeSource: school.source,
    headerTags: [...headerTags]
  };
}

function parseLevel(value: string): LearningLevel | null {
  const normalized = value.trim().toLowerCase();
  return normalized === 'einsteiger' ? 'Einsteiger' :
    normalized === 'fortgeschritten' ? 'Fortgeschritten' :
    normalized === 'experte' ? 'Experte' : null;
}

/** Protect authored inline code while allowing backticks inside macro arguments. */
function scanMacros(line: string): MacroCall[] {
  const calls: MacroCall[] = [];
  for (let pos = 0; pos < line.length;) {
    if (line[pos] === '\\') { pos += 2; continue; }
    if (line[pos] === '`') {
      const length = line.slice(pos).match(/^`+/)![0].length;
      const end = line.indexOf('`'.repeat(length), pos + length);
      pos = end < 0 ? line.length : end + length;
      continue;
    }
    const match = line.slice(pos).match(/^@([a-z][\w.-]*)\b/i);
    if (!match || (pos > 0 && (line[pos - 1] === '@' || /[\w]/.test(line[pos - 1])))) { pos++; continue; }
    const start = pos;
    pos += match[0].length;
    let opening = pos;
    while (/\s/.test(line[opening] || '') && opening < line.length) opening++;
    if (line[opening] !== '(') {
      calls.push({ name: match[1].toLowerCase(), args: null, start, end: pos });
      continue;
    }
    let depth = 1;
    let ticks = '';
    let cursor = opening + 1;
    for (; cursor < line.length; cursor++) {
      const character = line[cursor];
      if (character === '\\') { cursor++; continue; }
      if (character === '`') {
        const run = line.slice(cursor).match(/^`+/)![0];
        if (!ticks) ticks = run;
        else if (ticks === run) ticks = '';
        cursor += run.length - 1;
      } else if (!ticks) {
        if (character === '(') depth++;
        if (character === ')' && --depth === 0) break;
      }
    }
    if (cursor >= line.length) {
      calls.push({ name: match[1].toLowerCase(), args: null, start, end: line.length });
      break;
    }
    calls.push({ name: match[1].toLowerCase(), args: line.slice(opening + 1, cursor), start, end: cursor + 1 });
    pos = cursor + 1;
  }
  return calls;
}

function unwrapArguments(raw: string): string {
  const args: string[] = [];
  let start = 0;
  let ticks = '';
  for (let pos = 0; pos < raw.length; pos++) {
    if (raw[pos] === '\\') { pos++; continue; }
    if (raw[pos] === '`') {
      const run = raw.slice(pos).match(/^`+/)![0];
      if (!ticks) ticks = run;
      else if (ticks === run) ticks = '';
      pos += run.length - 1;
    } else if (raw[pos] === ',' && !ticks) {
      args.push(raw.slice(start, pos));
      start = pos + 1;
    }
  }
  args.push(raw.slice(start));
  return args.map(value => value.trim().replace(/^(`+)([\s\S]*)\1$/, '$2')).join(',');
}

function outsideInlineCode(line: string): string {
  return line.replace(/(`+)[\s\S]*?\1/g, '').replace(/\\[\[\]@]/g, '');
}

/** LiaScript embeds authored elements into ASCII art only inside double quotes. */
function quotedAsciiContent(line: string): string[] {
  const content: string[] = [];
  const quoted = /"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(line)) !== null) content.push(match[1]);
  return content;
}

function nativeTablesIn(value: string): Set<NativeTable> {
  const visible = outsideInlineCode(value).replace(/\[\[\?\]\]/g, '');
  const tables = new Set<NativeTable>();
  if (/\[\[\s*_{2,}/.test(visible)) tables.add('survey');
  const withoutSurveys = visible.replace(/\[\[\s*_{2,}[\s\S]*?\]\]/g, '');
  if (/\[\[|\[\(|\[->\[/.test(withoutSurveys)) tables.add('quiz');
  return tables;
}

function isAsciiFence(run: string, info: string): boolean {
  const language = info.trim().match(/^([^\s]+)/)?.[1].toLowerCase() || '';
  return language === 'ascii' || language === 'art' ||
    (!language && run[0] === '`' && run.length >= 9);
}

/**
 * Read authored declarations only. This is intentionally not a second LiaScript
 * interpreter: unsupported expansion makes that section's native mapping unsafe.
 */
export function parseLearningCourse(markdown: string, url: string): LearningCourse {
  const course: LearningCourse = {
    url, version: null, context: emptyCourseContext(), tasks: [], warnings: [], sendMode: false
  };
  const lines = String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let bodyStart = 0;
  let courseLevel: LearningLevel | null = null;
  const headerLines: string[] = [];
  let headerTags: string[] = [];
  let headerComment: string | null = null;
  const first = lines.findIndex(line => line.trim() !== '');
  if (first >= 0 && /^\s*<!--/.test(lines[first])) {
    let macro = false;
    let closed = false;
    for (let index = first; index < lines.length; index++) {
      const line = lines[index];
      if (macro && /^\s*@end\s*$/.test(line)) macro = false;
      else if (!macro && /^\s*@[a-z_][\w.-]*\s*$/i.test(line) && !/^\s*@end/.test(line)) macro = true;
      if (!macro) {
        headerLines.push(line);
        const version = line.match(/^\s*version:\s*(.*?)\s*$/i);
        if (version) course.version = version[1] || null;
        const level = line.match(/^\s*lernpfad-level:\s*(.*?)\s*$/i);
        if (level) {
          courseLevel = parseLevel(level[1]);
          if (!courseLevel) course.warnings.push('Das angegebene Kursniveau ist nicht Einsteiger, Fortgeschritten oder Experte.');
        }
        if (line.includes('-->')) { bodyStart = index + 1; closed = true; break; }
      }
    }
    headerTags = parseHeaderTags(headerFieldParts(headerLines, 'tags'));
    headerComment = headerFieldParts(headerLines, 'comment').join(' ').trim() || null;
    if (!closed) {
      course.warnings.push('Der Kurskopf ist nicht vollständig geschlossen; Aufgaben können nicht zugeordnet werden.');
      course.context = inferCourseContext(headerTags, headerComment, null, url, course.warnings);
      return course;
    }
  }

  const sections: Section[] = [];
  let current: Section | null = null;
  let fence: Fence | null = null;
  let comment = false;
  let script = false;
  let courseTitle: string | null = null;
  function markUnsafe(sourceLine: number): void {
    if (!current) return;
    current.unsafe = true;
    current.lines.push({ text: '', line: sourceLine, dynamic: true });
  }

  for (let index = bodyStart; index < lines.length; index++) {
    let line = lines[index];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch && !script && !comment) {
      const run = fenceMatch[1];
      if (!fence) {
        const info = line.slice(fenceMatch[0].length);
        fence = {
          character: run[0], length: run.length, ascii: isAsciiFence(run, info),
          sourceLine: index + 1, nativeTables: new Set<NativeTable>()
        };
        if (/@[a-z]/i.test(info)) markUnsafe(index + 1);
      } else if (run[0] === fence.character && run.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) {
        const closed = fence;
        fence = null;
        if (closed.ascii && closed.nativeTables.size > 0) {
          if (closed.nativeTables.size === 1 && current) {
            current.lines.push({
              text: '', line: closed.sourceLine,
              nativeTable: closed.nativeTables.values().next().value as NativeTable
            });
          } else markUnsafe(closed.sourceLine);
        }
      }
      continue;
    }
    if (fence) {
      if (fence.ascii) {
        for (const content of quotedAsciiContent(line)) {
          for (const table of nativeTablesIn(content)) fence.nativeTables.add(table);
        }
      }
      continue;
    }
    if (!script && !comment) {
      const level = line.match(/^\s*<!--\s*lernpfad-level:\s*([^<>]*?)\s*-->\s*$/i);
      if (level) {
        if (current) {
          current.level = parseLevel(level[1]);
          if (!current.level) course.warnings.push('Das Niveau auf Folie ' + (current.index + 1) + ' ist nicht eindeutig angegeben.');
        }
        continue;
      }
    }
    let visible = '';
    while (line) {
      if (script) {
        if (/LIASCRIPT:|send\.liascript\s*\(/i.test(line)) markUnsafe(index + 1);
        const end = line.search(/<\/script\s*>/i);
        if (end < 0) { line = ''; break; }
        line = line.slice(end).replace(/^<\/script\s*>/i, '');
        script = false;
        continue;
      }
      if (comment) {
        const end = line.indexOf('-->');
        if (end < 0) { line = ''; break; }
        line = line.slice(end + 3);
        comment = false;
        continue;
      }
      const startComment = line.indexOf('<!--');
      const startScript = line.search(/<script\b[^>]*>/i);
      if (startComment < 0 && startScript < 0) { visible += line; break; }
      if (startComment >= 0 && (startScript < 0 || startComment < startScript)) {
        visible += line.slice(0, startComment);
        line = line.slice(startComment + 4);
        comment = true;
      } else {
        visible += line.slice(0, startScript);
        line = line.slice(startScript).replace(/^<script\b[^>]*>/i, '');
        script = true;
      }
    }
    const heading = visible.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (courseTitle === null) courseTitle = heading[1].trim() || null;
      current = { index: sections.length, lines: [], level: courseLevel, unsafe: false };
      sections.push(current);
    } else if (current) current.lines.push({ text: visible, line: index + 1 });
  }
  if (fence?.ascii && fence.nativeTables.size > 0) markUnsafe(fence.sourceLine);

  for (const section of sections) {
    const tasks: LearningTask[] = [];
    let quizIndex = 0;
    let surveyIndex = 0;
    let priorKind: 'native' | 'choice' | 'diktat' | null = null;
    let lastHasDetails = false;
    let pendingUnknown = false;
    function addTask(table: LearningTask['table'], sourceLine: number): LearningTask {
      const taskIndex = tasks.length;
      const task: LearningTask = {
        id: url + '::#' + (section.index + 1) + '::task::' + taskIndex,
        hash: '#' + (section.index + 1), sectionIndex: section.index, taskIndex,
        nativeIndex: table === 'quiz' ? quizIndex++ : table === 'survey' ? surveyIndex++ : null,
        table, tags: [], points: null, level: section.level,
        mappingSafe: table !== null, sourceLine
      };
      tasks.push(task);
      lastHasDetails = false;
      pendingUnknown = false;
      return task;
    }
    for (const entry of section.lines) {
      if (entry.dynamic) pendingUnknown = true;
      if (entry.nativeTable) {
        addTask(entry.nativeTable, entry.line);
        priorKind = null;
        continue;
      }
      const calls = scanMacros(entry.text);
      for (const call of calls) {
        if (call.name === 'auswertung' && call.args && /(?:^|[;,\s])send(?:$|[;,\s])/i.test(unwrapArguments(call.args))) course.sendMode = true;
        if (!QUIZ_MACROS.has(call.name) && !NON_QUIZ_MACROS.has(call.name) && call.name !== 'diktat') {
          section.unsafe = true;
          pendingUnknown = true;
        }
      }
      const details = calls.filter(call => call.name === 'adetails');
      let visible = entry.text;
      for (const call of [...calls].reverse()) visible = visible.slice(0, call.start) + ' '.repeat(call.end - call.start) + visible.slice(call.end);
      visible = outsideInlineCode(visible).trim();
      const hint = /^\[\[\?\]\]/.test(visible);
      const quizMacros = calls.filter(call => QUIZ_MACROS.has(call.name));
      const diktat = calls.some(call => call.name === 'diktat');
      const choice = /^(?:-\s*)?\[(?:\[\s*[xX ]?\s*\]|\(\s*[xX ]?\s*\))\]/.test(visible);
      const survey = /\[\[\s*_{2,}/.test(visible);
      const native = !hint && (/\[\[/.test(visible) || /\[\(/.test(visible) || /\[->\[/.test(visible));
      if (quizMacros.length) {
        quizMacros.forEach(() => addTask('quiz', entry.line));
        priorKind = null;
      } else if (diktat) {
        if (priorKind !== 'diktat') addTask('quiz', entry.line);
        priorKind = 'diktat';
      } else if (choice) {
        if (priorKind !== 'choice') addTask('quiz', entry.line);
        priorKind = 'choice';
      } else if (survey) {
        addTask('survey', entry.line);
        priorKind = null;
      } else if (native) {
        if (priorKind !== 'native') addTask('quiz', entry.line);
        priorKind = 'native';
      } else if (!hint) priorKind = null;
      for (const detail of details) {
        let task = tasks[tasks.length - 1];
        if (!task || lastHasDetails || pendingUnknown) { task = addTask(null, entry.line); section.unsafe = true; }
        if (detail.args === null) { task.mappingSafe = false; section.unsafe = true; continue; }
        const parsed = parseAssignmentDetails(unwrapArguments(detail.args));
        task.tags = [...new Set([...task.tags, ...parsed.tags])];
        if (task.points === null) task.points = parsed.pointsValue;
        lastHasDetails = true;
      }
    }
    if (section.unsafe) {
      tasks.forEach(task => { task.mappingSafe = false; task.nativeIndex = null; });
      course.warnings.push('Folie ' + (section.index + 1) + ' enthält nicht sicher zuordenbare Makros oder dynamische Aufgaben; ihr Lernstand bleibt unbekannt.');
    }
    course.tasks.push(...tasks);
  }
  course.context = inferCourseContext(headerTags, headerComment, courseTitle, url, course.warnings);
  if (!sections.length && markdown.trim()) course.warnings.push('Im Kurstext wurden keine verlässlich zuordenbaren Folienüberschriften gefunden.');
  return course;
}
