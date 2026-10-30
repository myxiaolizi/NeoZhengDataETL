/** 第 3 排左：连锁类型分布 — V6.0 视觉升级
 *
 * 设计语言对齐参考站 pc4.html：
 *   .typelist / .tl-row / .tl-top / .tl-name(色点) / .tl-nums / .tl-bar / .tl-reg(南区/北区)
 *   50-（无效类型）整行 opacity .6 淡化
 */
import React, { useMemo } from 'react';
import { Empty } from 'antd';
import { BoardData } from '@/api/crm-board';
import { fmtNum } from './theme';

/** 连锁类型 → 设计令牌（契约 §2.1，禁止自创色值） */
const TYPE_TOKEN: Record<string, string> = {
  全国百强: 'var(--brand)',
  区县百强: 'var(--cyan)',
  '50+': 'var(--green)',
  '50-': 'var(--text3)',
};

function typeColor(name: string): string {
  return TYPE_TOKEN[name] || 'var(--text3)';
}

interface Props {
  data: BoardData;
  loading: boolean;
  isMobile: boolean;
}

/* ══════════════ 局部样式（vb3- 前缀） ══════════════ */
const CSS = `
.vb3-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease;height:100%;min-width:0}
.vb3-card:hover{border-color:var(--brand3);box-shadow:var(--shadow2);transform:translateY(-1px)}
.vb3-h{padding:13px 16px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 60%,transparent),transparent)}
.vb3-h h3{font-size:13px;font-weight:680;color:var(--text);display:flex;align-items:center;gap:8px;margin:0;letter-spacing:.2px;white-space:nowrap}
.vb3-dot{width:6px;height:6px;border-radius:2px;background:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 16%,transparent);flex-shrink:0}
.vb3-hint{font-size:11px;color:var(--text3);font-weight:550;white-space:nowrap}
.vb3-b{padding:15px 16px;flex:1;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}
.vb3-list{display:flex;flex-direction:column;gap:9px}
.vb3-row{padding:11px 12px;border-radius:var(--radius-sm);background:var(--panel2);border:1px solid var(--line);transition:all .15s;min-width:0}
.vb3-row:hover{border-color:var(--brand3);background:var(--brandSoft)}
.vb3-row.off{opacity:.6}
.vb3-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.vb3-name{font-size:12.5px;font-weight:650;display:flex;align-items:center;gap:7px;color:var(--text);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb3-name .d{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.vb3-name .badge{font-size:9.5px;font-weight:600;color:var(--text3);border:1px solid var(--line);border-radius:5px;padding:0 4px;line-height:14px}
.vb3-nums{font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap;flex-shrink:0}
.vb3-nums b{font-size:14px;color:var(--text);font-weight:750;margin-right:1px}
.vb3-nums em{font-style:normal;font-size:10px;font-weight:600;color:var(--text3);margin-left:3px}
.vb3-bar{height:6px;border-radius:4px;background:var(--line2);overflow:hidden;margin-bottom:6px}
.vb3-bar i{display:block;height:100%;border-radius:4px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.vb3-reg{display:flex;gap:14px;font-size:11px;font-weight:600;white-space:nowrap}
.vb3-reg span{display:flex;align-items:center;gap:5px;color:var(--text3)}
.vb3-reg span b{font-weight:700;font-variant-numeric:tabular-nums}
.vb3-reg .s{color:var(--brand)}
.vb3-reg .n{color:var(--green)}
.vb3-reg .st{color:var(--text2)}
.vb3-empty{padding:20px 0}
`;

export default function TypeSummary({ data, loading, isMobile }: Props) {
  const items = data.row3.typeDistribution;
  const totalClients = useMemo(() => items.reduce((s, x) => s + x.clients, 0), [items]);
  const maxClients = useMemo(
    () => items.reduce((m, x) => Math.max(m, x.clients), 0) || 1,
    [items],
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="vb3-card">
        <div className="vb3-h">
          <h3>
            <span className="vb3-dot" />
            连锁类型分布
          </h3>
          <span className="vb3-hint">共 {fmtNum(totalClients)} 家</span>
        </div>
        <div className="vb3-b">
          {items.length === 0 ? (
            <div className="vb3-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>
          ) : (
            <div className="vb3-list">
              {items.map((t) => {
                const color = typeColor(t.name);
                const isInvalid = t.name === '50-';
                const w = Math.max(2, Math.min(100, (t.clients / maxClients) * 100));
                return (
                  <div key={t.name} className={`vb3-row${isInvalid ? ' off' : ''}`}>
                    <div className="vb3-top">
                      <span className="vb3-name">
                        <span className="d" style={{ background: color }} />
                        {t.name}
                        {isInvalid && <span className="badge">无效</span>}
                      </span>
                      <span className="vb3-nums">
                        <b>{fmtNum(t.clients)}</b> 户<em>· {fmtNum(t.stores)} 门店</em>
                      </span>
                    </div>
                    <div className="vb3-bar">
                      <i style={{ width: `${w}%`, background: color }} />
                    </div>
                    <div className="vb3-reg">
                      <span className="s">南区 <b>{t.south}</b> 家</span>
                      <span className="n">北区 <b>{t.north}</b> 家</span>
                      <span className="st">占比 <b>{totalClients ? ((t.clients / totalClients) * 100).toFixed(1) : '0.0'}%</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
