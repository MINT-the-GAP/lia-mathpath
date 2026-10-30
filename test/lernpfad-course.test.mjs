import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lernpfad-course.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020
} }).outputText.replace("'./adetails'", JSON.stringify(new URL('../src/adetails.ts', import.meta.url).href))
const { parseLearningCourse } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const url = 'https://example.test/course.md'
const parse = lines => parseLearningCourse(Array.isArray(lines) ? lines.join('\n') : lines, url)

test('maps all authored native tasks across slides and retains separate quiz/survey indices', () => {
  const course = parse([
    '<!--', 'version: 2.3.0', 'lernpfad-level: Einsteiger', '-->',
    '# Start', '', '## Aufgaben', '',
    'Zahl: [[ 4 ]] und Einheit: [[ m ]].', '[[?]] @Explain', '',
    '@ADetails(2=BE;Längen, Einheiten)', '',
    '[[___]]', '', '@ADetails(0=BE;Reflexion)', '',
    '[[ 8 ]]', '', '## Weitere Aufgabe', '', '[[ 9 ]]',
    '', '@ADetails(1;Längen)'
  ])
  assert.equal(course.version, '2.3.0')
  assert.equal(course.tasks.length, 4)
  assert.deepEqual(course.tasks.map(task => [task.hash, task.taskIndex, task.nativeIndex, task.table]),
    [['#2', 0, 0, 'quiz'], ['#2', 1, 0, 'survey'], ['#2', 2, 1, 'quiz'], ['#3', 0, 0, 'quiz']])
  assert.deepEqual(course.tasks[0].tags, ['Längen', 'Einheiten'])
  assert.deepEqual(course.tasks.map(task => task.points), [2, 0, null, 1])
  assert.ok(course.tasks.every(task => task.level === 'Einsteiger' && task.mappingSafe))
  assert.equal(new Set(course.tasks.map(task => task.id)).size, 4)
  assert.equal(course.tasks[0].sourceLine, 9)
})

test('preserves ordinary arguments and complete single/double-backtick metadata', () => {
  const course = parse([
    '# Tags', '', '[[ a ]]', '',
    '@ADetails(2=BE;Algebra, Brüche, Transfer)', '',
    '[[ b ]]', '', '@ADetails(`points=1|2,5;tags=Terme (mit Klammern), Einheiten`)', '',
    '[[ c ]]', '', '@ADetails(``0=BE;Null, O\'Brien, A & B``)'
  ])
  assert.deepEqual(course.tasks.map(task => task.tags), [
    ['Algebra', 'Brüche', 'Transfer'], ['Terme (mit Klammern)', 'Einheiten'],
    ['Null', "O'Brien", 'A & B']
  ])
  assert.deepEqual(course.tasks.map(task => task.points), [2, 3.5, 0])
  assert.ok(course.tasks.every(task => task.mappingSafe))
})

test('does not count header definitions, code fences, inline code, comments or script text as quizzes', () => {
  const course = parse([
    '<!--', 'version: 1.0.0', '@Fake', '# Fake heading', '[[ fake ]]', '@ADetails(1;Fake)', '@end', '-->',
    '# Echt', '', '````markdown', '# Beispiel', '[[ demo ]]', '@ADetails(4;Demo)', '```',
    '## Still fenced', '````', '',
    'Beispiel: `[[ demo ]]` und `@ADetails(5;Demo)`.',
    '<!--', '## Invisible', '[[ hidden ]]', '-->', '',
    '<script>', 'const example = "[[ not-a-quiz ]]";', '// # no-slide', '</script>', '',
    '[[ 42 ]]', '', '@ADetails(1;Echt)'
  ])
  assert.equal(course.tasks.length, 1)
  assert.equal(course.tasks[0].hash, '#1')
  assert.deepEqual(course.tasks[0].tags, ['Echt'])
  assert.equal(course.tasks[0].mappingSafe, true)
})

