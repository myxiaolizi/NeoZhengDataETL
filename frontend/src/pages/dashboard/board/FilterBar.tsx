/** 看板筛选区
 *
 * 6 个筛选按钮（从左到右）：日期 / 区域 / 连锁类型 / 销售 / 全部筛选条件 / 重置
 * 按钮名默认「全部」，筛选后显示所选结果名称；按钮后方显示该维度当前客户数。
 * 纯展示组件：状态由 Board.tsx 持有，这里只 onChange 回传补丁。
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Badge, Button, Calendar, Checkbox, DatePicker, Divider, Drawer, Empty, Input, Modal,  Space, Tooltip,
} from 'antd';
import {
  CalendarOutlined, CloseOutlined, EnvironmentOutlined, FilterOutlined,
  ReloadOutlined, SearchOutlined, ShopOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type {
  BoardCounts, BoardFilters, BoardOptions, DatePreset,
} from '@/api/crm-board';

const { RangePicker } = DatePicker;

/* ══════════════ V6.0 紧凑顶栏样式（参考 zk2.zhengl.vip/pc4.html）══════════════ */

/** 筛选按钮基础样式：32px 高、9px 圆角、描边幽灵按钮 */
const BTN_BASE: React.CSSProperties = {
  height: 32,
  padding: '0 12px',
  borderRadius: 9,
  border: '1px solid var(--line)',
  background: 'var(--panel2)',
  color: 'var(--text2)',
  fontSize: 12.5,
  fontWeight: 550,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  transition: 'all .15s',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  lineHeight: 1,
};

/** 已激活：品牌渐变实心 */
const BTN_ON: React.CSSProperties = {
  ...BTN_BASE,
  background: 'linear-gradient(135deg, var(--brand), var(--brand2))',
  borderColor: 'transparent',
  color: '#fff',
  boxShadow: '0 3px 9px color-mix(in srgb, var(--brand) 28%, transparent)',
};

/** 计数徽标 */
function CountBadge({ n, on }: { n: number; on?: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '0 5px',
        borderRadius: 6,
        lineHeight: '15px',
        background: on ? 'rgba(255,255,255,.26)' : 'var(--brandSoft)',
        color: on ? '#fff' : 'var(--brand)',
      }}
    >
      {n}
    </span>
  );
}

/** 内联 SVG 图标（16px，stroke 风格，与参考站一致） */
const Svg = ({ d, extra }: { d: string; extra?: React.ReactNode }) => (
  <svg
    width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d={d} />
    {extra}
  </svg>
);

const ICON = {
  calendar: <Svg d="M3 10h18M7 3v3M17 3v3M5 5h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />,
  region: <><Svg d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" /><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="2" /></>,
  type: <Svg d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6" />,
  sales: <><Svg d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="2" /></>,
  filter: <Svg d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />,
  reset: <Svg d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8M3 3v5h5" />,
};

interface Props {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  onReset: () => void;
  options: BoardOptions;
  counts: BoardCounts;
  isMobile: boolean;
}

/* ══════════════ 日期区间计算（前端侧，与后端口径一致） ══════════════ */

function presetRange(preset: DatePreset, today = dayjs()): [string, string] | null {
  const t = today.startOf('day');
  switch (preset) {
    case 'today':
      return [t.format('YYYY-MM-DD'), t.format('YYYY-MM-DD')];
    case 'yesterday': {
      const y = t.subtract(1, 'day');
      return [y.format('YYYY-MM-DD'), y.format('YYYY-MM-DD')];
    }
    case 'thisWeek': {
      const mon = t.subtract((t.day() + 6) % 7, 'day');
      return [mon.format('YYYY-MM-DD'), mon.add(6, 'day').format('YYYY-MM-DD')];
    }
    case 'lastWeek': {
      const mon = t.subtract((t.day() + 6) % 7, 'day').subtract(7, 'day');
      return [mon.format('YYYY-MM-DD'), mon.add(6, 'day').format('YYYY-MM-DD')];
    }
    case 'thisMonth': {
      const first = t.startOf('month');
      return [first.format('YYYY-MM-DD'), first.endOf('month').format('YYYY-MM-DD')];
    }
    case 'lastMonth': {
      const first = t.subtract(1, 'month').startOf('month');
      return [first.format('YYYY-MM-DD'), first.endOf('month').format('YYYY-MM-DD')];
    }
    default:
      return null;
  }
}

