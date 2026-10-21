/**
 * 图表与统计计算
 *  - 环形图（SVG）
 *  - 堆叠柱状趋势图
 *  - 每日时间线（块状）
 * 纯手写 SVG/DOM，不依赖任何外部库。
 */

/* ============ 统计聚合 ============ */

/**
 * 在 [from, to) 区间内按事件聚合时长
 * 跨天记录会按比例拆分，只取落在区间内的部分
 */
function aggregateByTask(store, from, to) {
  const map = new Map();
  store.listRecords().forEach(r => {
    if (r.end <= from || r.start >= to) return;
    splitByDay(r).forEach(seg => {
      // 按天片段再与区间求交集，保证精度
      const segStart = seg.segStart != null ? seg.segStart : r.start;
      const segEnd = seg.segEnd != null ? seg.segEnd : r.end;
      const a = Math.max(segStart, from);
      const b = Math.min(segEnd, to);
      if (b <= a) return;
      const span = segEnd - segStart;
      const ms = span > 0 ? seg.ms * ((b - a) / span) : seg.ms;
      map.set(r.taskId, (map.get(r.taskId) || 0) + ms);
    });
  });
  const tasks = store.listTasks(true);
  const arr = [];
  map.forEach((ms, taskId) => {
    if (ms <= 0) return;
    const t = tasks.find(x => x.id === taskId);
    arr.push({
      taskId,
      name: t ? t.name : '(已删除)',
      emoji: t ? t.emoji : '❓',
      color: t ? t.color : '#9ca3af',
      ms
    });
  });
  arr.sort((x, y) => y.ms - x.ms);
  return arr;
}

/** 区间内总时长 */
function totalIn(store, from, to) {
  return aggregateByTask(store, from, to).reduce((s, x) => s + x.ms, 0);
}

/** 按天累计，返回 [{ dayStart, ms }]（含空白天） */
function dailyTotals(store, from, to) {
  const buckets = new Map();
  const d = new Date(from);
  while (d.getTime() < to) {
    buckets.set(startOfDay(d.getTime()), 0);
    d.setDate(d.getDate() + 1);
  }
  store.listRecords().forEach(r => {
    if (r.end <= from || r.start >= to) return;
    splitByDay(r).forEach(seg => {
      const segStart = seg.segStart != null ? seg.segStart : r.start;
      const segEnd = seg.segEnd != null ? seg.segEnd : r.end;
      const a = Math.max(segStart, from);
      const b = Math.min(segEnd, to);
      if (b <= a) return;
      const span = segEnd - segStart;
      const ms = span > 0 ? seg.ms * ((b - a) / span) : seg.ms;
      const k = startOfDay(segStart);
      if (buckets.has(k)) buckets.set(k, buckets.get(k) + ms);
    });
  });
  return Array.from(buckets.entries())
    .map(([dayStart, ms]) => ({ dayStart, ms }))
    .sort((a, b) => a.dayStart - b.dayStart);
}

/** 某天的记录明细（用于时间线） */
function recordsOfDay(store, dayStart) {
  const dayEnd = dayStart + 86400000;
  const tasks = store.listTasks(true);
  return store.listRecords()
    .filter(r => r.end > dayStart && r.start < dayEnd)
    .map(r => {
      const t = tasks.find(x => x.id === r.taskId);
      return {
        ...r,
        name: t ? t.name : '(已删除)',
        color: t ? t.color : '#9ca3af',
        emoji: t ? t.emoji : '❓',
        startClipped: Math.max(r.start, dayStart),
        endClipped: Math.min(r.end, dayEnd)
      };
    })
    .sort((a, b) => a.startClipped - b.startClipped);
}

/* ============ 环形图 ============ */

function renderDonut(el, segments, centerLabel, centerSub) {
  const total = segments.reduce((s, x) => s + x.ms, 0);
  const size = 168, stroke = 22, r = (size - stroke) / 2 - 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  if (!total) {
    el.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f0f1f4" stroke-width="${stroke}"/>
      </svg>
      <div class="donut-center"><b>0m</b><span>暂无记录</span></div>`;
    return;
  }

  let offset = 0;
  const arcs = segments.map(s => {
    const frac = s.ms / total;
    const len = frac * circ;
    const gap = segments.length > 1 ? Math.min(3, len * 0.12) : 0;
    const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none"
      stroke="${s.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - gap)} ${circ - Math.max(0, len - gap)}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${c} ${c})"
      stroke-linecap="butt"><title>${escapeHtml(s.name)}</title></circle>`;
    offset += len;
    return seg;
  }).join('');

  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>
    <div class="donut-center"><b>${escapeHtml(centerLabel)}</b><span>${escapeHtml(centerSub)}</span></div>`;
}

/* ============ 堆叠柱状图 ============ */

/**
 * @param cols [{ label, sub, total, segs:[{color,ms}], current }]
 */
function renderBars(el, cols) {
  if (!cols.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const max = Math.max(...cols.map(c => c.total), 1);
  const H = 100; // 百分比高度基准
  el.innerHTML = cols.map(c => {
    const h = c.total > 0 ? Math.max(3, (c.total / max) * H) : 2;
    const segs = c.segs.map(s => {
      const sh = c.total > 0 ? (s.ms / c.total) * 100 : 0;
      return `<div class="bar-seg" style="height:${sh}%;background:${s.color}"></div>`;
    }).join('');
    return `<div class="bar-col ${c.current ? 'current' : ''}">
      <div class="bar-val">${c.total > 0 ? fmtDur(c.total) : ''}</div>
      <div class="bar-area">
        <div class="bar-stack" style="height:${h}%">${segs || '<div class="bar-seg" style="height:100%;background:#eceef1"></div>'}</div>
      </div>
      <div class="bar-label">${escapeHtml(c.label)}</div>
    </div>`;
  }).join('');
}

/* ============ 每日时间线 ============ */

/**
 * 一天从 0:00 到 24:00 的横向时间条
 * @param rows [{ dayStart, label, total, items:[{name,color,startClipped,endClipped}] }]
 */
function renderTimeline(el, rows) {
  if (!rows.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  el.innerHTML = rows.map(row => {
    const blocks = row.items.map(it => {
      const left = ((it.startClipped - row.dayStart) / 86400000) * 100;
      const w = ((it.endClipped - it.startClipped) / 86400000) * 100;
      const wCss = Math.max(w, 0.6);
      const showText = w > 7;
      return `<div class="tl-block" style="left:${left}%;width:${wCss}%;background:${it.color}"
        title="${escapeHtml(it.name)} ${fmtClock(it.startClipped)}-${fmtClock(it.endClipped)}">
        ${showText ? escapeHtml(it.name) : ''}</div>`;
    }).join('');
    return `<div class="tl-row">
      <div class="tl-head">
        <span class="tl-date">${escapeHtml(row.label)}</span>
        <span class="tl-total">${fmtDur(row.total)}</span>
      </div>
      <div class="tl-track">${blocks || ''}</div>
      <div class="tl-axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </div>`;
  }).join('');
}

/* ============ 小工具 ============ */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.aggregateByTask = aggregateByTask;
window.totalIn = totalIn;
window.dailyTotals = dailyTotals;
window.recordsOfDay = recordsOfDay;
window.renderDonut = renderDonut;
window.renderBars = renderBars;
window.renderTimeline = renderTimeline;
window.escapeHtml = escapeHtml;