test('maps canvas and grouped ASCII-art tasks without making the generated course unsafe', () => {
  const ordinary = Array.from({ length: 8 }, (_, index) => [
    'Aufgabe ' + (index + 1) + ': [[ ' + (index + 1) + ' ]]', '',
    '@ADetails(1=BE;Grundrechenarten)', ''
  ]).flat()
  const asciiTask = (value, label) => [
    '``` ascii',
    '+---------------------------+',
    '| " [[ ' + value + ' ]] " | " [[ ' + (value + 1) + ' ]] " |',
    '+---------------------------+',
    '```', '[[?]] @Explain', '', '@ADetails(1=BE;' + label + ')', ''
  ]
  const course = parse([
    '# Canvas', '', 'Das Stadion besitzt insgesamt [[ 10800 ]] Sitzplätze. @canvas', '',
    '@ADetails(1=BE;Sachaufgabe, Multiplikation, Grundrechenarten)', '',
    '## Acht native Aufgaben', '', ...ordinary,
    '## ASCII A', '', ...asciiTask(24, 'ASCII-A1'), ...asciiTask(30, 'ASCII-A2'),
    '## ASCII B', '', ...asciiTask(12, 'ASCII-B1'), ...asciiTask(18, 'ASCII-B2')
  ])
  assert.equal(course.tasks.length, 13)
  assert.deepEqual(course.tasks.map(task => task.hash), [
    '#1', '#2', '#2', '#2', '#2', '#2', '#2', '#2', '#2', '#3', '#3', '#4', '#4'
  ])
  assert.deepEqual(course.tasks.map(task => task.nativeIndex), [0, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 0, 1])
  assert.ok(course.tasks.every(task => task.table === 'quiz' && task.mappingSafe))
  assert.deepEqual(course.tasks.slice(-4).map(task => task.tags), [
    ['ASCII-A1'], ['ASCII-A2'], ['ASCII-B1'], ['ASCII-B2']
  ])
  assert.equal(course.warnings.length, 0)
})

test('recognizes official art and nine-backtick ASCII while ignoring code examples and unquoted drawings', () => {
  const course = parse([
    '# ASCII variants', '',
    '~~~ art', '| " [[ 7 ]] " |', '~~~', '', '@ADetails(1;Art)', '',
    '~~~ ART', '| " [[___]] " |', '~~~', '', '@ADetails(0;Survey)', '',
    '`````````', '| " [[ 9 ]] " |', '`````````', '', '@ADetails(1;Nine)', '',
    '``` ascii', '| [[ not quoted ]] |', '```', '',
    '```` markdown', '``` ascii', '| " [[ example ]] " |', '```', '````', '',
    '``` text', '" [[ example ]] "', '```'
  ])
  assert.equal(course.tasks.length, 3)
  assert.deepEqual(course.tasks.map(task => [task.table, task.nativeIndex, task.tags]), [
    ['quiz', 0, ['Art']], ['survey', 0, ['Survey']], ['quiz', 1, ['Nine']]
  ])
  assert.ok(course.tasks.every(task => task.mappingSafe))
  assert.equal(course.warnings.length, 0)
})

test('keeps ambiguous and unclosed ASCII quizzes explicitly unsafe', () => {
  const ambiguous = parse([
    '# Ambiguous', '', '``` ascii', '| " [[ 1 ]] " | " [[___]] " |', '```', '',
    '@ADetails(1;Ambiguous)'
  ])
  assert.equal(ambiguous.tasks.length, 1)
  assert.equal(ambiguous.tasks[0].table, null)
  assert.equal(ambiguous.tasks[0].mappingSafe, false)
  assert.equal(ambiguous.warnings.length, 1)

  const unclosed = parse([
    '# Unclosed', '', '``` ascii', '| " [[ 1 ]] " |'
  ])
  assert.equal(unclosed.tasks.length, 0)
  assert.equal(unclosed.warnings.length, 1)
})

test('marks whole section unsafe for unknown expansions without shifting a later safe section', () => {
  const course = parse([
    '# Dynamic', '', '[[ 2 ]]', '', '@ADetails(1;Known)', '',
    '@UnknownQuiz()', '', '@ADetails(2;Dynamic)',
    '', '## Safe', '', '[[ 3 ]]', '', '@ADetails(1;Safe)'
  ])
  assert.equal(course.tasks.length, 3)
  assert.ok(course.tasks.slice(0, 2).every(task => !task.mappingSafe && task.nativeIndex === null))
  assert.equal(course.tasks[1].table, null)
  assert.deepEqual(course.tasks[1].tags, ['Dynamic'])
  assert.equal(course.tasks[2].mappingSafe, true)
  assert.equal(course.tasks[2].nativeIndex, 0)
  assert.equal(course.warnings.length, 1)
})

test('dynamic script output cannot make a guessed native mapping', () => {
  const course = parse([
    '# Generated', '', '<script>', 'send.lia("LIASCRIPT: [[ 9 ]]")', '</script>',
    '', '@ADetails(3;Generated)', '', '[[ 2 ]]', '', '@ADetails(1;Static)'
  ])
  assert.equal(course.tasks.length, 2)
  assert.ok(course.tasks.every(task => !task.mappingSafe && task.nativeIndex === null))
  assert.deepEqual(course.tasks.map(task => task.tags), [['Generated'], ['Static']])
})

