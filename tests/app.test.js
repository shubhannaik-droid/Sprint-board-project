// Stage 4 – Automated tests. Run with: npm test
// Loads the real index.html + js/app.js in jsdom and drives the UI like a user would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script src[^>]*><\/script>/, '')
  .replace(/<link[^>]*>/g, '');
const code = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

/** Fresh app instance with empty or seeded storage. */
function boot({ confirmAnswer = true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  w.confirm = () => confirmAnswer;
  w.alert = () => {};
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(code);
  const d = w.document;
  const $ = s => d.querySelector(s);
  const $$ = s => [...d.querySelectorAll(s)];
  const go = view => $(`.tab[data-view="${view}"]`).click();
  const fillStory = vals => {
    const f = d.querySelector('#story-form').elements;
    Object.entries(vals).forEach(([k, v]) => { f[k].value = v; });
    d.querySelector('#story-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  };
  const state = () => JSON.parse(w.localStorage.getItem('sprintboard.v1'));
  return { w, d, $, $$, go, fillStory, state };
}

test('index.html references css and js files that exist', () => {
  const raw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refs = [...raw.matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 2);
  refs.forEach(r => assert.ok(fs.existsSync(path.join(root, r)), `${r} is missing`));
});

test('sample project loads on first run with a backlog and an active sprint', () => {
  const app = boot();
  app.go('backlog');
  assert.equal(app.$$('.story-row').length, 4);
  app.go('board');
  assert.equal(app.$$('.column').length, 3);
  assert.equal(app.$$('.card').length, 4);
  assert.ok(app.$('svg.chart'), 'burndown chart should render');
});

test('moving a story to Done updates progress', () => {
  const app = boot();
  app.go('board');
  const before = app.$('.progress').getAttribute('aria-valuenow');
  const inProgress = app.$('.column[data-status="inprogress"] [data-action="move"][data-dir="1"]');
  inProgress.click(); // Login page -> Done (3 of 15 pts)
  const after = app.$('.progress').getAttribute('aria-valuenow');
  assert.ok(Number(after) > Number(before), `progress ${before}% -> ${after}%`);
});

test('adding a story puts it in the backlog; empty title is rejected', () => {
  const app = boot();
  app.fillStory({ title: '   ', points: '3', priority: 'low' });
  assert.equal(app.state().stories.length, 8, 'blank title must not be saved');
  app.fillStory({ title: 'Dark mode', who: 'user', want: 'switch themes', why: 'my eyes rest', points: '5', priority: 'high' });
  const s = app.state().stories.at(-1);
  assert.equal(s.title, 'Dark mode');
  assert.equal(s.status, 'backlog');
  assert.equal(s.points, 5);
});

test('HTML in story titles is escaped (no script injection)', () => {
  const app = boot();
  app.fillStory({ title: '<img src=x onerror=alert(1)>', points: '1', priority: 'low' });
  app.go('backlog');
  assert.equal(app.$$('#view-backlog img').length, 0);
});

test('adding a backlog story to the active sprint puts it in To Do', () => {
  const app = boot();
  app.go('backlog');
  const sel = app.$('select[data-action="assign"]');
  sel.value = '1';
  sel.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  const moved = app.state().stories.filter(s => s.sprintId === 1);
  assert.equal(moved.length, 5);
});

test('completing a sprint records velocity and returns unfinished stories to the backlog', () => {
  const app = boot();
  app.go('board');
  app.$('[data-action="complete-sprint"]').click();
  const st = app.state();
  const sprint = st.sprints[0];
  assert.equal(sprint.state, 'completed');
  assert.equal(sprint.completedPoints, 5); // only "Sign-up form" (5 pts) was done
  assert.equal(sprint.committed, 15);
  assert.equal(st.stories.filter(s => s.status === 'backlog').length, 7);
});

test('only one sprint can be active at a time', () => {
  const app = boot();
  let alerted = false;
  app.w.alert = () => { alerted = true; };
  const f = app.d.querySelector('#sprint-form');
  app.go('sprints');
  app.$('[data-action="new-sprint"]').click();
  f.elements.name.value = 'Sprint 2';
  f.dispatchEvent(new app.w.Event('submit', { cancelable: true, bubbles: true }));
  app.go('sprints');
  app.$('[data-action="start-sprint"]').click();
  assert.ok(alerted, 'should warn that another sprint is active');
  assert.equal(app.state().sprints.filter(s => s.state === 'active').length, 1);
});

test('sprint end date must be after start date', () => {
  const app = boot();
  app.go('sprints');
  app.$('[data-action="new-sprint"]').click();
  const f = app.d.querySelector('#sprint-form');
  f.elements.start.value = '2026-05-10';
  f.elements.end.value = '2026-05-01';
  f.dispatchEvent(new app.w.Event('submit', { cancelable: true, bubbles: true }));
  assert.equal(app.state().sprints.length, 1);
  assert.equal(app.d.querySelector('#sprint-error').hidden, false);
});

test('daily streak: sample data shows a streak and moving a story to Done extends it', () => {
  const app = boot();
  app.go('board');
  assert.equal(app.$('.streak-count').textContent, '3');
  app.$('.column[data-status="inprogress"] [data-action="move"][data-dir="1"]').click(); // Login page -> Done today
  assert.equal(app.$('.streak-count').textContent, '4');
  const days = Object.keys(app.state().activity).sort();
  assert.equal(app.state().activity[days[days.length - 1]], 1, 'today should be logged once');
});

test('daily streak: moving a story back out of Done removes today\'s credit', () => {
  const app = boot();
  app.go('board');
  app.$('.column[data-status="inprogress"] [data-action="move"][data-dir="1"]').click();
  assert.equal(app.$('.streak-count').textContent, '4');
  app.$('.column[data-status="done"] [data-action="move"][data-dir="-1"][data-id="2"]').click();
  assert.equal(app.$('.streak-count').textContent, '3');
});
