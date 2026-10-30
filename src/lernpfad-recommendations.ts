import type {
  LearningCourse, LearningLevel, LearningOfferType, LearningRecommendation,
  LearningReport, LearningStateSnapshot, LearningStatus, LearningTopic
} from './lernpfad-types';

const LEVELS: LearningLevel[] = ['Einsteiger', 'Fortgeschritten', 'Experte'];
const compare = (a: string, b: string): number => a.localeCompare(b, 'de') || (a < b ? -1 : a > b ? 1 : 0);
const key = (value: string): string => value.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('de');

export function selectLearningRecommendation(
  type: LearningOfferType, topic: LearningTopic | undefined, phase: LearningStateSnapshot['phase']
): LearningRecommendation {
  const base = { type, topic: topic?.topic ?? null, taskCount: 4 as const };
  if (type === 'weakness' && (phase === 'collect' || phase === 'grading')) {
    return { ...base, topic: null, targetLevel: 'Einsteiger', available: false,
      reason: 'Empfehlungen zu Schwächen stehen nach der freigegebenen Auswertung zur Verfügung.' };
  }
  if (!topic) return { ...base, targetLevel: type === 'weakness' ? 'Einsteiger' : null, available: false,
    reason: type === 'weakness' ? 'Keine auswertbaren Schwächen oder unbearbeiteten Aufgaben gefunden.' : 'Es sind keine Aufgabenthemen verfügbar.' };
  if (type === 'weakness') return { ...base, targetLevel: 'Einsteiger', available: true,
    reason: `${topic.weaknessCount} Aufgaben sind falsch, teilweise richtig oder nachweislich unbearbeitet. Jede Aufgabe zählt einmal pro Thema.` };
  if (!topic.level) return { ...base, targetLevel: null, available: false,
    reason: `${topic.taskCount} Aufgaben zu diesem Thema. Das bisherige Niveau ist nicht angegeben.` };
  if (type === 'practice') return { ...base, targetLevel: topic.level, available: true,
    reason: `${topic.taskCount} Aufgaben zu diesem Thema. ${topic.levelReason}` };
  const next = LEVELS[LEVELS.indexOf(topic.level) + 1];
  return { ...base, targetLevel: next ?? null, available: !!next,
    reason: next ? `Eine Stufe über ${topic.level}. ${topic.levelReason}` : 'Das bisherige Niveau ist Experte. Eine höhere Stufe ist nicht vorgesehen.' };
}

/** Pure aggregation; never converts missing state into an unanswered task. */
export function buildLearningReport(course: LearningCourse, snapshot: LearningStateSnapshot): LearningReport {
  const states = new Map(snapshot.states.map(state => [state.taskId, state]));
  const protectedPhase = snapshot.phase === 'collect' || snapshot.phase === 'grading';
  const statusCounts: Record<LearningStatus, number> = { correct: 0, wrong: 0, partial: 0, unanswered: 0, unavailable: 0 };
  const topics = new Map<string, LearningTopic & { levels: number[] }>();
  const seen = new Set<string>();
  for (const task of course.tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const status = protectedPhase ? 'unavailable' : states.get(task.id)?.status ?? 'unavailable';
    statusCounts[status]++;
    for (const topicKey of new Set(task.tags.map(key).filter(Boolean))) {
      let topic = topics.get(topicKey);
      if (!topic) {
        topic = { topic: task.tags.find(tag => key(tag) === topicKey)!.trim().replace(/\s+/g, ' '),
          taskCount: 0, weaknessCount: 0, partialCount: 0, unavailableCount: 0,
          level: null, levelReason: '', levels: [0, 0, 0] };
        topics.set(topicKey, topic);
      }
      topic.taskCount++;
      if (status === 'wrong' || status === 'partial' || status === 'unanswered') topic.weaknessCount++;
      if (status === 'partial') topic.partialCount++;
      if (status === 'unavailable') topic.unavailableCount++;
      if (task.level) topic.levels[LEVELS.indexOf(task.level)]++;
    }
  }
  const ranked = [...topics.values()].map(({ levels, ...topic }) => {
    const count = Math.max(...levels);
    if (count) {
      topic.level = LEVELS[levels.indexOf(count)];
      const known = levels.reduce((sum, n) => sum + n, 0);
      topic.levelReason = `Häufigstes angegebenes Niveau: ${topic.level} (${count} Aufgaben; Niveau für ${known} von ${topic.taskCount} bekannt).`;
      if (levels.filter(n => n === count).length > 1) topic.levelReason += ' Bei Gleichstand gilt die niedrigere Stufe.';
    } else topic.levelReason = 'Es liegt keine ausdrückliche Niveauangabe vor.';
    return topic;
  }).sort((a, b) => b.taskCount - a.taskCount || compare(a.topic, b.topic));
  const weaknessTopics = ranked.filter(topic => topic.weaknessCount > 0)
    .sort((a, b) => b.weaknessCount - a.weaknessCount || b.taskCount - a.taskCount || compare(a.topic, b.topic));
  return { courseUrl: course.url, phase: snapshot.phase, topics: ranked, weaknessTopics,
    statusCounts, warnings: [...new Set([...course.warnings, ...snapshot.warnings])],
    recommendations: [selectLearningRecommendation('weakness', weaknessTopics[0], snapshot.phase),
      selectLearningRecommendation('practice', ranked[0], snapshot.phase),
      selectLearningRecommendation('deepen', ranked[0], snapshot.phase)] };
}
