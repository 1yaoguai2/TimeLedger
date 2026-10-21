/**
 * 应用主逻辑
 */
(function () {
  'use strict';

  const S = window.Store;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* 运行时状态（不持久化） */
  const rt = {
    view: 'timer',
    period: 'week',
    editTaskId: null,
    pickEmoji: '📘',
    pickColor: COLOR_PALETTE[0],
    tick: null,
    lastNotify: {} // taskId -> dayKey，避免同一天反复提醒
  };

  /* ============================================================
   *  通用 UI
   * ============================================================ */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => {
      const m = el.closest('.modal');
      if (m) m.hidden = true;
    });
  });

  function switchView(v) {
    rt.view = v;
    $$('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'stats') renderStats();
    if (v === 'settings') renderSettings();
    if (v === 'timer') renderTasks();
    window.scrollTo(0, 0);
  }

  /* ============================================================
   *  计时核心
   * ============================================================ */
  function elapsedOf(run, now) {
    const ref = run.pauseStart != null ? run.pauseStart : now;
    return Math.max(0, ref - run.start - (run.pausedMs || 0));
  }

  function isPaused(run) { return run.pauseStart != null; }

  function startTask(taskId) {
    const run = S.getRunning();
    const now = Date.now();

    if (run && run.taskId === taskId) {
      if (isPaused(run)) { resumeTimer(); }
      else { toast('该事件正在计时中'); }
      return;
    }
    if (run) {
      stopTimer(true); // 切换事件时自动结束上一个
    }
    const t = S.getTask(taskId);
    if (!t) return;

    const st = S.getSettings();
    const newRun = { taskId, start: now, pausedMs: 0, pauseStart: null };
    if (st.pomodoro) {
      newRun.pomo = { phase: 'work', phaseStart: now, done: 0 };
    }
    S.setRunning(newRun);
    toast('开始：' + t.name);
    renderAll();
  }

  function pauseTimer() {
    const run = S.getRunning();
    if (!run || isPaused(run)) return;
    run.pauseStart = Date.now();
    S.setRunning(run);
    toast('已暂停');
    renderAll();
  }

  function resumeTimer() {
    const run = S.getRunning();
    if (!run || !isPaused(run)) return;
    const now = Date.now();
    const delta = now - run.pauseStart;
    run.pausedMs = (run.pausedMs || 0) + delta;
    run.pauseStart = null;
    // 番茄钟相位时钟跟着冻结
    if (run.pomo) run.pomo.phaseStart += delta;
    S.setRunning(run);
    toast('继续计时');
    renderAll();
  }

  function stopTimer(silent) {
    const run = S.getRunning();
    if (!run) return;
    const now = Date.now();
    const dur = elapsedOf(run, now);
    if (dur >= 1000) {
      S.addRecord({
        taskId: run.taskId,
        start: run.start,
        end: now,
        duration: dur,
        source: 'timer'
      });
      if (!silent) {
        const t = S.getTask(run.taskId);
        toast('已记录 ' + (t ? t.name : '') + ' · ' + fmtDur(dur));
      }
    } else if (!silent) {
      toast('时长过短，未记录');
    }
    S.setRunning(null);
    renderAll();
  }

  /* 每秒 tick */
  function tick() {
    const run = S.getRunning();
    if (!run) return;
    const now = Date.now();

    // 番茄钟相位推进
    if (run.pomo && !isPaused(run)) {
      const st = S.getSettings();
      const phaseMs = (run.pomo.phase === 'work' ? st.workMin : st.breakMin) * 60000;
      const used = now - run.pomo.phaseStart;
      if (used >= phaseMs) {
        if (run.pomo.phase === 'work') {
          run.pomo.done += 1;
          run.pomo.phase = 'break';
          run.pomo.phaseStart = now;
          notify('番茄钟', `完成第 ${run.pomo.done} 个番茄，休息 ${st.breakMin} 分钟`);
          if (run.pomo.done >= st.rounds) {
            run.pomo.done = 0;
          }
        } else {
          run.pomo.phase = 'work';
          run.pomo.phaseStart = now;
          notify('番茄钟', `休息结束，开始工作 ${st.workMin} 分钟`);
        }
        S.setRunning(run);
      }
    }
    paintRunning(now);
    paintTodayTotal(now);
    paintTaskLive(now);
  }

  /* ============================================================
   *  渲染：计时页
   * ============================================================ */
  function renderAll() {
    renderHeader();
    renderTasks();
    paintRunning(Date.now());
    renderTodayList();
    paintTodayTotal(Date.now());
  }

  function renderHeader() {
    const d = new Date();
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    $('#headerDate').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${wd}`;
  }

  function todayMsOf(taskId, now) {
    const from = startOfDay(now);
    const run = S.getRunning();
    let base = 0;
    S.recordsOfTask(taskId).forEach(r => {
      const s = Math.max(r.start, from);
      const e = Math.min(r.end, now);
      if (e > s) {
        const span = r.end - r.start;
        base += span > 0 ? r.duration * ((e - s) / span) : r.duration;
      }
    });
    if (run && run.taskId === taskId) base += elapsedOf(run, now);
    return base;
  }

  function renderTasks() {
    const grid = $('#taskGrid');
    const tasks = S.listTasks();
    const run = S.getRunning();
    const now = Date.now();

    if (!tasks.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">还没有事件，点击右上角「+ 新增」</div>';
      return;
    }
    grid.innerHTML = tasks.map(t => {
      const today = todayMsOf(t.id, now);
      const week = aggregateByTask(S, startOfWeek(now), now + 1)
        .filter(x => x.taskId === t.id).reduce((s, x) => s + x.ms, 0);
      const target = t.targetHours * 3600000;
      const pct = target > 0 ? Math.min(100, (week / target) * 100) : 0;
      const active = run && run.taskId === t.id;
      return `<div class="task-card ${active ? 'active' : ''}" data-task="${t.id}" style="color:${t.color}">
        <div class="task-card-top">
          <div class="task-emoji" style="background:${hexAlpha(t.color, .13)}">${t.emoji}</div>
          <div class="task-name" style="color:var(--text)">${escapeHtml(t.name)}</div>
        </div>
        <div class="task-dur" data-live="${t.id}">
          今日 ${fmtDur(today)}${active ? ' · <span class="task-live">进行中</span>' : ''}
        </div>
        ${target > 0 ? `<div class="task-bar"><i style="width:${pct}%;background:${t.color}"></i></div>` : ''}
      </div>`;
    }).join('');

    grid.querySelectorAll('[data-task]').forEach(card => {
      card.addEventListener('click', () => {
        const run2 = S.getRunning();
        if (run2 && run2.taskId === card.dataset.task && !isPaused(run2)) switchView('timer');
        startTask(card.dataset.task);
      });
    });
  }

  function paintTaskLive(now) {
    const run = S.getRunning();
    S.listTasks().forEach(t => {
      const el = document.querySelector(`[data-live="${t.id}"]`);
      if (!el) return;
      const active = run && run.taskId === t.id;
      const ms = todayMsOf(t.id, now);
      const isP = active && isPaused(run);
      el.innerHTML = `今日 ${fmtDur(ms)}${active ? ` · <span class="task-live">${isP ? '已暂停' : '进行中'}</span>` : ''}`;
    });
  }

  function paintRunning(now) {
    const run = S.getRunning();
    const rc = $('#runningCard'), ic = $('#idleCard');
    if (!run) { rc.hidden = true; ic.hidden = false; $('#pomoToggle').checked = S.getSettings().pomodoro; return; }
    rc.hidden = false; ic.hidden = true;

    const t = S.getTask(run.taskId);
    const ms = elapsedOf(run, now);
    const paused = isPaused(run);

    $('#runDot').className = 'pulse-dot' + (paused ? ' paused' : '');
    $('#runName').textContent = (t ? t.emoji + ' ' + t.name : '已删除的事件');
    $('#runSince').textContent = '开始于 ' + fmtClock(run.start);
    $('#runTime').textContent = fmtDurLong(ms);
    $('#btnPause').textContent = paused ? '继续' : '暂停';

    const st = S.getSettings();
    let sub = paused ? '已暂停计时' : `已计入今日 ${fmtDur(todayMsOf(run.taskId, now))}`;
    if (run.pomo) {
      const phaseMs = (run.pomo.phase === 'work' ? st.workMin : st.breakMin) * 60000;
      const left = Math.max(0, phaseMs - (now - run.pomo.phaseStart));
      const label = run.pomo.phase === 'work' ? '专注中' : '休息中';
      sub = `番茄 ${run.pomo.done + 1}/${st.rounds} · ${label} · 剩余 ${pad2(Math.floor(left / 60000))}:${pad2(Math.floor((left % 60000) / 1000))}`;
    }
    $('#runSub').textContent = sub;
  }

  function paintTodayTotal(now) {
    const from = startOfDay(now);
    $('#todayTotal').textContent = '共 ' + fmtDur(totalIn(S, from, now + 1));
  }

  function renderTodayList() {
    const list = $('#todayList');
    const now = Date.now();
    const from = startOfDay(now);
    const items = recordsOfDay(S, from);
    const run = S.getRunning();

    let html = '';
    if (run) {
      const t = S.getTask(run.taskId);
      const dur = elapsedOf(run, now);
      html += `<div class="record-item">
        <span class="rec-dot" style="background:${t ? t.color : '#9ca3af'}"></span>
        <div class="rec-main">
          <div class="rec-name">${escapeHtml(t ? t.name : '已删除')}
            <span class="rec-live-tag">${isPaused(run) ? '暂停' : '进行中'}</span></div>
          <div class="rec-sub">${fmtClock(run.start)} - 现在</div>
        </div>
        <div class="rec-dur" data-live-dur>${fmtDur(dur)}</div>
      </div>`;
    }

    const past = items.slice();
    past.sort((a, b) => b.end - a.end);
    html += past.map(r => `<div class="record-item">
      <span class="rec-dot" style="background:${r.color}"></span>
      <div class="rec-main">
        <div class="rec-name">${escapeHtml(r.name)}</div>
        <div class="rec-sub">${fmtClock(r.start)} - ${fmtClock(r.end)}${r.note ? ' · ' + escapeHtml(r.note) : ''}${r.source === 'manual' ? ' · 补录' : ''}</div>
      </div>
      <div class="rec-dur">${fmtDur(r.duration)}</div>
      <button class="rec-del" data-del="${r.id}" title="删除">✕</button>
    </div>`).join('');

    if (!html) html = '<div class="empty">今天还没有记录，选一个事件开始吧</div>';
    list.innerHTML = html;

    list.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        if (confirm('删除这条记录？')) {
          S.deleteRecord(b.dataset.del);
          renderAll();
        }
      });
    });
  }

  /* ============================================================
   *  渲染：统计页
   * ============================================================ */
  function periodRange(period, ref) {
    const d = new Date(ref);
    if (period === 'day') {
      const from = startOfDay(d);
      return { from, to: from + 86400000 };
    }
    if (period === 'week') {
      const from = startOfWeek(d);
      return { from, to: from + 7 * 86400000 };
    }
    const from = startOfMonth(d);
    const n = new Date(from);
    n.setMonth(n.getMonth() + 1);
    return { from, to: n.getTime() };
  }

  function prevRange(period, range) {
    if (period === 'day') return { from: range.from - 86400000, to: range.from };
    if (period === 'week') return { from: range.from - 7 * 86400000, to: range.from };
    const d = new Date(range.from);
    d.setMonth(d.getMonth() - 1);
    return { from: d.getTime(), to: range.from };
  }

  function renderStats() {
    const now = Date.now();
    const period = rt.period;
    const range = periodRange(period, now);
    const prev = prevRange(period, range);

    const segs = aggregateByTask(S, range.from, Math.min(range.to, now + 1));
    const total = segs.reduce((s, x) => s + x.ms, 0);
    const prevTotal = totalIn(S, prev.from, prev.to);

    /* ---- 概览卡 ---- */
    const label = { day: '今日', week: '本周', month: '本月' }[period];
    const activeDays = dailyTotals(S, range.from, Math.min(range.to, now + 1)).filter(x => x.ms > 0).length;
    const avg = period === 'day' ? total : (activeDays ? total / activeDays : 0);
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : (total > 0 ? null : 0);
    let deltaHtml;
    if (delta === null) deltaHtml = '<div class="sum-delta flat">上期无记录</div>';
    else if (delta === 0) deltaHtml = '<div class="sum-delta flat">与上期持平</div>';
    else deltaHtml = `<div class="sum-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}% 较上期</div>`;

    $('#statSummary').innerHTML = `
      <div class="sum-item">
        <div class="sum-label">${label}总时长</div>
        <div class="sum-value">${fmtDur(total)}</div>
        ${deltaHtml}
      </div>
      <div class="sum-item">
        <div class="sum-label">${period === 'day' ? '记录条数' : '日均（有记录日）'}</div>
        <div class="sum-value">${period === 'day'
          ? segs.length + ' 条'
          : fmtDur(avg)}</div>
        <div class="sum-delta flat">${period === 'day' ? (segs.length ? '最专注：' + escapeHtml(segs[0].name) : '—')
          : '有效天数 ' + activeDays + ' 天'}</div>
      </div>`;

    /* ---- 环形图 ---- */
    renderDonut($('#donutWrap'), segs, fmtDur(total), segs.length ? segs[0].name + '最多' : '暂无记录');
    $('#donutMeta').textContent = segs.length + ' 个事件';
    $('#legend').innerHTML = segs.length ? segs.map(s => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${s.color}"></span>
        <span class="legend-name">${s.emoji} ${escapeHtml(s.name)}</span>
        <span class="legend-pct">${total ? ((s.ms / total) * 100).toFixed(0) : 0}%</span>
        <span class="legend-dur">${fmtDur(s.ms)}</span>
      </div>`).join('') : '<div class="empty">本期暂无记录</div>';

    /* ---- 趋势柱状图 ---- */
    renderTrend(period, now);

    /* ---- 每日时间线 ---- */
    renderTimelineCard(period, range, now);

    /* ---- 目标进度 ---- */
    renderGoals(now);
  }

  function renderTrend(period, now) {
    let cols = [];
    if (period === 'day') {
      const today = startOfDay(now);
      for (let i = 6; i >= 0; i--) {
        const from = today - i * 86400000;
        cols.push(buildCol(from, from + 86400000, ['日', '一', '二', '三', '四', '五', '六'][new Date(from).getDay()], i === 0));
      }
      $('#trendMeta').textContent = '最近 7 天';
    } else if (period === 'week') {
      const thisWeek = startOfWeek(now);
      for (let i = 5; i >= 0; i--) {
        const from = thisWeek - i * 7 * 86400000;
        cols.push(buildCol(from, from + 7 * 86400000, `${new Date(from).getMonth() + 1}/${new Date(from).getDate()}`, i === 0));
      }
      $('#trendMeta').textContent = '最近 6 周';
    } else {
      const thisMonth = startOfMonth(now);
      for (let i = 5; i >= 0; i--) {
        const d = new Date(thisMonth);
        d.setMonth(d.getMonth() - i);
        const from = d.getTime();
        const e = new Date(d); e.setMonth(e.getMonth() + 1);
        cols.push(buildCol(from, e.getTime(), `${d.getMonth() + 1}月`, i === 0));
      }
      $('#trendMeta').textContent = '最近 6 个月';
    }
    renderBars($('#trendBars'), cols);

    function buildCol(from, to, lab, current) {
      const segs = aggregateByTask(S, from, to);
      const total = segs.reduce((s, x) => s + x.ms, 0);
      return { label: lab, total, current, segs: segs.map(x => ({ color: x.color, ms: x.ms })) };
    }
  }

  function renderTimelineCard(period, range, now) {
    const cap = Math.min(range.to, now + 1);
    let days = dailyTotals(S, range.from, cap).filter(x => x.ms > 0);
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    let rows = days.map(x => {
      const d = new Date(x.dayStart);
      const items = recordsOfDay(S, x.dayStart);
      return { dayStart: x.dayStart, label: `${d.getMonth() + 1}/${d.getDate()} ${wd[d.getDay()]}`, total: x.ms, items };
    });

    if (period === 'week' || period === 'month') rows.sort((a, b) => b.dayStart - a.dayStart);
    if (period === 'month' && rows.length > 10) {
      rows = rows.slice(0, 10);
      $('#timelineMeta').textContent = '最近 10 个有记录的日期';
    } else {
      $('#timelineMeta').textContent = rows.length + ' 天有记录';
    }
    renderTimeline($('#timeline'), rows);
  }

  function renderGoals(now) {
    const tasks = S.listTasks().filter(t => t.targetHours > 0);
    const el = $('#goals');
    if (!tasks.length) {
      el.innerHTML = '<div class="empty">还没有设置周目标<br>到「设置 → 事件管理」里为事件填写每周目标小时数</div>';
      return;
    }
    const agg = aggregateByTask(S, startOfWeek(now), now + 1);
    el.innerHTML = tasks.map(t => {
      const got = agg.filter(x => x.taskId === t.id).reduce((s, x) => s + x.ms, 0);
      const target = t.targetHours * 3600000;
      const pct = Math.min(100, (got / target) * 100);
      const done = got >= target;
      const left = Math.max(0, target - got);
      // 本周剩余天数（含今天）
      const dow = new Date(now).getDay();
      const daysLeft = dow === 0 ? 1 : 8 - dow;
      return `<div class="goal-item">
        <div class="goal-head">
          <span class="legend-dot" style="background:${t.color}"></span>
          <span class="goal-name">${t.emoji} ${escapeHtml(t.name)}</span>
          <span class="goal-val">${fmtDur(got)} / ${t.targetHours}h</span>
        </div>
        <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${t.color}"></div></div>
        <div class="goal-foot">${done
          ? '<span class="goal-done">✓ 本周目标已达成</span>'
          : `还差 ${fmtDur(left)} · 本周还剩 ${daysLeft} 天`}</div>
      </div>`;
    }).join('');
  }

  /* ============================================================
   *  渲染：设置页
   * ============================================================ */
  function renderSettings() {
    const st = S.getSettings();

    /* 事件管理 */
    const tasks = S.listTasks(true);
    const list = $('#manageList');
    list.innerHTML = tasks.length ? tasks.map((t, i) => `
      <div class="manage-item">
        <div class="manage-emoji" style="background:${hexAlpha(t.color, .13)}">${t.emoji}</div>
        <div class="manage-info">
          <div class="manage-name">${escapeHtml(t.name)}${t.archived ? ' <span style="color:var(--text-3);font-weight:400">(已归档)</span>' : ''}</div>
          <div class="manage-sub">${t.targetHours > 0 ? '周目标 ' + t.targetHours + ' 小时' : '未设目标'}</div>
        </div>
        <div class="manage-ops">
          <button class="icon-btn" data-up="${t.id}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>↑</button>
          <button class="icon-btn" data-down="${t.id}" ${i === tasks.length - 1 ? 'disabled style="opacity:.3"' : ''}>↓</button>
          <button class="icon-btn" data-edit="${t.id}">✎</button>
          <button class="icon-btn" data-arch="${t.id}" title="${t.archived ? '取消归档' : '归档'}">${t.archived ? '↩' : '📥'}</button>
          <button class="icon-btn" data-rm="${t.id}" style="color:var(--danger)">🗑</button>
        </div>
      </div>`).join('') : '<div class="empty">暂无事件</div>';

    list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTaskModal(b.dataset.edit)));
    list.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => { S.reorderTask(b.dataset.up, -1); renderSettings(); renderTasks(); }));
    list.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => { S.reorderTask(b.dataset.down, 1); renderSettings(); renderTasks(); }));
    list.querySelectorAll('[data-arch]').forEach(b => b.addEventListener('click', () => {
      const t = S.getTask(b.dataset.arch);
      S.updateTask(t.id, { archived: !t.archived });
      renderSettings(); renderTasks();
    }));
    list.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      const t = S.getTask(b.dataset.rm);
      if (confirm(`删除「${t.name}」？该事件的历史记录也会一并删除。`)) {
        S.deleteTask(t.id);
        renderSettings(); renderTasks(); renderTodayList();
        toast('已删除');
      }
    }));

    /* 番茄钟 / 提醒 / 报表 */
    $('#inpWorkMin').value = st.workMin;
    $('#inpBreakMin').value = st.breakMin;
    $('#inpRounds').value = st.rounds;
    $('#reminderToggle').checked = st.reminder;
    $('#inpIdleHours').value = st.idleHours;
    $('#weekReportToggle').checked = st.weekReport;
    $('#monthReportToggle').checked = st.monthReport;
    $('#pomoToggle').checked = st.pomodoro;
  }

  /* ============================================================
   *  事件弹窗
   * ============================================================ */
  function buildPalettes() {
    $('#emojiGrid').innerHTML = EMOJI_PALETTE.map(e =>
      `<div class="emoji-cell" data-emoji="${e}">${e}</div>`).join('');
    $('#colorGrid').innerHTML = COLOR_PALETTE.map(c =>
      `<div class="color-cell" data-color="${c}" style="background:${c}"></div>`).join('');

    $('#emojiGrid').querySelectorAll('[data-emoji]').forEach(el => {
      el.addEventListener('click', () => { rt.pickEmoji = el.dataset.emoji; markPalettes(); });
    });
    $('#colorGrid').querySelectorAll('[data-color]').forEach(el => {
      el.addEventListener('click', () => { rt.pickColor = el.dataset.color; markPalettes(); });
    });
  }

  function markPalettes() {
    $('#emojiGrid').querySelectorAll('[data-emoji]').forEach(el =>
      el.classList.toggle('sel', el.dataset.emoji === rt.pickEmoji));
    $('#colorGrid').querySelectorAll('[data-color]').forEach(el =>
      el.classList.toggle('sel', el.dataset.color === rt.pickColor));
  }

  function openTaskModal(id) {
    rt.editTaskId = id || null;
    const t = id ? S.getTask(id) : null;
    $('#taskModalTitle').textContent = t ? '编辑事件' : '新增事件';
    $('#inpTaskName').value = t ? t.name : '';
    $('#inpTaskTarget').value = t && t.targetHours > 0 ? t.targetHours : '';
    rt.pickEmoji = t ? t.emoji : EMOJI_PALETTE[0];
    rt.pickColor = t ? t.color : COLOR_PALETTE[S.listTasks(true).length % COLOR_PALETTE.length];
    markPalettes();
    openModal('#modalTask');
    setTimeout(() => $('#inpTaskName').focus(), 260);
  }

  function saveTask() {
    const name = $('#inpTaskName').value.trim();
    if (!name) { toast('请填写事件名称'); return; }
    const targetHours = parseFloat($('#inpTaskTarget').value) || 0;
    if (rt.editTaskId) {
      S.updateTask(rt.editTaskId, { name, emoji: rt.pickEmoji, color: rt.pickColor, targetHours });
      toast('已保存');
    } else {
      S.addTask({ name, emoji: rt.pickEmoji, color: rt.pickColor, targetHours });
      toast('已添加');
    }
    closeModal('#modalTask');
    renderAll();
    if (rt.view === 'settings') renderSettings();
  }

  /* ============================================================
   *  手动补录
   * ============================================================ */
  function openManualModal() {
    const tasks = S.listTasks(true);
    if (!tasks.length) { toast('请先新增一个事件'); return; }
    $('#inpManualTask').innerHTML = tasks.map(t =>
      `<option value="${t.id}">${t.emoji} ${escapeHtml(t.name)}</option>`).join('');
    const now = new Date();
    $('#inpManualDate').value = dateKey(now.getTime());
    $('#inpManualStart').value = '09:00';
    $('#inpManualEnd').value = '10:00';
    $('#inpManualNote').value = '';
    updateManualPreview();
    openModal('#modalManual');
  }

  function manualTimes() {
    const d = $('#inpManualDate').value;
    const s = $('#inpManualStart').value;
    const e = $('#inpManualEnd').value;
    if (!d || !s || !e) return null;
    const [Y, M, D] = d.split('-').map(Number);
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    const start = new Date(Y, M - 1, D, sh, sm, 0, 0).getTime();
    let end = new Date(Y, M - 1, D, eh, em, 0, 0).getTime();
    let crossed = false;
    if (end <= start) { end += 86400000; crossed = true; }
    return { start, end, crossed };
  }

  function updateManualPreview() {
    const t = manualTimes();
    if (!t) { $('#manualPreview').textContent = ''; return; }
    $('#manualPreview').textContent = `时长 ${fmtDur(t.end - t.start)}${t.crossed ? '（跨天，结束时间算作次日）' : ''}`;
  }

  function saveManual() {
    const t = manualTimes();
    if (!t) { toast('请填写完整时间'); return; }
    S.addRecord({
      taskId: $('#inpManualTask').value,
      start: t.start, end: t.end, duration: t.end - t.start,
      note: $('#inpManualNote').value.trim(),
      source: 'manual'
    });
    closeModal('#modalManual');
    toast('已补录 ' + fmtDur(t.end - t.start));
    renderAll();
    if (rt.view === 'stats') renderStats();
  }

  /* ============================================================
   *  周报 / 月报
   * ============================================================ */
  function buildReport(kind, now) {
    const range = kind === 'week'
      ? { from: startOfWeek(now), to: startOfWeek(now) + 7 * 86400000 }
      : (() => { const f = startOfMonth(now); const d = new Date(f); d.setMonth(d.getMonth() + 1); return { from: f, to: d.getTime() }; })();
    const cap = Math.min(range.to, now + 1);
    const segs = aggregateByTask(S, range.from, cap);
    const total = segs.reduce((s, x) => s + x.ms, 0);
    const prev = prevRange(kind === 'week' ? 'week' : 'month', range);
    const prevTotal = totalIn(S, prev.from, prev.to);
    const days = dailyTotals(S, range.from, cap).filter(x => x.ms > 0);
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

    let hero = `
      <div class="report-hero">
        <div class="rh-label">${kind === 'week' ? '本周累计投入' : '本月累计投入'}</div>
        <div class="rh-total">${fmtDur(total)}</div>
        <div class="rh-sub">${days.length} 天有记录 · 日均 ${fmtDur(days.length ? total / days.length : 0)}</div>
        ${delta !== null ? `<div class="report-delta">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}% 较${kind === 'week' ? '上周' : '上月'}</div>` : ''}
      </div>`;

    if (!segs.length) {
      hero += '<div class="report-insight">本期还没有任何记录。别急，从明天开始，选一件小事计时 25 分钟，先动起来。</div>';
      return hero;
    }

    const list = segs.slice(0, 6).map(s => `
      <div class="report-row">
        <span style="width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.emoji} ${escapeHtml(s.name)}</span>
        <span class="rr-bar"><i class="rr-fill" style="width:${(s.ms / segs[0].ms) * 100}%;background:${s.color};display:block;height:100%"></i></span>
        <span style="width:52px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${fmtDur(s.ms)}</span>
      </div>`).join('');

    // 生成一句洞察
    const top = segs[0];
    const pct = ((top.ms / total) * 100).toFixed(0);
    const perDay = days.length ? total / days.length : 0;
    const goals = S.listTasks().filter(t => t.targetHours > 0);
    const goalAgg = aggregateByTask(S, range.from, cap);
    const hit = goals.filter(g => {
      const got = goalAgg.filter(x => x.taskId === g.id).reduce((s, x) => s + x.ms, 0);
      return got >= g.targetHours * 3600000;
    });
    let insight = `<b>${escapeHtml(top.name)}</b> 是本期投入最多的事件，占 ${pct}%。`;
    insight += `有记录的日子平均每天投入 <b>${fmtDur(perDay)}</b>。`;
    if (goals.length) insight += ` 目标达成 <b>${hit.length}/${goals.length}</b> 项。`;
    const maxDay = dailyTotals(S, range.from, cap).reduce((a, b) => (b.ms > a.ms ? b : a), { dayStart: 0, ms: 0 });
    if (maxDay.ms > 0) {
      const d = new Date(maxDay.dayStart);
      insight += ` 最能投入的一天是 <b>${d.getMonth() + 1} 月 ${d.getDate()} 日</b>，共 ${fmtDur(maxDay.ms)}。`;
    }

    return hero + `<div class="report-list">${list}</div><div class="report-insight">${insight}</div>`;
  }

  function maybeShowReport() {
    const st = S.getSettings();
    const now = new Date();
    const dow = now.getDay();
    // 周末提示周报
    if (st.weekReport && (dow === 0 || dow === 6)) {
      const key = 'w' + dateKey(startOfWeek(now));
      if (st.lastWeekReport !== key) {
        S.updateSettings({ lastWeekReport: key });
        if (S.listRecords().length) { showReport('week', now); return; }
      }
    }
    // 月末提示月报
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (st.monthReport && tomorrow.getMonth() !== now.getMonth()) {
      const key = 'm' + now.getFullYear() + '-' + pad2(now.getMonth() + 1);
      if (st.lastMonthReport !== key) {
        S.updateSettings({ lastMonthReport: key });
        if (S.listRecords().length) { showReport('month', now); }
      }
    }
  }

  let reportKind = 'week';
  function showReport(kind, now) {
    reportKind = kind;
    $('#reportTitle').textContent = kind === 'week' ? '本周小结' : '本月小结';
    $('#reportBody').innerHTML = buildReport(kind, now || Date.now());
    openModal('#modalReport');
  }

  /* ============================================================
   *  提醒引擎
   * ============================================================ */
  function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body, icon: 'icon-192.png' }); return; } catch (e) { /* fallthrough */ }
    }
    toast(title + '：' + body);
  }

  function checkReminders() {
    const st = S.getSettings();
    if (!st.reminder) return;
    const now = Date.now();
    const limit = st.idleHours * 3600000;
    S.listTasks().forEach(t => {
      const recs = S.recordsOfTask(t.id);
      const last = recs.length ? Math.max(...recs.map(r => r.end)) : t.createdAt;
      const key = dateKey(now) + ':' + t.id;
      if (now - last >= limit && !rt.lastNotify[key]) {
        rt.lastNotify[key] = true;
        notify('该推进一下了', `「${t.name}」已经 ${Math.floor((now - last) / 86400000)} 天没有记录了`);
      }
    });
  }

  /* ============================================================
   *  工具
   * ============================================================ */
  function hexAlpha(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ============================================================
   *  事件绑定
   * ============================================================ */
  function bind() {
    $$('.tab').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    $$('#periodSeg button').forEach(b => b.addEventListener('click', () => {
      rt.period = b.dataset.period;
      $$('#periodSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderStats();
    }));

    $('#btnStop').addEventListener('click', () => stopTimer(false));
    $('#btnPause').addEventListener('click', () => {
      const run = S.getRunning();
      if (!run) return;
      isPaused(run) ? resumeTimer() : pauseTimer();
    });

    $('#pomoToggle').addEventListener('change', e => {
      const on = e.target.checked;
      S.updateSettings({ pomodoro: on });
      const run = S.getRunning();
      if (run) {
        if (on) {
          run.pomo = { phase: 'work', phaseStart: Date.now(), done: 0 };
        } else {
          delete run.pomo;
        }
        S.setRunning(run);
      }
      $('#pomoInfo').textContent = on ? '番茄钟已开启，计时时会自动分配专注与休息' : '工作 25 分钟 / 休息 5 分钟';
      renderSettings();
      toast(on ? '番茄钟已开启' : '番茄钟已关闭');
    });

    $('#btnQuickAdd').addEventListener('click', () => openTaskModal(null));
    $('#btnAddTask').addEventListener('click', () => openTaskModal(null));
    $('#btnSaveTask').addEventListener('click', saveTask);
    $('#inpTaskName').addEventListener('keydown', e => { if (e.key === 'Enter') saveTask(); });

    $('#btnManual').addEventListener('click', openManualModal);
    ['#inpManualDate', '#inpManualStart', '#inpManualEnd'].forEach(s =>
      $(s).addEventListener('input', updateManualPreview));
    $('#btnSaveManual').addEventListener('click', saveManual);

    $('#btnReportDetail').addEventListener('click', () => {
      closeModal('#modalReport');
      rt.period = reportKind;
      $$('#periodSeg button').forEach(x => x.classList.toggle('active', x.dataset.period === reportKind));
      switchView('stats');
    });

    // 设置项
    const bindNum = (sel, key, min, max) => {
      $(sel).addEventListener('change', e => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v)) v = min;
        v = Math.max(min, Math.min(max, v));
        e.target.value = v;
        S.updateSettings({ [key]: v });
        $('#pomoInfo').textContent = (S.getSettings().pomodoro ? '番茄钟已开启：' : '工作 ')
          + `${S.getSettings().workMin} 分钟 / 休息 ${S.getSettings().breakMin} 分钟`;
        toast('已保存');
      });
    };
    bindNum('#inpWorkMin', 'workMin', 1, 180);
    bindNum('#inpBreakMin', 'breakMin', 1, 60);
    bindNum('#inpRounds', 'rounds', 1, 12);
    bindNum('#inpIdleHours', 'idleHours', 1, 72);

    ['#reminderToggle:reminder', '#weekReportToggle:weekReport', '#monthReportToggle:monthReport']
      .forEach(pair => {
        const [sel, key] = pair.split(':');
        $(sel).addEventListener('change', e => {
          S.updateSettings({ [key]: e.target.checked });
          if (key === 'reminder' && e.target.checked) requestNotifyPerm(true);
        });
      });

    $('#btnNotifyPerm').addEventListener('click', () => requestNotifyPerm(false));

    $('#btnExport').addEventListener('click', () => {
      download(`时间账本-备份-${dateKey(Date.now())}.json`, S.exportJSON());
      toast('已导出备份');
    });
    $('#btnExportCsv').addEventListener('click', () => {
      download(`时间账本-记录-${dateKey(Date.now())}.csv`, '\ufeff' + S.exportCSV(), 'text/csv');
      toast('已导出 CSV');
    });
    $('#btnImport').addEventListener('click', () => $('#fileImport').click());
    $('#fileImport').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          S.importJSON(rd.result);
          toast('导入成功');
          renderAll(); renderSettings();
        } catch (err) { toast('导入失败：文件格式不正确'); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });
    $('#btnReset').addEventListener('click', () => {
      if (confirm('确定清空所有事件与记录？该操作不可撤销，建议先导出备份。')) {
        S.clearAll();
        toast('已清空');
        renderAll(); renderSettings();
      }
    });

    // 页面重新可见时刷新（跨天、后台回来）
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { renderAll(); if (rt.view === 'stats') renderStats(); }
    });
  }

  function requestNotifyPerm(silent) {
    if (!('Notification' in window)) { if (!silent) toast('当前浏览器不支持通知'); return; }
    if (Notification.permission === 'granted') { if (!silent) toast('通知已开启'); return; }
    Notification.requestPermission().then(p => {
      toast(p === 'granted' ? '通知已开启' : '已拒绝通知；提醒将只在页面内以浮层提示');
    });
  }

  /* ============================================================
   *  启动
   * ============================================================ */
  function init() {
    S.seedIfEmpty();
    buildPalettes();
    bind();
    renderAll();
    renderSettings();
    $('#pomoToggle').checked = S.getSettings().pomodoro;
    $('#pomoInfo').textContent = S.getSettings().pomodoro
      ? '番茄钟已开启，计时时会自动分配专注与休息'
      : `工作 ${S.getSettings().workMin} 分钟 / 休息 ${S.getSettings().breakMin} 分钟`;
    switchView('timer');

    rt.tick = setInterval(tick, 1000);
    tick();

    setTimeout(maybeShowReport, 700);
    setTimeout(checkReminders, 2500);
    setInterval(checkReminders, 5 * 60 * 1000);

    // Service Worker 仅在 http(s) 下可用；file:// 直接打开时会自动跳过
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();