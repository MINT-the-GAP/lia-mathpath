const trackers = new WeakMap();

function tracker(win) {
  let value = trackers.get(win);
  if (!value) {
    value = { state: { version: 1, slides: {} }, timers: [], installed: false };
    trackers.set(win, value);
  }
  return value;
}

function currentHash(win) {
  const raw = String(win.location?.hash || '');
  return raw.match(/^(#\d+)&/)?.[1] ?? (/^#\d+$/.test(raw) ? raw : '#1');
}

function outcome(root) {
  if (root.classList.contains('resolved')) return 'resolved';
  if (root.classList.contains('solved') || root.querySelector(
    '.lia-quiz__feedback.text-success,.lia-quiz__feedback.is-success,.is-success,.text-success'
  )) return 'correct';
  if (root.classList.contains('failed') || root.querySelector(
    '.lia-quiz__feedback.text-error,.lia-quiz__feedback.text-danger,.is-failure'
  )) return 'wrong';
  return 'open';
}

function trial(root) {
  const label = String(root.querySelector('.lia-quiz__check')?.textContent || '').trim();
  const match = label.match(/(?:^|\s)(\d+)$/);
  const value = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function capture(win) {
  const doc = win.document;
  if (!doc || typeof doc.querySelectorAll !== 'function') return;
  const roots = Array.from(doc.querySelectorAll('.lia-quiz')).filter(root =>
    !root.closest('#lia-freeze-bar,.lia-submit-box,[data-snapshot-admin]')
  );
  if (!roots.length) return;
  tracker(win).state.slides[currentHash(win)] = roots.map((root, taskIndex) => ({
    taskIndex,
    nativeIndex: taskIndex,
    table: 'quiz',
    outcome: outcome(root),
    trial: trial(root),
  }));
}

function schedule(win, delay) {
  const state = tracker(win);
  const timer = win.setTimeout(() => {
    state.timers = state.timers.filter(value => value !== timer);
    capture(win);
  }, delay);
  state.timers.push(timer);
}

/**
 * Track only rendered native result metadata. This never reads persistent
 * storage and therefore cannot trigger LiaScript's IndexedDB permission gate.
 */
export function installRuntimeLearningState(win = window) {
  const state = tracker(win);
  if (state.installed) return;
  state.installed = true;
  const onInteraction = event => {
    const target = event.target;
    if (!(target instanceof win.Element) || !target.closest('.lia-quiz')) return;
    capture(win);
    schedule(win, 0);
    schedule(win, 90);
    schedule(win, 320);
  };
  for (const name of ['input', 'change', 'click']) {
    win.document.addEventListener(name, onInteraction, true);
  }
  win.addEventListener('hashchange', () => {
    schedule(win, 120);
    schedule(win, 360);
  });
  const Observer = win.MutationObserver;
  if (Observer && win.document.body) {
    const observer = new Observer(records => {
      if (records.some(record => {
        const target = record.target instanceof win.Element ? record.target : record.target.parentElement;
        return !!target?.closest('.lia-quiz') || Array.from(record.addedNodes).some(node =>
          node instanceof win.Element && (node.matches('.lia-quiz') || !!node.querySelector('.lia-quiz'))
        );
      })) schedule(win, 60);
    });
    observer.observe(win.document.body, { childList: true, subtree: true, attributes: true });
  }
  schedule(win, 0);
  schedule(win, 180);
}

export function readRuntimeLearningState(win = window) {
  installRuntimeLearningState(win);
  capture(win);
  return JSON.parse(JSON.stringify(tracker(win).state));
}