const PRESET_LABELS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
];

/** 日期按钮文案 */
function dateButtonLabel(f: BoardFilters): string {
  if (f.datePreset === 'all') return '全部';
  const preset = PRESET_LABELS.find((p) => p.key === f.datePreset);
  if (preset) return preset.label;
  if (f.datePreset === 'custom' && f.dateFrom) {
    const a = dayjs(f.dateFrom);
    const b = dayjs(f.dateTo || f.dateFrom);
    if (!a.isValid()) return '全部';
    if (!b.isValid() || a.isSame(b, 'day')) return a.format('MM/DD');
    return `${a.format('MM/DD')}-${b.format('MM/DD')}`;
  }
  return '全部';
}

/** 多选按钮文案：空=全部；1个=名称；多个=首个+N */
function multiLabel(list: string[], allLabel = '全部'): string {
  if (!list.length) return allLabel;
  if (list.length === 1) return list[0];
  return `${list[0]} +${list.length - 1}`;
}

/* ══════════════ 通用：多选下拉 ══════════════ */

interface MultiSelectProps {
  label: string;
  icon: React.ReactNode;
  values: string[];
  options: string[];
  counts?: Record<string, number>;
  onApply: (next: string[]) => void;
  searchable?: boolean;
  allLabel?: string;
}