test('metadata after an unknown expansion is not assigned to the previous unannotated quiz', () => {
  for (const expansion of ['@UnknownQuiz()', '<script>send.lia("LIASCRIPT: [[ 9 ]]")</script>']) {
    const course = parse(['# Mixed', '', '[[ 1 ]]', '', expansion, '', '@ADetails(2;Dynamic)'])
    assert.equal(course.tasks.length, 2)
    assert.deepEqual(course.tasks[0].tags, [])
    assert.deepEqual(course.tasks[1].tags, ['Dynamic'])
    assert.equal(course.tasks[1].table, null)
    assert.ok(course.tasks.every(task => !task.mappingSafe))
  }
})

test('known public one-quiz macros count once despite quiz syntax inside their arguments', () => {
  const course = parse([
    '# Imported quizzes', '', '@Kachelfolge(`[->[a]] [->[b]]`)', '', '@ADetails(1;Reihenfolge)', '',
    '@rectQuiz(2,3)', '', '@ADetails(2;Brüche)', '', '@CreatePoint(2,3)', '',
    '@ADetails(1;Punkte)', '', '@resetter', '', '@Lernpfad'
  ])
  assert.equal(course.tasks.length, 3)
  assert.deepEqual(course.tasks.map(task => task.nativeIndex), [0, 1, 2])
  assert.ok(course.tasks.every(task => task.mappingSafe))
})

test('no level or point defaults are invented from ordinary catalog tags', () => {
  const course = parse([
    '<!--', 'tags: leicht, mittel, normal', '-->', '# Catalog', '',
    '[[ 2 ]]', '', '@ADetails(Brüche)', '', '[[___]]', '', '@ADetails(0=BE;Reflexion)'
  ])
  assert.deepEqual(course.tasks.map(task => task.level), [null, null])
  assert.deepEqual(course.tasks.map(task => task.points), [null, 0])
})

test('extracts explicit grade and school context without turning header tags into task topics', () => {
  const course = parseLearningCourse([
    '<!--',
    'tags: Mathematik, Klasse 5, Gymnasium, Addition',
    'comment: Kurs fuer Klasse 6 an der Oberschule.',
    '-->',
    '# Mathematik Klasse 7', '',
    '[[ 4 ]]', '', '@ADetails(1;Addition)'
  ].join('\n'), 'https://example.test/Gymnasium/Lia8_42.md')
  assert.deepEqual(course.context, {
    grade: 5, gradeSource: 'header-tags',
    schoolType: 'gymnasium', schoolTypeSource: 'header-tags',
    headerTags: ['Mathematik', 'Klasse 5', 'Gymnasium', 'Addition']
  })
  assert.deepEqual(course.tasks[0].tags, ['Addition'])
})

test('uses comment, title and known URL shapes only when stronger context evidence is absent', () => {
  const fromComment = parseLearningCourse([
    '<!--', 'tags: Mathematik', 'comment: Uebungen fuer die 6. Klasse der Oberschule.', '-->',
    '# Mathematik Klasse 7 am Gymnasium', '', '[[ 1 ]]'
  ].join('\n'), 'https://example.test/Gymnasium/Lia8_42.md')
  assert.deepEqual(
    [fromComment.context.grade, fromComment.context.gradeSource,
      fromComment.context.schoolType, fromComment.context.schoolTypeSource],
    [6, 'comment', 'oberschule', 'comment']
  )

  const fromTitle = parseLearningCourse(
    '# Mathematik fuer Klasse 7 am Gymnasium\n\n[[ 1 ]]',
    'https://example.test/Oberschule/Lia8_42.md'
  )
  assert.deepEqual(
    [fromTitle.context.grade, fromTitle.context.gradeSource,
      fromTitle.context.schoolType, fromTitle.context.schoolTypeSource],
    [7, 'title', 'gymnasium', 'title']
  )

  const fromUrl = parseLearningCourse(
    '# Mathematik\n\n[[ 1 ]]',
    'https://example.test/Gymnasium/Lia8_42.md'
  )
  assert.deepEqual(
    [fromUrl.context.grade, fromUrl.context.gradeSource,
      fromUrl.context.schoolType, fromUrl.context.schoolTypeSource],
    [8, 'url', 'gymnasium', 'url']
  )
})

test('keeps grade and school unknown when the strongest evidence source conflicts', () => {
  const course = parseLearningCourse([
    '<!--',
    'tags: Mathematik, Klasse 5, Jahrgang 7, Oberschule, Gymnasium',
    'comment: Klasse 6',
    '-->',
    '# Klasse 8', '', '[[ 1 ]]', '', '@ADetails(1;Algebra)'
  ].join('\n'), 'https://example.test/Lia9_42.md')
  assert.equal(course.context.grade, null)
  assert.equal(course.context.gradeSource, null)
  assert.equal(course.context.schoolType, null)
  assert.equal(course.context.schoolTypeSource, null)
  assert.match(course.warnings.join(' '), /mehrere Klassenstufen/)
  assert.match(course.warnings.join(' '), /mehrere Schularten/)
  assert.deepEqual(course.tasks[0].tags, ['Algebra'])
})

