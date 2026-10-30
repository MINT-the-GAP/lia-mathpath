import { getLearningRecommendations } from './lernpfad-service';
import { selectLearningRecommendation } from './lernpfad-recommendations';
import type { LearningReport, LearningOfferType } from './lernpfad-types';
import type {
  GeneratedLearningCourse,
  LearningCourseGenerationOptions,
  LearningCourseGenerationRequest
} from './lernpfad-generation-types';
import { openLearningCourse } from './lernpfad-open-course';

const TITLES: Record<LearningOfferType, string> = {
  weakness: 'Schwächen üben', practice: 'Weitere Übungen', deepen: 'Vertiefungen'
};
const CSS = `
:host{display:block;margin:1.2em 0;font:inherit;color:inherit}
*{box-sizing:border-box}button,select{font:inherit;color:inherit;background:var(--lia-background-color,transparent);border:1px solid currentColor;border-radius:.4em;padding:.55em .75em}
button{cursor:pointer;text-align:left}button:disabled{opacity:.65;cursor:not-allowed}button[aria-busy=true]{cursor:wait}button:focus-visible,select:focus-visible{outline:3px solid currentColor;outline-offset:3px}
.offers{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem;margin-top:1rem}
section{border:1px solid currentColor;border-radius:.65em;padding:1rem;min-width:0}h3{font-size:1.1em;margin:0 0 .8em}
label{display:block;margin-bottom:.3em}select{display:block;width:100%;max-width:100%}p{margin:.6em 0;line-height:1.5}
.reason,.warnings,.course-status{font-size:.9em}.warnings:empty,.summary:empty,.course-status:empty{display:none}.level,.count{font-weight:600}
.open-course{display:block;width:100%;margin-top:.8em;text-align:center}.course-status{margin:.6em 0 0}
`;