function MultiSelect({
  label, icon, values, options, counts, onApply, searchable, allLabel = '全部',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const [draft, setDraft] = useState<string[]>(values);
  /**
   * draft 的实时镜像。
   *
   * 「确定」按钮和 Checkbox 在同一个渲染周期里，若直接读 draft 闭包变量，
   * 会在「勾选后立刻点确定」时读到旧值、丢掉本次选择（自动化测试必现）。
   * 用 ref 保存最新值，applyDraft() 永远拿到用户最后一次勾选。
   */
  const draftRef = useRef<string[]>(values);

  // 打开时同步外部值
  const openPanel = () => {
    draftRef.current = values;
    setDraft(values);
    setKw('');
    setOpen(true);
  };

  const applyDraft = () => {
    onApply(draftRef.current);
    setOpen(false);
  };

  const clearDraft = () => {
    draftRef.current = [];
    setDraft([]);
  };

  const shown = useMemo(() => {
    const k = kw.trim().toLowerCase();
    const list = k ? options.filter((o) => o.toLowerCase().includes(k)) : options;
    return list;
  }, [options, kw]);

  const active = values.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        style={active ? BTN_ON : BTN_BASE}
        onMouseEnter={(e) => {
          if (!active) { e.currentTarget.style.borderColor = 'var(--brand3)'; e.currentTarget.style.color = 'var(--brand)'; }
        }}
        onMouseLeave={(e) => {
          if (!active) { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text2)'; }
        }}
      >
        {icon}
        <span>{multiLabel(values, allLabel)}</span>
        {active && <CountBadge n={values.length} on />}
      </button>

      <Modal
        title={
          <Space size={6}>
            {icon}
            <span>{label}</span>
          </Space>
        }
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={clearDraft}>清空</Button>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" onClick={applyDraft}>
              确定
            </Button>
          </Space>
        }
        width={480}
        styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
      >
        {searchable && options.length > 8 && (
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        )}
        {shown.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无可选项" />
        ) : (
          <Checkbox.Group
            value={draft}
            onChange={(v) => {
              draftRef.current = v as string[];
              setDraft(v as string[]);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
          >
            {shown.map((o) => (
              <Checkbox key={o} value={o} style={{ marginLeft: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span>{o}</span>
                  {counts && counts[o] !== undefined && (
                    <span
                      style={{
                        fontSize: 11, padding: '0 6px', borderRadius: 9,
                        background: 'var(--bg-card-2)', color: 'var(--text-sub)',
                        border: '1px solid var(--border)', lineHeight: '17px',
                      }}
                    >
                      {counts[o]}
                    </span>
                  )}
                </span>
              </Checkbox>
            ))}
          </Checkbox.Group>
        )}
      </Modal>
    </>
  );
}

/* ══════════════ 日期弹窗（左按钮 + 右日历） ══════════════ */

function DateFilter({ filters, onChange, isMobile }: {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** 日历首次点击 = 开始，再次点击 = 结束 */
  const [pickedStart, setPickedStart] = useState<Dayjs | null>(null);
  const [hoverEnd, setHoverEnd] = useState<Dayjs | null>(null);

  const label = dateButtonLabel(filters);
  const active = filters.datePreset !== 'all';

  const openPanel = () => {
    setPickedStart(filters.dateFrom ? dayjs(filters.dateFrom) : null);
    setHoverEnd(filters.dateTo ? dayjs(filters.dateTo) : null);
    setOpen(true);
  };

  const applyPreset = (preset: DatePreset) => {
    if (preset === 'all') {
      onChange({ datePreset: 'all', dateFrom: '', dateTo: '' });
      setOpen(false);
      return;
    }
    const r = presetRange(preset);
    if (!r) return;
    onChange({ datePreset: preset, dateFrom: r[0], dateTo: r[1] });
    setOpen(false);
  };

  /** 日历点选 */
  const onSelectDay = (d: Dayjs) => {
    if (!pickedStart) {
      // 第一次点击 = 开始
      setPickedStart(d.startOf('day'));
      setHoverEnd(null);
      return;
    }
    // 第二次点击 = 结束（若早于开始则交换）
    let a = pickedStart;
    let b = d.startOf('day');
    if (b.isBefore(a, 'day')) [a, b] = [b, a];
    onChange({
      datePreset: 'custom',
      dateFrom: a.format('YYYY-MM-DD'),
      dateTo: b.format('YYYY-MM-DD'),
    });
    setPickedStart(null);
    setHoverEnd(null);
    setOpen(false);
  };

  /** RangePicker 兜底（移动端更易操作） */
  const onRange = (vals: any) => {
    if (!vals || !vals[0] || !vals[1]) return;
    onChange({
      datePreset: 'custom',
      dateFrom: vals[0].format('YYYY-MM-DD'),
      dateTo: vals[1].format('YYYY-MM-DD'),
    });
    setOpen(false);
  };

  const cellRender = (current: Dayjs, info: any) => {
    if (info.type !== 'date') return info.originNode;
    const start = pickedStart;
    const end = hoverEnd;
    if (!start) return info.originNode;
    const inRange = end
      ? (current.isAfter(start, 'day') && current.isBefore(end, 'day'))
      : false;
    const isEdge = current.isSame(start, 'day') || (end ? current.isSame(end, 'day') : false);
    if (!isEdge && !inRange) return info.originNode;
    return (
      <div
        style={{
          borderRadius: 6,
          background: isEdge ? 'var(--primary)' : 'rgba(54,135,255,.14)',
          color: isEdge ? '#fff' : 'var(--text-main)',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {current.date()}
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        style={active ? BTN_ON : BTN_BASE}
        onMouseEnter={(e) => {
          if (!active) { e.currentTarget.style.borderColor = 'var(--brand3)'; e.currentTarget.style.color = 'var(--brand)'; }
        }}
        onMouseLeave={(e) => {
          if (!active) { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text2)'; }
        }}
      >
        {ICON.calendar}
        <span>{label}</span>
      </button>

      <Modal
        title={<Space size={6}><CalendarOutlined /><span>日期筛选</span></Space>}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={isMobile ? '94vw' : 720}
        styles={{ body: { paddingTop: 8 } }}
      >
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 14 }}>
          {/* 左：快捷按钮 */}
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'row' : 'column',
              flexWrap: 'wrap',
              gap: 8,
              minWidth: isMobile ? 'auto' : 120,
            }}
          >
            {PRESET_LABELS.map((p) => {
              const r = presetRange(p.key);
              const on = filters.datePreset === p.key;
              return (
                <Tooltip key={p.key} title={r ? `${r[0]} ~ ${r[1]}` : ''} placement="right">
                  <Button
                    block={!isMobile}
                    type={on ? 'primary' : 'default'}
                    onClick={() => applyPreset(p.key)}
                    style={{ borderColor: on ? 'var(--primary)' : 'var(--border)' }}
                  >
                    {p.label}
                  </Button>
                </Tooltip>
              );
            })}
            <Button
              block={!isMobile}
              type={filters.datePreset === 'all' ? 'primary' : 'default'}
              onClick={() => applyPreset('all')}
              style={{ borderColor: filters.datePreset === 'all' ? 'var(--primary)' : 'var(--border)' }}
            >
              全部
            </Button>
          </div>

          <Divider type={isMobile ? 'horizontal' : 'vertical'} style={{ margin: 0 }} />

          {/* 右：日历 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
              {pickedStart
                ? `已选开始 ${pickedStart.format('MM/DD')}，请点击结束日期`
                : '首次点击选择开始日期，再次点击选择结束日期'}
            </div>
            <Calendar
              fullscreen={!isMobile}
              fullCellRender={undefined as any}
              cellRender={cellRender as any}
              onSelect={(d: Dayjs, info: any) => {
                if (info?.source === 'date') onSelectDay(d);
              }}
              onPanelChange={() => { /* 保持当前面板 */ }}
            />
            <div style={{ marginTop: 10 }}>
              <RangePicker
                value={
                  filters.dateFrom && filters.dateTo
                    ? [dayjs(filters.dateFrom), dayjs(filters.dateTo)]
                    : null
                }
                onChange={onRange}
                style={{ width: '100%' }}
                placeholder={['开始日期', '结束日期']}
              />
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ══════════════ 全部筛选条件（Drawer） ══════════════ */

interface AllFilterProps {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  options: BoardOptions;
  counts: BoardCounts;
}

const ALL_GROUPS: {
  key: keyof BoardFilters;
  title: string;
  optKey: keyof BoardOptions;
  countKey: keyof BoardCounts;
}[] = [
  { key: 'flowStatus', title: '流程状态', optKey: 'flowStatus', countKey: 'flowStatus' },
  { key: 'service', title: '客服', optKey: 'service', countKey: 'service' },
  { key: 'solution', title: '解决方案', optKey: 'solution', countKey: 'solution' },
  { key: 'trainer', title: '培训人', optKey: 'trainer', countKey: 'trainer' },
  { key: 'version', title: '对接版本', optKey: 'version', countKey: 'version' },
  { key: 'connectResult', title: '对接结果', optKey: 'connectResult', countKey: 'connectResult' },
  { key: 'trainResult', title: '培训结果', optKey: 'trainResult', countKey: 'trainResult' },
  { key: 'openedStrategy', title: '已开通策略', optKey: 'openedStrategy', countKey: 'openedStrategy' },
];

function AllFilters({ filters, onChange, options, counts }: AllFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BoardFilters>(filters);
  /** draft 实时镜像：勾选后立刻点「确定」也能拿到最新值（同 MultiSelect 的说明） */
  const draftRef = useRef<BoardFilters>(filters);

  const openPanel = () => {
    draftRef.current = filters;
    setDraft(filters);
    setOpen(true);
  };

  const setGroup = (key: keyof BoardFilters, val: string[]) => {
    const next = { ...draftRef.current, [key]: val } as BoardFilters;
    draftRef.current = next;
    setDraft(next);
  };

  const apply = () => {
    const patch: Partial<BoardFilters> = {};
    ALL_GROUPS.forEach((g) => {
      (patch as any)[g.key] = (draftRef.current as any)[g.key];
    });
    onChange(patch);
    setOpen(false);
  };

  const clearAll = () => {
    const patch: Partial<BoardFilters> = {};
    ALL_GROUPS.forEach((g) => { (patch as any)[g.key] = []; });
    const next = { ...draftRef.current, ...patch } as BoardFilters;
    draftRef.current = next;
    setDraft(next);
    onChange(patch);
  };

  const activeCount = ALL_GROUPS.reduce((sum, g) => {
    const v = filters[g.key];
    return sum + (Array.isArray(v) && v.length ? 1 : 0);
  }, 0);

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        style={activeCount ? BTN_ON : BTN_BASE}
        onMouseEnter={(e) => {
          if (!activeCount) { e.currentTarget.style.borderColor = 'var(--brand3)'; e.currentTarget.style.color = 'var(--brand)'; }
        }}
        onMouseLeave={(e) => {
          if (!activeCount) { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text2)'; }
        }}
      >
        {ICON.filter}
        <span>{activeCount ? `全部条件` : '全部筛选条件'}</span>
        {activeCount > 0 && <CountBadge n={activeCount} on />}
      </button>

      <Drawer
        title="全部筛选条件"
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        styles={{ body: { paddingBottom: 80 } }}
        extra={
          <Space>
            <Button onClick={clearAll}>清空</Button>
            <Button type="primary" onClick={apply}>确定</Button>
          </Space>
        }
      >
        {ALL_GROUPS.map((g) => {
          const opts = (options[g.optKey] as string[]) || [];
          const cnt = (counts[g.countKey] as Record<string, number>) || {};
          const val = ((draft as any)[g.key] as string[]) || [];
          if (!opts.length) {
            return (
              <div key={String(g.key)} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>
                  {g.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>暂无可选项</div>
              </div>
            );
          }
          return (
            <div key={String(g.key)} style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--text-main)',
                  marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {g.title}
                {val.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--primary)' }}>已选 {val.length}</span>
                )}
              </div>
              <Checkbox.Group
                value={val}
                onChange={(v) => setGroup(g.key, v as string[])}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
              >
                {opts.map((o) => (
                  <Checkbox
                    key={o}
                    value={o}
                    style={{
                      marginLeft: 0,
                      padding: '4px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg-card)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>{o}</span>
                      {cnt[o] !== undefined && (
                        <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>{cnt[o]}</span>
                      )}
                    </span>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </div>
          );
        })}
      </Drawer>
    </>
  );
}

/* ══════════════ 主组件 ══════════════ */

export default function FilterBar({
  filters, onChange, onReset, options, counts, isMobile,
}: Props) {
  const regionActive = filters.regions.length > 0;
  const typeActive = filters.chainTypes.length > 0;
  const salesActive = filters.sales.length > 0;
  const anyActive =
    regionActive || typeActive || salesActive || filters.datePreset !== 'all'
    || ALL_GROUPS.some((g) => {
      const v = filters[g.key];
      return Array.isArray(v) && v.length > 0;
    });

  const regionCount = regionActive
    ? filters.regions.reduce((s, r) => s + (counts.region[r] || 0), 0)
    : undefined;
  const typeCount = typeActive
    ? filters.chainTypes.reduce((s, t) => s + (counts.chainType[t] || 0), 0)
    : undefined;
  const salesCount = salesActive
    ? filters.sales.reduce((s, x) => s + (counts.sales[x] || 0), 0)
    : undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 8,
        alignItems: 'center',
        // 窄屏横向滚动而不是撑爆顶栏
        overflowX: 'auto',
        overflowY: 'hidden',
        minWidth: 0,
        // 隐藏滚动条（视觉更干净）
        scrollbarWidth: 'none',
      }}
      className="board-filterbar"
    >
      {/* 1. 日期 */}
      <DateFilter filters={filters} onChange={onChange} isMobile={isMobile} />

      {/* 2. 区域 */}
      <MultiSelect
        label="区域"
        icon={ICON.region}
        values={filters.regions}
        options={options.regions}
        counts={counts.region}
        onApply={(v) => onChange({ regions: v })}
      />

      {/* 3. 连锁类型 */}
      <MultiSelect
        label="连锁类型"
        icon={ICON.type}
        values={filters.chainTypes}
        options={options.chainTypes}
        counts={counts.chainType}
        onApply={(v) => onChange({ chainTypes: v })}
      />

      {/* 4. 销售 */}
      <MultiSelect
        label="销售"
        icon={ICON.sales}
        values={filters.sales}
        options={options.sales}
        counts={counts.sales}
        onApply={(v) => onChange({ sales: v })}
        searchable
      />

      {/* 5. 全部筛选条件 */}
      <AllFilters
        filters={filters}
        onChange={onChange}
        options={options}
        counts={counts}
      />

      {/* 6. 重置 */}
      <Tooltip title="清空所有筛选条件">
        <button
          type="button"
          onClick={onReset}
          disabled={!anyActive}
          style={{
            ...BTN_BASE,
            opacity: anyActive ? 1 : 0.45,
            cursor: anyActive ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={(e) => {
            if (!anyActive) return;
            e.currentTarget.style.borderColor = 'var(--brand3)';
            e.currentTarget.style.color = 'var(--brand)';
          }}
          onMouseLeave={(e) => {
            if (!anyActive) return;
            e.currentTarget.style.borderColor = 'var(--line)';
            e.currentTarget.style.color = 'var(--text2)';
          }}
        >
          {ICON.reset}
          <span>重置</span>
        </button>
      </Tooltip>
    </div>
  );
}
