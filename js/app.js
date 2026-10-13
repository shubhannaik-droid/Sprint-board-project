/* Sprintboard – a small Scrum/Kanban task manager.
   Plain HTML/CSS/JS, no build step. Data lives in localStorage. */
(() => {
  'use strict';

  const KEY = 'sprintboard.v1';
  const POINTS = [1, 2, 3, 5, 8, 13];
  const COLUMNS = [
    { id: 'todo', label: 'To Do' },
    { id: 'inprogress', label: 'In Progress' },
    { id: 'done', label: 'Done' },
  ];
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  /* ---------- state ---------- */
  let state;
  let view = 'backlog';

  function emptyState() { return { stories: [], sprints: [], nextStoryId: 1, nextSprintId: 1, activity: {} }; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const data = Object.assign(emptyState(), saved);
        if (!saved.activity) { // data saved before streaks existed: rebuild from finished stories
          data.activity = {};
          data.stories.forEach(st => { if (st.status === 'done' && st.doneAt) data.activity[st.doneAt] = (data.activity[st.doneAt] || 0) + 1; });
        }
        return data;
      }
    } catch (e) { /* ignore corrupt data */ }
    return seed();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }

  /* ---------- date helpers (all dates are yyyy-mm-dd, local time) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => fmt(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const niceDate = s => parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /* ---------- sample data ---------- */
  function seed() {
    const s = emptyState();
    const start = addDays(today(), -4);
    s.sprints.push({ id: 1, name: 'Sprint 1', goal: 'Users can sign up and log in', start, end: addDays(start, 13), state: 'active' });
    s.nextSprintId = 2;
    const add = (title, who, want, why, points, priority, status, sprintId, doneOffset) => {
      s.stories.push({
        id: s.nextStoryId++, title, who, want, why, points, priority, status, sprintId,
        doneAt: status === 'done' ? addDays(today(), doneOffset || 0) : null,
      });
      if (status === 'done') { const d = addDays(today(), doneOffset || 0); s.activity[d] = (s.activity[d] || 0) + 1; }
    };
    add('Sign-up form', 'new visitor', 'create an account with my email', 'I can save my work', 5, 'high', 'done', 1, -2);
    add('Login page', 'registered user', 'log in with email and password', 'I can see my tasks', 3, 'high', 'inprogress', 1);
    add('Password reset', 'registered user', 'reset my password by email', 'I can recover my account', 5, 'medium', 'todo', 1);
    add('Profile page', 'registered user', 'edit my display name', 'teammates recognise me', 2, 'low', 'todo', 1);
    add('Create tasks', 'team member', 'add a task with a title and due date', 'nothing gets forgotten', 5, 'high', 'backlog', null);
    add('Assign tasks', 'team lead', 'assign a task to a teammate', 'everyone knows what to do', 3, 'medium', 'backlog', null);
    add('Task comments', 'team member', 'comment on a task', 'we can discuss it in one place', 3, 'low', 'backlog', null);
    add('Email reminders', 'team member', 'get a reminder before a due date', 'I do not miss deadlines', 8, 'medium', 'backlog', null);
    // a little earlier history so the streak has something to show on first run
    s.activity[addDays(today(), -3)] = 1;
    s.activity[addDays(today(), -1)] = 1;
    return s;
  }

  /* ---------- small utilities ---------- */
  const esc = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const byId = (list, id) => list.find(x => x.id === Number(id));
  const sum = list => list.reduce((t, s) => t + s.points, 0);
  const activeSprint = () => state.sprints.find(s => s.state === 'active');
  const sprintStories = id => state.stories.filter(s => s.sprintId === id);
  const sortStories = list => [...list].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id - b.id);

  /* ---------- daily streak ----------
     A day counts when at least one story is moved to Done. Weekends never break
     a streak (they only add to it if work was finished). Today is not counted as
     missed until it is over, so a streak stays alive while the day is in progress. */
  const isWeekend = d => [0, 6].includes(parse(d).getDay());
  const isActiveDay = d => (state.activity[d] || 0) > 0;

  function logDone(date, delta) {
    if (!date) return;
    const n = (state.activity[date] || 0) + delta;
    if (n > 0) state.activity[date] = n; else delete state.activity[date];
  }
  const leaveDone = s => { if (s.status === 'done') logDone(s.doneAt, -1); };

  function streakInfo() {
    const t = today();
    const doneToday = isActiveDay(t);
    let current = 0;
    let d = doneToday ? t : addDays(t, -1);
    for (let i = 0; i < 1000; i++) {
      if (isActiveDay(d)) current++;
      else if (!isWeekend(d)) break;
      d = addDays(d, -1);
    }
    let best = 0, run = 0;
    const dates = Object.keys(state.activity).sort();
    if (dates.length) {
      for (let x = dates[0]; x <= t; x = addDays(x, 1)) {
        if (isActiveDay(x)) { run++; best = Math.max(best, run); }
        else if (!isWeekend(x) && x !== t) run = 0;
      }
    }
    return { current, best: Math.max(best, current), doneToday };
  }

  function storyText(s) {
    if (!s.who && !s.want) return '';
    return `As a ${esc(s.who || '…')}, I want to ${esc(s.want || '…')}${s.why ? `, so that ${esc(s.why)}` : ''}.`;
  }

  state = load();

  /* ---------- rendering ---------- */
  function render() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
    ({ backlog: renderBacklog, board: renderBoard, sprints: renderSprints })[view]();
    save();
  }

  /* Backlog */
  function renderBacklog() {
    const items = sortStories(state.stories.filter(s => s.status === 'backlog'));
    const open = state.sprints.filter(s => s.state !== 'completed');
    const rows = items.map(s => `
      <article class="story-row ${s.priority}">
        <div>
          <div class="story-title">${esc(s.title)}</div>
          <div class="story-text">${storyText(s)}</div>
        </div>
        <div class="story-meta">
          <span class="tag">${s.priority} priority</span>
          <span class="pts" title="Story points">${s.points}</span>
          <button class="btn small" data-action="edit" data-id="${s.id}">Edit</button>
          ${open.length ? `
          <select class="small" data-action="assign" data-id="${s.id}" aria-label="Add ${esc(s.title)} to a sprint">
            <option value="">Add to sprint…</option>
            ${open.map(sp => `<option value="${sp.id}">${esc(sp.name)}${sp.state === 'active' ? ' (active)' : ''}</option>`).join('')}
          </select>` : ''}
        </div>
      </article>`).join('');

    $('#view-backlog').innerHTML = `
      <div class="page-head">
        <div>
          <h2>Product backlog</h2>
          <p>${items.length} ${items.length === 1 ? 'story' : 'stories'} waiting, ${sum(items)} points in total. Highest priority first.</p>
        </div>
      </div>
      <details class="glossary">
        <summary>Agile terms used in this app</summary>
        <dl>
          <dt>User story</dt><dd>A small feature written from the user's point of view: "As a… I want to… so that…".</dd>
          <dt>Story points</dt><dd>A relative estimate of effort. Bigger number, more work or more uncertainty.</dd>
          <dt>Backlog</dt><dd>The ordered list of everything the team might build.</dd>
          <dt>Sprint</dt><dd>A fixed time box (usually 1 to 4 weeks) in which the team finishes a chosen set of stories.</dd>
          <dt>Kanban board</dt><dd>Columns that show the state of work: To Do, In Progress, Done.</dd>
          <dt>Burndown chart</dt><dd>Remaining points over time, compared with a straight "ideal" line to the end of the sprint.</dd>
          <dt>Velocity</dt><dd>Points the team completed in past sprints. Use it to plan the next one.</dd>
        </dl>
      </details>
      ${rows ? `<div class="story-list">${rows}</div>` : `<div class="empty">The backlog is empty. Select "New user story" to add your first one.</div>`}
    `;
  }

  function streakPanel() {
    const { current, best, doneToday } = streakInfo();
    const t = today();
    const todayCount = state.activity[t] || 0;
    const dots = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(t, -i);
      const n = state.activity[d] || 0;
      const cls = n ? 'hit' : isWeekend(d) ? 'off' : i === 0 ? 'pending' : 'miss';
      const tip = n ? `${n} ${n === 1 ? 'story' : 'stories'} done` : isWeekend(d) ? 'weekend' : i === 0 ? 'not yet today' : 'no story done';
      dots.push(`<span class="dot ${cls}" title="${niceDate(d)}: ${tip}"></span>`);
    }
    const msg = !current && !doneToday ? 'Finish a story today to start a streak.'
      : !doneToday ? `Finish a story today to keep your ${current}-day streak alive.`
      : current > 1 && current >= best ? `${todayCount} ${todayCount === 1 ? 'story' : 'stories'} done today. This is your best streak yet.`
      : `${todayCount} ${todayCount === 1 ? 'story' : 'stories'} done today. Streak is safe for today.`;
    return `
      <div class="streak ${current ? 'lit' : ''}">
        <div class="streak-main">
          <span class="streak-flame" aria-hidden="true">🔥</span>
          <div><div class="streak-count">${current}</div><div class="streak-unit">day streak</div></div>
        </div>
        <div class="streak-body">
          <p class="streak-msg">${msg}</p>
          <div class="dots" role="img" aria-label="Last 14 days of activity">${dots.join('')}</div>
          <p class="streak-rule">A day counts when a story is moved to Done. Weekends never break the streak.</p>
        </div>
        <div class="streak-best"><b>${best}</b><span>best streak</span></div>
      </div>`;
  }

  /* Board */
  function renderBoard() {
    const sp = activeSprint();
    if (!sp) {
      $('#view-board').innerHTML = `
        <div class="page-head"><div><h2>Sprint board</h2></div></div>
        ${streakPanel()}
        <div class="empty">No sprint is running. Go to <button class="link" data-action="goto" data-view="sprints">Sprints</button>, plan one, and start it.</div>`;
      return;
    }
    const stories = sprintStories(sp.id);
    const total = sum(stories);
    const done = sum(stories.filter(s => s.status === 'done'));
    const pct = total ? Math.round(done / total * 100) : 0;
    const left = daysBetween(today(), sp.end);
    const timeLabel = left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : left === 0 ? 'Ends today' : `${-left} day${left === -1 ? '' : 's'} past end date`;

    const cols = COLUMNS.map((c, i) => {
      const list = sortStories(stories.filter(s => s.status === c.id));
      return `
        <section class="column" data-status="${c.id}" aria-label="${c.label}">
          <div class="column-head"><span>${c.label}</span><span class="count">${list.length} · ${sum(list)} pts</span></div>
          <div class="cards">
            ${list.map(s => `
              <article class="card ${s.priority}" draggable="true" data-id="${s.id}">
                <div class="story-title">${esc(s.title)}</div>
                <div class="story-text">${storyText(s)}</div>
                <div class="card-foot">
                  <span class="pts" title="Story points">${s.points}</span>
                  <div class="card-actions">
                    ${i > 0 ? `<button class="btn small" data-action="move" data-dir="-1" data-id="${s.id}" aria-label="Move ${esc(s.title)} to ${COLUMNS[i - 1].label}">←</button>` : ''}
                    <button class="btn small" data-action="edit" data-id="${s.id}">Edit</button>
                    ${i < 2 ? `<button class="btn small" data-action="move" data-dir="1" data-id="${s.id}" aria-label="Move ${esc(s.title)} to ${COLUMNS[i + 1].label}">→</button>` : ''}
                  </div>
                </div>
              </article>`).join('')}
          </div>
        </section>`;
    }).join('');

    $('#view-board').innerHTML = `
      ${streakPanel()}
      <div class="sprint-banner">
        <div class="banner-top">
          <div>
            <h2>${esc(sp.name)}</h2>
            <p class="goal">Goal: ${esc(sp.goal) || 'not set'}</p>
          </div>
          <div class="sprint-actions">
            <span class="tag">${niceDate(sp.start)} to ${niceDate(sp.end)} · ${timeLabel}</span>
            <button class="btn small" data-action="complete-sprint" data-id="${sp.id}">Complete sprint</button>
          </div>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <div class="progress-label"><span>${done} of ${total} points done</span><span>${pct}%</span></div>
      </div>
      ${total === 0 ? `<div class="empty">This sprint has no stories yet. Add some from the <button class="link" data-action="goto" data-view="backlog">Backlog</button>.</div>` : `<div class="board">${cols}</div>${burndown(sp, stories, total)}`}
    `;
  }

  function burndown(sp, stories, total) {
    const days = Math.max(daysBetween(sp.start, sp.end), 1);
    const W = 640, H = 240, L = 44, R = 16, T = 12, B = 34;
    const x = i => L + (i / days) * (W - L - R);
    const y = v => T + (1 - v / total) * (H - T - B);
    const t = today();
    const lastDay = Math.min(daysBetween(sp.start, t), days);
    const pts = [];
    for (let i = 0; i <= lastDay; i++) {
      const date = addDays(sp.start, i);
      const donePts = sum(stories.filter(s => s.status === 'done' && s.doneAt && s.doneAt <= date));
      pts.push(`${x(i).toFixed(1)},${y(total - donePts).toFixed(1)}`);
    }
    const actual = lastDay >= 0 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#2f8a4f" stroke-width="3" stroke-linejoin="round"/>` : '';
    return `
      <div class="panel">
        <h3>Burndown</h3>
        <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown chart: remaining story points per day versus the ideal line">
          <line x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}" stroke="#d5dbe3"/>
          <line x1="${L}" y1="${T}" x2="${L}" y2="${y(0)}" stroke="#d5dbe3"/>
          <line x1="${x(0)}" y1="${y(total)}" x2="${x(days)}" y2="${y(0)}" stroke="#5d6877" stroke-width="2" stroke-dasharray="6 5"/>
          ${actual}
          <text x="${L - 8}" y="${y(total) + 4}" text-anchor="end" font-size="12" fill="#5d6877">${total}</text>
          <text x="${L - 8}" y="${y(0) + 4}" text-anchor="end" font-size="12" fill="#5d6877">0</text>
          <text x="${L}" y="${H - 10}" font-size="12" fill="#5d6877">${niceDate(sp.start)}</text>
          <text x="${W - R}" y="${H - 10}" text-anchor="end" font-size="12" fill="#5d6877">${niceDate(sp.end)}</text>
        </svg>
        <div class="legend"><span><i></i>Remaining points</span><span><i class="ideal"></i>Ideal pace</span></div>
      </div>`;
  }

  /* Sprints */
  function renderSprints() {
    const completed = state.sprints.filter(s => s.state === 'completed');
    const velocity = completed.length ? Math.round(completed.reduce((t, s) => t + (s.completedPoints || 0), 0) / completed.length * 10) / 10 : null;
    const order = { active: 0, planned: 1, completed: 2 };
    const list = [...state.sprints].sort((a, b) => order[a.state] - order[b.state] || b.id - a.id);

    const cards = list.map(sp => {
      const stories = sp.state === 'completed' ? sprintStories(sp.id) : sortStories(sprintStories(sp.id));
      const body = sp.state === 'completed'
        ? `<p class="tag">Committed ${sp.committed ?? 0} pts, completed ${sp.completedPoints ?? 0} pts.</p>`
        : '';
      const items = stories.length
        ? `<ul class="mini-list">${stories.map(s => `
            <li>
              <span>${esc(s.title)} <span class="tag">${s.status === 'backlog' ? '' : COLUMNS.find(c => c.id === s.status)?.label || ''}</span></span>
              <span class="story-meta"><span class="pts">${s.points}</span>
              ${sp.state === 'completed' ? '' : `<button class="btn small" data-action="unassign" data-id="${s.id}">Remove</button>`}</span>
            </li>`).join('')}</ul>`
        : `<p class="tag">${sp.state === 'completed' ? 'No stories were finished in this sprint.' : 'No stories yet. Add some from the Backlog.'}</p>`;
      const actions = sp.state === 'planned'
        ? `<button class="btn small primary" data-action="start-sprint" data-id="${sp.id}">Start sprint</button>
           <button class="btn small danger" data-action="delete-sprint" data-id="${sp.id}">Delete</button>`
        : sp.state === 'active'
          ? `<button class="btn small" data-action="goto" data-view="board">Open board</button>
             <button class="btn small" data-action="complete-sprint" data-id="${sp.id}">Complete sprint</button>`
          : '';
      return `
        <article class="sprint-card">
          <header>
            <div>
              <h3>${esc(sp.name)}<span class="state ${sp.state}">${sp.state}</span></h3>
              <div class="tag">${niceDate(sp.start)} to ${niceDate(sp.end)} · ${sum(stories)} pts · Goal: ${esc(sp.goal) || 'not set'}</div>
            </div>
            <div class="sprint-actions">${actions}</div>
          </header>
          ${body}${items}
        </article>`;
    }).join('');

    $('#view-sprints').innerHTML = `
      <div class="page-head">
        <div><h2>Sprints</h2><p>Plan a sprint, start it, then complete it to see your velocity.</p></div>
        <button class="btn primary" data-action="new-sprint">New sprint</button>
      </div>
      <div class="stats">
        <div class="stat"><b>${state.sprints.length}</b><span>Sprints</span></div>
        <div class="stat"><b>${completed.length}</b><span>Completed</span></div>
        <div class="stat"><b>${velocity === null ? '–' : velocity}</b><span>Average velocity (pts per sprint)</span></div>
      </div>
      ${cards || `<div class="empty">No sprints yet. Select "New sprint" to plan your first one.</div>`}
    `;
  }

  /* ---------- actions ---------- */
  function moveStory(id, status) {
    const s = byId(state.stories, id);
    if (!s || s.status === status) return;
    leaveDone(s);
    s.status = status;
    s.doneAt = status === 'done' ? today() : null;
    if (status === 'done') logDone(s.doneAt, 1);
    render();
  }

  function assign(id, sprintId) {
    const s = byId(state.stories, id);
    if (!s) return;
    leaveDone(s);
    s.sprintId = Number(sprintId);
    s.status = 'todo';
    s.doneAt = null;
    render();
  }

  function unassign(id) {
    const s = byId(state.stories, id);
    if (!s) return;
    leaveDone(s);
    s.sprintId = null; s.status = 'backlog'; s.doneAt = null;
    render();
  }

  function startSprint(id) {
    const sp = byId(state.sprints, id);
    if (activeSprint()) { alert('Another sprint is already active. Complete it before starting a new one.'); return; }
    if (!sprintStories(sp.id).length && !confirm('This sprint has no stories. Start it anyway?')) return;
    sp.state = 'active';
    view = 'board';
    render();
  }

  function completeSprint(id) {
    const sp = byId(state.sprints, id);
    const stories = sprintStories(sp.id);
    const open = stories.filter(s => s.status !== 'done');
    const msg = open.length
      ? `Complete ${sp.name}? ${open.length} unfinished ${open.length === 1 ? 'story goes' : 'stories go'} back to the backlog.`
      : `Complete ${sp.name}?`;
    if (!confirm(msg)) return;
    sp.committed = sum(stories);
    sp.completedPoints = sum(stories.filter(s => s.status === 'done'));
    open.forEach(s => { s.sprintId = null; s.status = 'backlog'; s.doneAt = null; });
    sp.state = 'completed';
    view = 'sprints';
    render();
  }

  function deleteSprint(id) {
    const sp = byId(state.sprints, id);
    if (!confirm(`Delete ${sp.name}? Its stories return to the backlog.`)) return;
    sprintStories(sp.id).forEach(s => { leaveDone(s); s.sprintId = null; s.status = 'backlog'; s.doneAt = null; });
    state.sprints = state.sprints.filter(x => x.id !== sp.id);
    render();
  }

  /* ---------- dialogs ---------- */
  const storyDialog = $('#story-dialog');
  const storyForm = $('#story-form');
  const sprintDialog = $('#sprint-dialog');
  const sprintForm = $('#sprint-form');
  let editingId = null;

  storyForm.elements.points.innerHTML = POINTS.map(p => `<option value="${p}">${p}</option>`).join('');

  function openStory(id) {
    editingId = id || null;
    const s = id ? byId(state.stories, id) : { title: '', who: '', want: '', why: '', points: 3, priority: 'medium' };
    $('#story-dialog-title').textContent = id ? 'Edit user story' : 'New user story';
    for (const k of ['title', 'who', 'want', 'why', 'points', 'priority']) storyForm.elements[k].value = s[k];
    $('#story-delete').hidden = !id;
    $('#story-error').hidden = true;
    storyDialog.showModal();
    storyForm.elements.title.focus();
  }

  storyForm.addEventListener('submit', e => {
    e.preventDefault();
    const f = storyForm.elements;
    const title = f.title.value.trim();
    if (!title) { $('#story-error').hidden = false; f.title.focus(); return; }
    const data = {
      title, who: f.who.value.trim(), want: f.want.value.trim(), why: f.why.value.trim(),
      points: Number(f.points.value), priority: f.priority.value,
    };
    if (editingId) Object.assign(byId(state.stories, editingId), data);
    else state.stories.push({ id: state.nextStoryId++, ...data, status: 'backlog', sprintId: null, doneAt: null });
    storyDialog.close();
    render();
  });
  $('#story-cancel').addEventListener('click', () => storyDialog.close());
  $('#story-delete').addEventListener('click', () => {
    if (!confirm('Delete this story? This cannot be undone.')) return;
    const gone = byId(state.stories, editingId);
    if (gone) leaveDone(gone);
    state.stories = state.stories.filter(s => s.id !== editingId);
    storyDialog.close();
    render();
  });

  function openSprint() {
    const f = sprintForm.elements;
    const last = [...state.sprints].sort((a, b) => b.end.localeCompare(a.end))[0];
    const start = last && last.end >= today() ? addDays(last.end, 1) : today();
    f.name.value = `Sprint ${state.nextSprintId}`;
    f.goal.value = '';
    f.start.value = start;
    f.end.value = addDays(start, 13);
    $('#sprint-error').hidden = true;
    sprintDialog.showModal();
    f.name.focus();
  }

  sprintForm.addEventListener('submit', e => {
    e.preventDefault();
    const f = sprintForm.elements;
    const err = $('#sprint-error');
    const name = f.name.value.trim();
    if (!name || !f.start.value || !f.end.value) { err.textContent = 'Fill in the name, start date, and end date.'; err.hidden = false; return; }
    if (f.end.value <= f.start.value) { err.textContent = 'The end date must be after the start date.'; err.hidden = false; return; }
    state.sprints.push({ id: state.nextSprintId++, name, goal: f.goal.value.trim(), start: f.start.value, end: f.end.value, state: 'planned' });
    sprintDialog.close();
    view = 'sprints';
    render();
  });
  $('#sprint-cancel').addEventListener('click', () => sprintDialog.close());

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) { view = tab.dataset.view; render(); return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT') return;
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'edit': openStory(Number(id)); break;
      case 'move': {
        const s = byId(state.stories, id);
        const i = COLUMNS.findIndex(c => c.id === s.status) + Number(el.dataset.dir);
        if (COLUMNS[i]) moveStory(id, COLUMNS[i].id);
        break;
      }
      case 'unassign': unassign(id); break;
      case 'new-sprint': openSprint(); break;
      case 'start-sprint': startSprint(id); break;
      case 'complete-sprint': completeSprint(id); break;
      case 'delete-sprint': deleteSprint(id); break;
      case 'goto': view = el.dataset.view; render(); break;
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.action === 'assign' && el.value) assign(el.dataset.id, el.value);
  });

  /* drag and drop between columns */
  let dragId = null;
  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  document.addEventListener('dragend', e => {
    const card = e.target.closest && e.target.closest('.card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.column.over').forEach(c => c.classList.remove('over'));
  });
  document.addEventListener('dragover', e => {
    const col = e.target.closest('.column');
    if (!col || dragId === null) return;
    e.preventDefault();
    document.querySelectorAll('.column.over').forEach(c => { if (c !== col) c.classList.remove('over'); });
    col.classList.add('over');
  });
  document.addEventListener('drop', e => {
    const col = e.target.closest('.column');
    if (!col || dragId === null) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    moveStory(id, col.dataset.status);
  });

  /* footer + header buttons */
  $('#new-story').addEventListener('click', () => openStory());
  $('#load-sample').addEventListener('click', () => {
    if (!confirm('Replace all current data with the sample project?')) return;
    state = seed(); view = 'board'; render();
  });
  $('#reset-all').addEventListener('click', () => {
    if (!confirm('Delete all stories and sprints? This cannot be undone.')) return;
    state = emptyState(); view = 'backlog'; render();
  });
  $('#export-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sprintboard-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* Build info: nginx serves /version.json inside the Docker image (written by the CI pipeline).
     When the app is opened as a plain file this request fails quietly and nothing is shown. */
  try {
    fetch('version.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(v => { if (v && v.commit) $('#build-info').textContent = `Build ${String(v.commit).slice(0, 7)}`; })
      .catch(() => {});
  } catch (e) { /* fetch unavailable */ }

  render();
})();