/** All controls belong to this component's shadow tree, never a native quiz. */
export function registerLearningPathElement(
  doc: Document = document,
  load: () => Promise<LearningReport> = getLearningRecommendations,
  openCourse: (
    request: LearningCourseGenerationRequest,
    options?: LearningCourseGenerationOptions
  ) => Promise<GeneratedLearningCourse> = openLearningCourse
): void {
  const win = doc.defaultView;
  if (!win || win.customElements.get('lia-mathpath-lernpfad')) return;
  class LearningPathElement extends win.HTMLElement {
    private value: LearningReport | null = null;
    private request = 0;
    private generation = 0;
    private generating = false;
    private generationController: AbortController | null = null;
    private button: HTMLButtonElement;
    private status: HTMLParagraphElement;
    private results: HTMLDivElement;
    private warnings: HTMLParagraphElement;
    get report(): LearningReport | null { return this.value ? JSON.parse(JSON.stringify(this.value)) : null; }
    private protectedRuntimePhase(): 'collect' | 'grading' | null {
      const classes = doc.body?.classList;
      if (classes?.contains('lia-send-collect')) return 'collect';
      if (classes?.contains('lia-send-grading')) return 'grading';
      const runtime = win as typeof win & {
        __liaFreezeLearningStateV1__?: { read(): unknown };
      };
      try {
        const snapshot = runtime.__liaFreezeLearningStateV1__?.read();
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
        const state = snapshot as Record<string, unknown>;
        if (state.version !== 1 || state.courseUrl !== this.value?.courseUrl) return null;
        return state.phase === 'collect' || state.phase === 'grading' ? state.phase : null;
      } catch {
        return null;
      }
    }
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = CSS;
      this.button = doc.createElement('button');
      this.button.type = 'button';
      this.button.className = 'create';
      this.button.textContent = 'Empfehlungen für deinen weiteren Lernpfad erstellen';
      this.status = doc.createElement('p');
      this.status.className = 'summary';
      this.status.setAttribute('role', 'status');
      this.status.setAttribute('aria-live', 'polite');
      this.results = doc.createElement('div');
      this.results.className = 'offers';
      this.warnings = doc.createElement('p');
      this.warnings.className = 'warnings';
      shadow.append(style, this.button, this.status, this.results, this.warnings);
      this.button.addEventListener('click', () => { void this.refresh(); });
    }
    disconnectedCallback(): void {
      this.request++;
      this.generation++;
      this.generationController?.abort();
      this.generationController = null;
      this.generating = false;
      if (this.button.disabled) this.status.textContent = 'Aktualisierung abgebrochen. Bitte erneut erstellen.';
      this.button.disabled = false;
      this.button.removeAttribute('aria-busy');
    }
    private setOfferControlsDisabled(disabled: boolean): void {
      this.results.querySelectorAll('select').forEach(node => {
        const select = node as HTMLSelectElement;
        select.disabled = disabled || select.options.length === 0 ||
          (select.options.length === 1 && !select.options[0].value);
      });
      this.results.querySelectorAll('button.open-course').forEach(node => {
        const control = node as HTMLButtonElement;
        control.disabled = disabled || control.closest('section')?.getAttribute('data-course-available') !== 'true';
        if (disabled && this.generating) control.setAttribute('aria-busy', 'true');
        else control.removeAttribute('aria-busy');
      });
    }
    private async refresh(): Promise<void> {
      if (this.button.disabled || this.generating) return;
      const request = ++this.request;
      this.button.disabled = true;
      this.button.setAttribute('aria-busy', 'true');
      this.setOfferControlsDisabled(true);
      this.status.textContent = 'Dein aktueller Lernstand wird gelesen …';
      try {
        const report = await load();
        if (request !== this.request || !this.isConnected) return;
        this.value = JSON.parse(JSON.stringify(report));
        this.render();
      } catch (error) {
        if (request !== this.request || !this.isConnected) return;
        this.value = null;
        this.results.replaceChildren();
        this.warnings.textContent = '';
        this.status.textContent = error instanceof Error && error.name !== 'AbortError' ? error.message : 'Die Empfehlungen konnten nicht geladen werden. Bitte erneut versuchen.';
      } finally {
        if (request === this.request) {
          this.button.disabled = false;
          this.button.removeAttribute('aria-busy');
          this.setOfferControlsDisabled(false);
        }
      }
    }
    private async generateCourse(index: number, output: HTMLParagraphElement): Promise<void> {
      if (this.generating || !this.value) return;
      const protectedPhase = this.protectedRuntimePhase();
      if (protectedPhase) {
        this.value.phase = protectedPhase;
        this.render();
        return;
      }
      if (this.value.phase === 'collect' || this.value.phase === 'grading') {
        output.textContent = 'Ein Kurs kann erst nach der freigegebenen Auswertung geöffnet werden.';
        return;
      }
      const recommendation = JSON.parse(JSON.stringify(this.value.recommendations[index]));
      if (!recommendation?.available || !recommendation.topic || !recommendation.targetLevel) {
        output.textContent = recommendation?.reason || 'Dieses Angebot ist derzeit nicht verfügbar.';
        return;
      }
      const generation = ++this.generation;
      const controller = new AbortController();
      this.generationController = controller;
      this.generating = true;
      this.button.disabled = true;
      this.button.setAttribute('aria-busy', 'true');
      this.setOfferControlsDisabled(true);
      output.textContent = 'Der Kurs mit vier Aufgaben wird vorbereitet …';
      try {
        const result = await openCourse({
          courseUrl: this.value.courseUrl,
          recommendation
        }, { signal: controller.signal });
        if (generation !== this.generation || !this.isConnected) return;
        output.textContent = `Der Kurs „${result.topic}“ wurde in einem neuen Fenster geöffnet.`;
      } catch (error) {
        if (generation !== this.generation || !this.isConnected) return;
        output.textContent = error instanceof Error
          ? error.message
          : 'Der Kurs konnte nicht geöffnet werden. Bitte versuche es erneut.';
      } finally {
        if (generation === this.generation) {
          this.generationController = null;
          this.generating = false;
          this.button.disabled = false;
          this.button.removeAttribute('aria-busy');
          this.setOfferControlsDisabled(false);
        }
      }
    }
    private render(): void {
      const report = this.value!;
      const counts = report.statusCounts;
      this.status.textContent = report.phase === 'collect' || report.phase === 'grading'
        ? 'Die Bewertung ist noch nicht freigegeben. Themen und Niveaus können bereits angezeigt werden.'
        : `${counts.correct} richtig · ${counts.wrong} falsch · ${counts.partial} teilweise richtig · ${counts.unanswered} unbearbeitet · ${counts.unavailable} nicht auswertbar`;
      this.warnings.textContent = report.warnings.join(' ');
      this.results.replaceChildren();
      report.recommendations.forEach((recommendation, index) => {
        const section = doc.createElement('section');
        section.setAttribute('data-offer', recommendation.type);
        const title = doc.createElement('h3');
        title.textContent = TITLES[recommendation.type];
        const label = doc.createElement('label');
        label.textContent = 'Thema';
        const select = doc.createElement('select');
        select.setAttribute('aria-label', `Thema für ${title.textContent}`);
        const topics = recommendation.type === 'weakness' ? report.weaknessTopics : report.topics;
        for (const topic of topics) {
          const option = doc.createElement('option');
          option.value = topic.topic;
          option.textContent = topic.topic;
          select.append(option);
        }
        if (!topics.length) {
          const option = doc.createElement('option');
          option.value = '';
          option.textContent = 'Keine Themen verfügbar';
          select.append(option);
          select.disabled = true;
        } else select.value = recommendation.topic || topics[0].topic;
        label.append(select);
        const level = doc.createElement('p');
        level.className = 'level';
        const count = doc.createElement('p');
        count.className = 'count';
        count.textContent = '4 Aufgaben';
        const reason = doc.createElement('p');
        reason.className = 'reason';
        const courseButton = doc.createElement('button');
        courseButton.type = 'button';
        courseButton.className = 'open-course';
        courseButton.textContent = 'Kurs mit 4 Aufgaben öffnen';
        const courseStatus = doc.createElement('p');
        courseStatus.className = 'course-status';
        courseStatus.setAttribute('role', 'status');
        courseStatus.setAttribute('aria-live', 'polite');
        const update = (): void => {
          const choice = selectLearningRecommendation(recommendation.type, topics.find(t => t.topic === select.value), report.phase);
          const generationAllowed = report.phase !== 'collect' && report.phase !== 'grading';
          report.recommendations[index] = choice;
          section.setAttribute('data-available', String(choice.available));
          section.setAttribute('data-course-available', String(choice.available && generationAllowed));
          level.textContent = choice.targetLevel ? `Niveau: ${choice.targetLevel}` : 'Niveau: nicht verfügbar';
          reason.textContent = choice.reason;
          courseButton.disabled = !choice.available || !generationAllowed || this.generating;
          courseButton.setAttribute(
            'aria-label',
            !generationAllowed
              ? `Kurs für ${title.textContent} kann erst nach der freigegebenen Auswertung geöffnet werden`
              : choice.topic
              ? `Kurs mit 4 Aufgaben zu ${choice.topic} öffnen`
              : `Kurs für ${title.textContent} ist nicht verfügbar`
          );
          courseStatus.textContent = generationAllowed
            ? ''
            : 'Ein Kurs kann erst nach der freigegebenen Auswertung geöffnet werden.';
        };
        select.addEventListener('change', update);
        courseButton.addEventListener('click', () => { void this.generateCourse(index, courseStatus); });
        update();
        section.append(title, label, level, count, reason, courseButton, courseStatus);
        this.results.append(section);
      });
    }
  }
  win.customElements.define('lia-mathpath-lernpfad', LearningPathElement);
}