test('keeps apostrophes inside tags and recognizes plural school names', () => {
  const course = parseLearningCourse([
    '<!--',
    "tags: Euler'sche Gerade, Klasse 7, Gymnasien",
    '-->',
    '# Kurs', '', '[[ 1 ]]', '', '@ADetails(1;Geometrie)'
  ].join('\n'), 'https://example.test/course.md')
  assert.deepEqual(course.context, {
    grade: 7, gradeSource: 'header-tags',
    schoolType: 'gymnasium', schoolTypeSource: 'header-tags',
    headerTags: ["Euler'sche Gerade", 'Klasse 7', 'Gymnasien']
  })
})

test('section level is explicit and resets to course level at the next heading', () => {
  const course = parse([
    '<!--', 'lernpfad-level: Einsteiger', '-->', '# First', '',
    '<!-- lernpfad-level: Fortgeschritten -->', '', '[[ 1 ]]',
    '', '## Child heading', '', '[[ 2 ]]', '',
    '## Expert', '', '<!-- lernpfad-level: Experte -->', '', '[[ 3 ]]',
    '', '## Unknown', '', '<!-- lernpfad-level: Sehr leicht -->', '', '[[ 4 ]]'
  ])
  assert.deepEqual(course.tasks.map(task => task.level), ['Fortgeschritten', 'Einsteiger', 'Experte', null])
  assert.match(course.warnings.join(' '), /Niveau/)
})

test('header closes after macro blocks instead of an embedded HTML comment', () => {
  const course = parse([
    '<!--', '@Example', '<!-- local HTML comment -->', '[[ fake ]]', '@end',
    'version: 2.0.1', 'lernpfad-level: Experte', '-->', '# Real', '', '[[ 1 ]]'
  ])
  assert.equal(course.version, '2.0.1')
  assert.equal(course.tasks.length, 1)
  assert.equal(course.tasks[0].level, 'Experte')
})

test('Send detection uses authored calls and ignores examples and macro definitions', () => {
  const base = ['<!--', '@Example', '@Auswertung(Send)', '@end', '-->', '# Course', '',
    '```markdown', '@Auswertung(Send)', '```', '', '`@Auswertung(Send)`', '', '[[ 1 ]]']
  assert.equal(parse(base).sendMode, false)
  assert.equal(parse([...base, '', '@Auswertung(`F12;Tab;Send`)']).sendMode, true)
  assert.equal(parse([...base, '', '@Auswertung(Time)']).sendMode, false)
})

test('unannotated quizzes retain authored indices and hints do not become tasks', () => {
  const course = parse([
    '# Tasks', '', '- [( )] A', '- [(X)] B', '[[?]] @Explain(Algebra)', '',
    '@ADetails(1;Algebra)', '', '[[ 4 ]]', '[[?]] @Explain', '',
    '[[ 8 ]]', '', '@ADetails(2;Algebra)'
  ])
  assert.equal(course.tasks.length, 3)
  assert.deepEqual(course.tasks.map(task => task.nativeIndex), [0, 1, 2])
  assert.deepEqual(course.tasks.map(task => task.tags), [['Algebra'], [], ['Algebra']])
})

test('malformed source remains explicitly unavailable instead of making up tasks', () => {
  assert.equal(parse(['<!--', 'version: 1.0', '# Not closed', '[[ 1 ]]']).tasks.length, 0)
  assert.match(parse(['<!--', 'version: 1.0']).warnings[0], /Kurskopf/)
  assert.equal(parse('[[ 1 ]]').tasks.length, 0)
  assert.match(parse('[[ 1 ]]').warnings[0], /Folienüberschriften/)
})

test('Example.md is a safe eight-task Einsteiger course with complete metadata', async () => {
  const markdown = await readFile(new URL('../Example.md', import.meta.url), 'utf8')
  const course = parseLearningCourse(markdown, 'https://example.test/Example.md')
  assert.equal(course.version, '0.1.0')
  assert.equal(course.tasks.length, 8)
  assert.deepEqual(course.tasks.map(task => task.points), [0, 1, 1, 1, 1, 1.5, 1, 1])
  assert.ok(course.tasks.every(task =>
    task.level === 'Einsteiger' && task.mappingSafe && task.tags.length >= 2))
  assert.equal(course.warnings.length, 0)
  assert.equal(new Set(course.tasks.map(task => task.id)).size, 8)
  assert.equal((markdown.match(/@Lernpfad/g) || []).length, 2)
  assert.equal((markdown.match(/@resetter/g) || []).length, 8)
  assert.equal((markdown.match(/\[\[\?\]\] @Explain/g) || []).length, 8)
})
