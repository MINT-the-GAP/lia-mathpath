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
  weakness: 'Grundlagen wiederholen', practice: 'Weitere Übungen', deepen: 'Vertiefungen'
};
const CSS = `
:host{
  display:block;
  max-width:100%;
  margin:1.25em 0;
  color:rgb(var(--lia-mathpath-text-rgb,35,40,44));
  font-family:inherit;
  font-size:16px;
  font-weight:400;
  line-height:1.45;
  color-scheme:light dark;
  --_accent:rgb(var(--lia-mathpath-accent-rgb,20,115,117));
  --_accent-contrast:rgb(var(--lia-mathpath-accent-contrast-rgb,255,255,255));
  --_accent-soft:rgba(var(--lia-mathpath-accent-rgb,20,115,117),.1);
  --_surface:rgb(var(--lia-mathpath-surface-rgb,255,255,255));
  --_surface-soft:rgba(var(--lia-mathpath-surface-rgb,255,255,255),.72);
  --_text:rgb(var(--lia-mathpath-text-rgb,35,40,44));
  --_muted:rgba(var(--lia-mathpath-text-rgb,35,40,44),.72);
  --_border:rgba(var(--lia-mathpath-text-rgb,35,40,44),.22);
  --_success:rgb(var(--lia-mathpath-success-rgb,24,121,78));
  --_error:rgb(var(--lia-mathpath-error-rgb,184,45,45));
  --_warning:rgb(var(--lia-mathpath-warning-rgb,139,82,0));
}
*{box-sizing:border-box}
button,select{
  font-family:inherit;
  font-size:1em;
  line-height:1.35;
}
button{
  min-height:2.75em;
  border-radius:.35em;
  cursor:pointer;
  font-weight:600;
  text-align:center;
  transition:background-color .16s ease,border-color .16s ease,color .16s ease,filter .16s ease,transform .08s ease;
}
button:hover:not(:disabled){filter:brightness(.94)}
button:active:not(:disabled){transform:translateY(1px)}
button:disabled,select:disabled{opacity:.55;cursor:not-allowed;filter:none;transform:none}
button[aria-busy=true]{cursor:wait}
button:focus-visible,select:focus-visible{
  outline:3px solid var(--_accent);
  outline-offset:3px;
}
.retry{
  display:inline-flex;
  max-width:100%;
  margin-top:.7em;
  align-items:center;
  justify-content:center;
  gap:.55em;
  padding:.62em 1em;
  border:1px solid var(--_accent);
  background:var(--_accent);
  color:var(--_accent-contrast);
  box-shadow:0 1px 2px rgba(var(--lia-mathpath-text-rgb,35,40,44),.16);
}
.intro{
  max-width:52em;
  margin:0 0 .9em;
  color:var(--_muted);
  font-size:.9375em;
  line-height:1.5;
}
.retry[hidden]{display:none}
.retry[aria-busy=true]::after{
  width:.85em;
  height:.85em;
  flex:0 0 auto;
  border:2px solid rgba(var(--lia-mathpath-accent-contrast-rgb,255,255,255),.45);
  border-top-color:var(--_accent-contrast);
  border-radius:50%;
  content:"";
  animation:lia-mathpath-spin .75s linear infinite;
}
.summary{margin:.9em 0 0}
.summary:empty,.warnings:empty,.course-status:empty{display:none}
.summary-list{
  display:flex;
  flex-wrap:wrap;
  gap:.45em;
  margin:0;
  padding:0;
  list-style:none;
}
.summary-item{
  display:inline-flex;
  align-items:center;
  min-height:1.9em;
  padding:.25em .62em;
  border:1px solid var(--_border);
  border-radius:999px;
  background:var(--_surface-soft);
  color:var(--_text);
  font-size:.875em;
  font-weight:600;
  white-space:nowrap;
}
.summary-message{
  margin:0;
  padding:.7em .8em;
  border-inline-start:.25em solid var(--_accent);
  border-radius:.25em;
  background:var(--_accent-soft);
  color:var(--_text);
}
.summary[data-state=error] .summary-message{
  border-inline-start-color:var(--_error);
  background:rgba(var(--lia-mathpath-error-rgb,184,45,45),.1);
}
.warnings{
  margin:.9em 0 0;
  padding:.75em .9em;
  border:1px solid rgba(var(--lia-mathpath-warning-rgb,139,82,0),.38);
  border-inline-start:.3em solid var(--_warning);
  border-radius:.45em;
  background:rgba(var(--lia-mathpath-warning-rgb,139,82,0),.09);
  color:var(--_text);
  font-size:.9375em;
  font-weight:500;
}
.offers{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:1em;
  margin-top:1em;
}
section{
  display:flex;
  min-width:0;
  flex-direction:column;
  padding:1em;
  border:1px solid var(--_border);
  border-top:3px solid var(--_accent);
  border-radius:.75em;
  background:linear-gradient(180deg,var(--_accent-soft),transparent 4.25em),var(--_surface-soft);
  box-shadow:0 1px 3px rgba(var(--lia-mathpath-text-rgb,35,40,44),.08);
}
h3{
  margin:0 0 .9em;
  color:var(--_text);
  font-size:1.125em;
  font-weight:700;
  line-height:1.3;
}
.topic-label{
  display:block;
  margin:0 0 .85em;
  color:var(--_text);
  font-size:.875em;
  font-weight:600;
}
.secondary-label{margin-top:.05em}
.topic-chips{
  display:flex;
  min-height:.25em;
  flex-wrap:wrap;
  gap:.4em;
  margin:.45em 0 .2em;
}
.topic-chips:empty{display:none}
.topic-chip{
  display:inline-flex;
  max-width:100%;
  align-items:center;
  gap:.35em;
  padding:.28em .42em .28em .62em;
  border:1px solid rgba(var(--lia-mathpath-accent-rgb,20,115,117),.35);
  border-radius:.45em;
  background:var(--_accent-soft);
  color:var(--_text);
  font-size:.875em;
  font-weight:600;
}
.topic-chip span{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.topic-chip button{
  display:inline-grid;
  width:1.55em;
  min-height:1.55em;
  padding:0;
  place-items:center;
  border:0;
  border-radius:.3em;
  background:transparent;
  color:inherit;
  font-size:1em;
  line-height:1;
}
.topic-chip button:hover:not(:disabled){background:rgba(var(--lia-mathpath-accent-rgb,20,115,117),.18)}
select{
  display:block;
  width:100%;
  min-height:2.75em;
  max-width:100%;
  margin-top:.3em;
  padding:.55em .7em;
  border:1px solid var(--_border);
  border-radius:.35em;
  background:var(--_surface);
  color:var(--_text);
}
.meta{
  display:flex;
  flex-wrap:wrap;
  gap:.4em;
  margin:0 0 .85em;
}
.level,.count{
  display:inline-flex;
  align-items:center;
  min-height:1.75em;
  margin:0;
  padding:.2em .55em;
  border-radius:999px;
  background:var(--_accent-soft);
  color:var(--_text);
  font-size:.8125em;
  font-weight:650;
}
.reason{
  flex:1 1 auto;
  margin:0;
  color:var(--_muted);
  font-size:.9375em;
  line-height:1.5;
}
.open-course{
  display:inline-flex;
  width:100%;
  align-items:center;
  justify-content:center;
  margin-top:1em;
  padding:.58em .85em;
  border:1px solid var(--_accent);
  background:var(--_surface);
  color:var(--_text);
  box-shadow:0 1px 2px rgba(var(--lia-mathpath-text-rgb,35,40,44),.12);
}
.open-course:hover:not(:disabled){
  background:var(--_accent);
  color:var(--_accent-contrast);
}
.course-status{
  margin:.65em 0 0;
  padding:.55em .65em;
  border-radius:.35em;
  font-size:.875em;
  line-height:1.45;
}
.course-status[data-state=busy]{
  border-inline-start:.25em solid var(--_accent);
  background:var(--_accent-soft);
  color:var(--_text);
}
.course-status[data-state=success]{
  border-inline-start:.25em solid var(--_success);
  background:rgba(var(--lia-mathpath-success-rgb,24,121,78),.11);
  color:var(--_text);
}
.course-status[data-state=error]{
  border-inline-start:.25em solid var(--_error);
  background:rgba(var(--lia-mathpath-error-rgb,184,45,45),.1);
  color:var(--_text);
}
.course-status[data-state=blocked]{
  border-inline-start:.25em solid var(--_warning);
  background:rgba(var(--lia-mathpath-warning-rgb,139,82,0),.09);
  color:var(--_text);
}
@keyframes lia-mathpath-spin{to{transform:rotate(360deg)}}
@media(max-width:62em){
  .offers{grid-template-columns:repeat(auto-fit,minmax(min(100%,18em),1fr))}
}
@media(max-width:42em){
  :host{margin:1em 0}
  .offers{grid-template-columns:minmax(0,1fr)}
  .retry{width:100%}
}
@media(prefers-reduced-motion:reduce){
  button{transition:none}
  .retry[aria-busy=true]::after{animation:none}
}
@media(forced-colors:active){
  :host{color:CanvasText}
  .retry{border-color:Highlight;background:Highlight;color:HighlightText;box-shadow:none}
  .open-course{border-color:LinkText;color:LinkText}
  .open-course:hover:not(:disabled){background:Highlight;color:HighlightText}
  section,.summary-item,.summary-message,.level,.count,.topic-chip,.warnings,.course-status,select{border-color:CanvasText;background:Canvas;color:CanvasText;box-shadow:none}
  button:disabled,select:disabled{border-color:GrayText;color:GrayText}
}
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
  const runtimeWindow = win;
  class LearningPathElement extends win.HTMLElement {
    private value: LearningReport | null = null;
    private selectionCourseUrl: string | null = null;
    private secondarySelections: Record<LearningOfferType, string[]> = {
      weakness: [], practice: [], deepen: []
    };
    private request = 0;
    private generation = 0;
    private refreshing = false;
    private generating = false;
    private refreshTimer: number | null = null;
    private transientRetryTimer: number | null = null;
    private transientRetries = 0;
    private generationController: AbortController | null = null;
    private retryButton: HTMLButtonElement;
    private status: HTMLDivElement;
    private results: HTMLDivElement;
    private warnings: HTMLDivElement;
    private readonly handleCourseInteraction = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof runtimeWindow.Element) ||
          !target.closest('.lia-quiz__check, lia-resetter-host input[type=button]')) return;
      if (this.refreshTimer !== null) runtimeWindow.clearTimeout(this.refreshTimer);
      // Let LiaScript finish rendering the fresh quiz outcome before reading
      // the DOM tracker. Repeated checks are debounced into one update.
      this.refreshTimer = runtimeWindow.setTimeout(() => {
        this.refreshTimer = null;
        this.transientRetries = 0;
        void this.refresh();
      }, 150);
    };
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
      const intro = doc.createElement('p');
      intro.className = 'intro';
      intro.textContent = 'Hier findest du passende Übungen für deinen nächsten Lernschritt. Wähle ein Hauptthema und bei Bedarf Nebenthemen aus und öffne anschließend einen Kurs mit vier Aufgaben.';
      this.retryButton = doc.createElement('button');
      this.retryButton.type = 'button';
      this.retryButton.className = 'retry lia-btn lia-btn--primary';
      this.retryButton.textContent = 'Empfehlungen erneut laden';
      this.retryButton.hidden = true;
      this.retryButton.setAttribute('aria-controls', 'lia-mathpath-summary lia-mathpath-offers');
      this.status = doc.createElement('div');
      this.status.id = 'lia-mathpath-summary';
      this.status.className = 'summary';
      this.status.setAttribute('role', 'status');
      this.status.setAttribute('aria-live', 'polite');
      this.status.setAttribute('aria-atomic', 'true');
      this.results = doc.createElement('div');
      this.results.id = 'lia-mathpath-offers';
      this.results.className = 'offers';
      this.results.setAttribute('aria-label', 'Empfohlene Lernpfad-Angebote');
      this.warnings = doc.createElement('div');
      this.warnings.className = 'warnings';
      this.warnings.setAttribute('role', 'status');
      this.warnings.setAttribute('aria-live', 'polite');
      this.warnings.setAttribute('aria-atomic', 'true');
      this.warnings.setAttribute('data-state', 'warning');
      shadow.append(style, intro, this.status, this.retryButton, this.warnings, this.results);
      this.retryButton.addEventListener('click', () => { void this.refresh(); });
    }
    connectedCallback(): void {
      doc.addEventListener('click', this.handleCourseInteraction);
      this.transientRetries = 0;
      void this.refresh();
    }
    disconnectedCallback(): void {
      const wasRefreshing = this.refreshing;
      const wasGenerating = this.generating;
      this.request++;
      this.generation++;
      doc.removeEventListener('click', this.handleCourseInteraction);
      if (this.refreshTimer !== null) runtimeWindow.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
      if (this.transientRetryTimer !== null) runtimeWindow.clearTimeout(this.transientRetryTimer);
      this.transientRetryTimer = null;
      this.generationController?.abort();
      this.generationController = null;
      this.refreshing = false;
      this.generating = false;
      if (wasRefreshing && !wasGenerating) {
        this.setSummaryMessage('Aktualisierung abgebrochen. Die Empfehlungen werden beim Öffnen erneut geladen.', 'error');
        this.retryButton.hidden = false;
      }
      this.results.querySelectorAll<HTMLParagraphElement>('.course-status[data-state=busy]').forEach(output => {
        this.setCourseStatus(output, 'Die Kursvorbereitung wurde abgebrochen. Bitte erneut versuchen.', 'error');
      });
      this.retryButton.disabled = false;
      this.retryButton.removeAttribute('aria-busy');
      this.setOfferControlsDisabled(false);
    }
    private setSummaryMessage(text: string, state: 'busy' | 'error' | 'notice'): void {
      const message = doc.createElement('p');
      message.className = 'summary-message';
      message.textContent = text;
      this.status.setAttribute('data-state', state);
      this.status.replaceChildren(message);
    }
    private setCourseStatus(
      output: HTMLParagraphElement,
      text: string,
      state: 'idle' | 'busy' | 'success' | 'error' | 'blocked'
    ): void {
      output.textContent = text;
      output.setAttribute('data-state', state);
      output.setAttribute('role', state === 'error' ? 'alert' : 'status');
      output.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
      output.setAttribute('aria-atomic', 'true');
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
        control.removeAttribute('aria-busy');
      });
    }
    private async refresh(): Promise<void> {
      if (this.refreshing || this.generating) return;
      if (this.transientRetryTimer !== null) {
        runtimeWindow.clearTimeout(this.transientRetryTimer);
        this.transientRetryTimer = null;
      }
      const request = ++this.request;
      this.refreshing = true;
      this.retryButton.hidden = true;
      this.retryButton.disabled = true;
      this.retryButton.setAttribute('aria-busy', 'true');
      this.setOfferControlsDisabled(true);
      this.setSummaryMessage('Dein aktueller Lernstand wird gelesen …', 'busy');
      try {
        const report = await load();
        if (request !== this.request || !this.isConnected) return;
        if (this.selectionCourseUrl !== report.courseUrl) {
          this.selectionCourseUrl = report.courseUrl;
          this.secondarySelections = { weakness: [], practice: [], deepen: [] };
        }
        this.value = JSON.parse(JSON.stringify(report));
        this.render();
        // With MathPath before Freeze in the import list, the custom element
        // can connect during Freeze's short bootstrap window. Retry that
        // transient protected state automatically instead of freezing the
        // first, premature result on screen.
        if (report.phase === 'unavailable' && this.transientRetries < 4) {
          const delay = 150 * (2 ** this.transientRetries++);
          if (this.transientRetryTimer !== null) {
            runtimeWindow.clearTimeout(this.transientRetryTimer);
          }
          this.transientRetryTimer = runtimeWindow.setTimeout(() => {
            this.transientRetryTimer = null;
            void this.refresh();
          }, delay);
        } else if (report.phase !== 'unavailable') {
          this.transientRetries = 0;
        }
      } catch (error) {
        if (request !== this.request || !this.isConnected) return;
        this.value = null;
        this.transientRetries = 0;
        this.results.replaceChildren();
        this.warnings.textContent = '';
        this.retryButton.hidden = false;
        this.setSummaryMessage(
          error instanceof Error && error.name !== 'AbortError'
            ? error.message
            : 'Die Empfehlungen konnten nicht geladen werden. Bitte erneut versuchen.',
          'error'
        );
      } finally {
        if (request === this.request) {
          this.refreshing = false;
          this.retryButton.disabled = false;
          this.retryButton.removeAttribute('aria-busy');
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
        this.setCourseStatus(
          output,
          'Ein Kurs kann erst nach der freigegebenen Auswertung geöffnet werden.',
          'blocked'
        );
        return;
      }
      const recommendation = JSON.parse(JSON.stringify(this.value.recommendations[index]));
      if (!recommendation?.available || !recommendation.topic || !recommendation.targetLevel) {
        this.setCourseStatus(
          output,
          recommendation?.reason || 'Dieses Angebot ist derzeit nicht verfügbar.',
          'blocked'
        );
        return;
      }
      const generation = ++this.generation;
      const controller = new AbortController();
      this.generationController = controller;
      this.generating = true;
      this.retryButton.disabled = true;
      this.retryButton.setAttribute('aria-busy', 'true');
      this.setOfferControlsDisabled(true);
      const trigger = output.closest('section')?.querySelector<HTMLButtonElement>('button.open-course') || null;
      trigger?.setAttribute('aria-busy', 'true');
      this.setCourseStatus(output, 'Der Kurs mit vier Aufgaben wird vorbereitet …', 'busy');
      try {
        const result = await openCourse({
          courseUrl: this.value.courseUrl,
          recommendation
        }, { signal: controller.signal });
        if (generation !== this.generation || !this.isConnected) return;
        this.setCourseStatus(
          output,
          `Der Kurs „${result.topic}“ wurde in einem neuen Fenster geöffnet.`,
          'success'
        );
      } catch (error) {
        if (generation !== this.generation || !this.isConnected) return;
        this.setCourseStatus(
          output,
          error instanceof Error
            ? error.message
            : 'Der Kurs konnte nicht geöffnet werden. Bitte versuche es erneut.',
          'error'
        );
      } finally {
        if (generation === this.generation) {
          trigger?.removeAttribute('aria-busy');
          this.generationController = null;
          this.generating = false;
          this.retryButton.disabled = false;
          this.retryButton.removeAttribute('aria-busy');
          this.setOfferControlsDisabled(false);
        }
      }
    }
    private renderSummary(report: LearningReport): void {
      const counts = report.statusCounts;
      if (report.phase === 'collect' || report.phase === 'grading') {
        this.setSummaryMessage(
          'Die Bewertung ist noch nicht freigegeben. Themen und Niveaus können bereits angezeigt werden.',
          'notice'
        );
        return;
      }
      const values = [
        ['correct', counts.correct, 'richtig'],
        ['wrong', counts.wrong, 'falsch'],
        ['partial', counts.partial, 'teilweise richtig'],
        ['unanswered', counts.unanswered, 'unbearbeitet'],
        ['unavailable', counts.unavailable, 'nicht auswertbar']
      ] as const;
      const list = doc.createElement('ul');
      list.className = 'summary-list';
      list.setAttribute('aria-label', 'Ergebnisübersicht');
      for (const [state, value, label] of values) {
        const item = doc.createElement('li');
        item.className = 'summary-item';
        item.setAttribute('data-result', state);
        item.textContent = `${value} ${label}`;
        list.append(item);
      }
      this.status.setAttribute('data-state', 'ready');
      this.status.replaceChildren(list);
    }
    private render(): void {
      const report = this.value!;
      this.renderSummary(report);
      this.warnings.replaceChildren();
      if (report.warnings.length) {
        const label = doc.createElement('strong');
        label.textContent = 'Hinweis: ';
        this.warnings.append(label, doc.createTextNode(report.warnings.join(' ')));
      }
      this.results.replaceChildren();
      report.recommendations.forEach((recommendation, index) => {
        const section = doc.createElement('section');
        section.setAttribute('data-offer', recommendation.type);
        const titleId = `lia-mathpath-offer-${index}-title`;
        const selectId = `lia-mathpath-offer-${index}-topic`;
        const secondarySelectId = `lia-mathpath-offer-${index}-secondary-topic`;
        const reasonId = `lia-mathpath-offer-${index}-reason`;
        const statusId = `lia-mathpath-offer-${index}-status`;
        section.setAttribute('aria-labelledby', titleId);
        const title = doc.createElement('h3');
        title.id = titleId;
        title.textContent = TITLES[recommendation.type];
        const label = doc.createElement('label');
        label.className = 'topic-label';
        label.htmlFor = selectId;
        label.textContent = 'Hauptthema';
        const select = doc.createElement('select');
        select.id = selectId;
        select.setAttribute('aria-label', `Hauptthema für ${title.textContent}`);
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
        const secondaryLabel = doc.createElement('label');
        secondaryLabel.className = 'topic-label secondary-label';
        secondaryLabel.htmlFor = secondarySelectId;
        secondaryLabel.append(doc.createTextNode('Nebenthemen'));
        const chips = doc.createElement('div');
        chips.className = 'topic-chips';
        chips.setAttribute('aria-label', 'Gewählte Nebenthemen');
        const secondarySelect = doc.createElement('select');
        secondarySelect.id = secondarySelectId;
        secondarySelect.setAttribute('aria-label', `Nebenthema für ${title.textContent} hinzufügen`);
        const normalized = (value: string): string => value.trim().replace(/\s+/g, ' ')
          .normalize('NFC').toLocaleLowerCase('de-DE');
        const secondaryOptions = report.secondaryTopicOptions?.[recommendation.type] ||
          (recommendation.type === 'weakness' ? report.weaknessTopics : report.topics)
            .map(topic => topic.topic);
        let selectedSecondary = this.secondarySelections[recommendation.type]
          .filter(topic => secondaryOptions.some(option => normalized(option) === normalized(topic)))
          .filter(topic => normalized(topic) !== normalized(select.value))
          .slice(0, 3);
        this.secondarySelections[recommendation.type] = [...selectedSecondary];
        const renderSecondary = (): void => {
          selectedSecondary = selectedSecondary
            .filter(topic => normalized(topic) !== normalized(select.value))
            .slice(0, 3);
          this.secondarySelections[recommendation.type] = [...selectedSecondary];
          chips.replaceChildren();
          for (const topic of selectedSecondary) {
            const chip = doc.createElement('span');
            chip.className = 'topic-chip';
            const text = doc.createElement('span');
            text.textContent = topic;
            const remove = doc.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Nebenthema ${topic} entfernen`);
            remove.disabled = this.generating;
            remove.addEventListener('click', () => {
              selectedSecondary = selectedSecondary.filter(entry => normalized(entry) !== normalized(topic));
              renderSecondary();
              update();
            });
            chip.append(text, remove);
            chips.append(chip);
          }
          secondarySelect.replaceChildren();
          const placeholder = doc.createElement('option');
          placeholder.value = '';
          const available = secondaryOptions.filter(topic =>
            normalized(topic) !== normalized(select.value) &&
            !selectedSecondary.some(selected => normalized(selected) === normalized(topic)));
          placeholder.textContent = selectedSecondary.length >= 3
            ? 'Maximal 3 Nebenthemen gewählt'
            : available.length ? 'Nebenthema hinzufügen' : 'Keine weiteren Nebenthemen verfügbar';
          secondarySelect.append(placeholder);
          if (selectedSecondary.length < 3) {
            for (const topic of available) {
              const option = doc.createElement('option');
              option.value = topic;
              option.textContent = topic;
              secondarySelect.append(option);
            }
          }
          secondarySelect.value = '';
          secondarySelect.disabled = this.generating || secondarySelect.options.length === 1;
        };
        secondaryLabel.append(chips, secondarySelect);
        const meta = doc.createElement('div');
        meta.className = 'meta';
        const level = doc.createElement('p');
        level.className = 'level';
        const count = doc.createElement('p');
        count.className = 'count';
        count.textContent = '4 Aufgaben';
        meta.append(level, count);
        const reason = doc.createElement('p');
        reason.id = reasonId;
        reason.className = 'reason';
        const courseButton = doc.createElement('button');
        courseButton.type = 'button';
        courseButton.className = 'open-course lia-btn lia-btn--outline';
        courseButton.textContent = 'Kurs mit 4 Aufgaben öffnen';
        courseButton.setAttribute('aria-describedby', `${reasonId} ${statusId}`);
        const courseStatus = doc.createElement('p');
        courseStatus.id = statusId;
        courseStatus.className = 'course-status';
        courseStatus.setAttribute('role', 'status');
        courseStatus.setAttribute('aria-live', 'polite');
        courseStatus.setAttribute('aria-atomic', 'true');
        courseStatus.setAttribute('data-state', 'idle');
        const update = (): void => {
          const choice = selectLearningRecommendation(recommendation.type, topics.find(t => t.topic === select.value), report.phase);
          choice.secondaryTopics = [...selectedSecondary];
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
              ? `Kurs mit 4 Aufgaben zu ${[choice.topic, ...choice.secondaryTopics].join(', ')} öffnen`
              : `Kurs für ${title.textContent} ist nicht verfügbar`
          );
          this.setCourseStatus(
            courseStatus,
            generationAllowed
              ? ''
              : 'Ein Kurs kann erst nach der freigegebenen Auswertung geöffnet werden.',
            generationAllowed ? 'idle' : 'blocked'
          );
        };
        select.addEventListener('change', () => {
          renderSecondary();
          update();
        });
        secondarySelect.addEventListener('change', () => {
          if (secondarySelect.value && selectedSecondary.length < 3) {
            selectedSecondary.push(secondarySelect.value);
          }
          renderSecondary();
          update();
        });
        courseButton.addEventListener('click', () => { void this.generateCourse(index, courseStatus); });
        renderSecondary();
        update();
        section.append(title, label, secondaryLabel, meta, reason, courseButton, courseStatus);
        this.results.append(section);
      });
    }
  }
  win.customElements.define('lia-mathpath-lernpfad', LearningPathElement);
}
