/**
 * 数据层（Store）
 * ------------------------------------------------------------
 * 全部业务读写都走这里，不直接碰 localStorage。
 * 将来接后端云同步时，只需新增一个 RemoteStore 实现同样的方法，
 * 或在 LocalStore 上叠加同步逻辑，业务代码无需改动。
 *
 * 数据模型：
 *   tasks[]   { id, name, emoji, color, targetHours(周目标,h), archived, createdAt }
 *   records[] { id, taskId, start(ms), end(ms), duration(ms, 已扣除暂停), note, source }
 *   running   { taskId, start(ms) } | null      —— 当前进行中的事件
 *   settings  { pomodoro, workMin, breakMin, rounds, reminder..., }
 * ------------------------------------------------------------
 */

const COLOR_PALETTE = [
  '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
  '#f97316', '#6366f1', '#84cc16', '#06b6d4',
  '#e11d48', '#a855f7', '#059669', '#64748b'
];

const EMOJI_PALETTE = [
  '📘', '💻', '⌨️', '🎨', '🏃', '🧘', '📝', '🎧',
  '🀄', '🔬', '📊', '🍳', '🛠️', '🌱', '🎮', '💤'
];

const DEFAULT_SETTINGS = {
  pomodoro: false,
  workMin: 25,
  breakMin: 5,
  rounds: 4,
  reminder: false,
  idleHours: 24,
  weekReport: true,
  monthReport: true,
  lastWeekReport: '',
  lastMonthReport: ''
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

class LocalStore {
  constructor() {
    this.KEY = 'timetrack.v1';
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return {
          tasks: d.tasks || [],
          records: d.records || [],
          running: d.running || null,
          settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {})
        };
      }
    } catch (e) {
      console.warn('读取本地数据失败，使用空数据', e);
    }
    return { tasks: [], records: [], running: null, settings: Object.assign({}, DEFAULT_SETTINGS) };
  }

  _save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('保存失败', e);
    }
  }

  /* ---------------- 初始化 ---------------- */
  seedIfEmpty() {
    if (this.data.tasks.length) return false;
    const now = Date.now();
    const presets = [
      { name: '学习英语', emoji: '📘', color: '#4f46e5', targetHours: 5 },
      { name: '编程', emoji: '💻', color: '#0ea5e9', targetHours: 7 },
      { name: '打字练习', emoji: '⌨️', color: '#10b981', targetHours: 3 },
      { name: 'AI创作', emoji: '🎨', color: '#f59e0b', targetHours: 4 }
    ];
    this.data.tasks = presets.map((p, i) => ({
      id: uid(), ...p, archived: false, createdAt: now + i
    }));
    this._save();
    return true;
  }

  /* ---------------- 事件 ---------------- */
  listTasks(includeArchived = false) {
    return this.data.tasks
      .filter(t => includeArchived || !t.archived)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getTask(id) { return this.data.tasks.find(t => t.id === id) || null; }

  addTask({ name, emoji, color, targetHours }) {
    const t = {
      id: uid(), name: name.trim(), emoji, color,
      targetHours: targetHours > 0 ? targetHours : 0,
      archived: false, createdAt: Date.now()
    };
    this.data.tasks.push(t);
    this._save();
    return t;
  }

  updateTask(id, patch) {
    const t = this.getTask(id);
    if (!t) return null;
    Object.assign(t, patch);
    this._save();
    return t;
  }

  deleteTask(id) {
    this.data.tasks = this.data.tasks.filter(t => t.id !== id);
    // 保留记录还是删除？这里删除该事件的历史记录，避免出现孤儿数据
    this.data.records = this.data.records.filter(r => r.taskId !== id);
    if (this.data.running && this.data.running.taskId === id) this.data.running = null;
    this._save();
  }

  reorderTask(id, dir) {
    const list = this.listTasks(true);
    const i = list.findIndex(t => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i].createdAt, b = list[j].createdAt;
    list[i].createdAt = b; this.getTask(list[i].id).createdAt = b;
    this.getTask(list[j].id).createdAt = a;
    this._save();
  }

  /* ---------------- 记录 ---------------- */
  listRecords() { return this.data.records.slice(); }

  addRecord({ taskId, start, end, duration, note, source }) {
    const r = {
      id: uid(), taskId,
      start, end,
      duration: duration != null ? duration : (end - start),
      note: note || '',
      source: source || 'timer'
    };
    this.data.records.push(r);
    this._save();
    return r;
  }

  deleteRecord(id) {
    this.data.records = this.data.records.filter(r => r.id !== id);
    this._save();
  }

  recordsOfTask(taskId) { return this.data.records.filter(r => r.taskId === taskId); }

  /* ---------------- 进行中 ---------------- */
  getRunning() { return this.data.running; }
  setRunning(v) { this.data.running = v; this._save(); }

  /* ---------------- 设置 ---------------- */
  getSettings() { return this.data.settings; }
  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this._save();
    return this.data.settings;
  }

  /* ---------------- 备份 ---------------- */
  exportJSON() { return JSON.stringify(this.data, null, 2); }

  importJSON(text) {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object') throw new Error('格式不正确');
    this.data = {
      tasks: d.tasks || [],
      records: d.records || [],
      running: d.running || null,
      settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {})
    };
    this._save();
  }

  exportCSV() {
    const map = {};
    this.data.tasks.forEach(t => { map[t.id] = t.name; });
    const rows = [['事件', '开始时间', '结束时间', '时长(分钟)', '来源', '备注']];
    this.data.records
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach(r => {
        rows.push([
          map[r.taskId] || '(已删除)',
          fmtDateTime(r.start),
          fmtDateTime(r.end),
          (r.duration / 60000).toFixed(1),
          r.source === 'manual' ? '手动补录' : '计时',
          r.note || ''
        ]);
      });
    return rows.map(row =>
      row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');
  }

  clearAll() {
    this.data = { tasks: [], records: [], running: null, settings: Object.assign({}, DEFAULT_SETTINGS) };
    this._save();
  }
}

/* ---------------- 时间格式化工具（全局共用） ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtClock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtDur(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? ' ' + m + 'm' : ''}`;
  if (m > 0) return `${m}m`;
  if (total > 0) return `${total}s`;
  return '0m';
}

function fmtDurLong(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/* ---------------- 时间边界工具 ---------------- */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** 周一为一周开始 */
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();               // 0=周日
  const diff = day === 0 ? 6 : day - 1; // 周一=0
  x.setDate(x.getDate() - diff);
  return x.getTime();
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x.getTime();
}

function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 把一条记录按跨天拆分到各自的「天」
 * 返回 [{ dayStart, ms }]
 */
function splitByDay(record) {
  const out = [];
  let cur = record.start;
  const end = record.end;
  // 使用实际经过时间而非扣除暂停后的 duration 做比例分配，
  // 这样跨天时各天份额能正确反映在一天内的时间占比
  const span = end - record.start;
  if (span <= 0) return [{ dayStart: startOfDay(record.start), ms: record.duration }];
  while (cur < end) {
    const dayEnd = startOfDay(cur) + 86400000;
    const segEnd = Math.min(dayEnd, end);
    const segSpan = segEnd - cur;
    out.push({
      dayStart: startOfDay(cur),
      ms: record.duration * (segSpan / span),
      segStart: cur,
      segEnd: segEnd
    });
    cur = segEnd;
  }
  return out;
}

window.COLOR_PALETTE = COLOR_PALETTE;
window.EMOJI_PALETTE = EMOJI_PALETTE;
window.LocalStore = LocalStore;
window.Store = new LocalStore();