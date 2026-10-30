/** 治理总览：数据资产统计卡片 + 质量概览 + 表结构对照 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Empty, Grid, Modal, Progress, Row, Space,
  Table, Tag, Typography,
} from 'antd';
import {
  DatabaseOutlined, FileSearchOutlined, ProjectOutlined,
  TableOutlined, TagsOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { useAppStore, usePermission } from '@/stores/app';
import { getGovernanceOverview, getProjectSchema } from '@/api/users';
import type { GovernanceRow, ProjectSchema, SchemaColumn } from '@/api/users';
import { PALETTE, NEUTRAL } from '@/theme';
import { fmtNum, fmtTime } from '@/utils';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const C = {
  primary: PALETTE.primary,
  blue: PALETTE.primary,
  navy: NEUTRAL.text,
  cyan: PALETTE.cyan,
  green: PALETTE.green,
  yellow: PALETTE.yellow,
  orange: PALETTE.orange,
  red: PALETTE.red,
  gray: NEUTRAL.textTertiary,
  line: NEUTRAL.border,
} as const;

function softStyle(color: string): React.CSSProperties {
  return { background: `${color}1A`, color, border: 'none', borderRadius: 6, margin: 0, fontSize: 12 };
}

/** 解析方式中文名 */
const PARSE_MODE: Record<string, string> = {
  none: '不解析',
  expand: '展开子表',
  json: 'JSON 取路径',
  array: '数组展开',
};

export default function GovernancePage() {
  const currentUser = useAppStore((s) => s.user);
  const can = usePermission();
  const canRead = !!currentUser && can('project:read');
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [list, setList] = useState<GovernanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schema, setSchema] = useState<ProjectSchema | null>(null);
  const [schemaTitle, setSchemaTitle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getGovernanceOverview();
      setList(rows);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '需要「查看项目」权限');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 汇总指标 */
  const summary = useMemo(() => {
    const projects = list.length;
    const dataRows = list.reduce((s, x) => s + (x.dataCount || 0), 0);
    const parsedRows = list.reduce((s, x) => s + (x.parsedCount || 0), 0);
    const fieldTotal = list.reduce((s, x) => s + (x.fieldTotal || 0), 0);
    const fieldParsed = list.reduce((s, x) => s + (x.fieldParsed || 0), 0);
    const rawCols = list.reduce((s, x) => s + (x.rawCols || 0), 0);
    const commented = list.reduce((s, x) => s + (x.commentedCols || 0), 0);
    const noRemark = list.reduce((s, x) => s + (x.fieldNoRemark || 0), 0);
    return {
      projects,
      dataRows,
      parsedRows,
      fieldTotal,
      fieldParsed,
      rawCols,
      commented,
      noRemark,
      commentPct: rawCols ? Math.round((commented / rawCols) * 100) : 0,
      parsePct: fieldTotal ? Math.round((fieldParsed / fieldTotal) * 100) : 0,
      remarkPct: fieldTotal ? Math.round(((fieldTotal - noRemark) / fieldTotal) * 100) : 0,
    };
  }, [list]);

  const showSchema = async (row: GovernanceRow) => {
    setSchemaOpen(true);
    setSchemaTitle(`${row.name} — 表结构对照`);
    setSchemaLoading(true);
    setSchema(null);
    try {
      const data = await getProjectSchema(row.id);
      setSchema(data);
    } catch {
      /* client 已提示 */
    } finally {
      setSchemaLoading(false);
    }
  };

  const stats = useMemo<StatCardItem[]>(() => [
    { key: 'projects', label: '数据项目', value: summary.projects, suffix: '个', color: PALETTE.primary },
    { key: 'dataRows', label: '数据总条数', value: fmtNum(summary.dataRows), color: PALETTE.cyan },
    { key: 'parsedRows', label: '解析后条数', value: fmtNum(summary.parsedRows), color: PALETTE.green },
    { key: 'fieldTotal', label: '字段定义', value: summary.fieldTotal, color: PALETTE.orange },
    { key: 'commentPct', label: '注释覆盖率', value: summary.commentPct, suffix: '%', color: PALETTE.yellow },
  ], [summary]);

  const columnColumns = [
    { title: '列名', dataIndex: 'name', width: 220, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: '类型', dataIndex: 'columnType', width: 170, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: '注释', dataIndex: 'comment', render: (v: string) => <Text style={{ fontSize: 12, color: v ? C.navy : C.gray }}>{v || '-'}</Text> },
  ];

  const assetColumns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '项目',
      dataIndex: 'name',
      width: 180,
      render: (_: unknown, r: GovernanceRow) => (
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>{r.name}</div>
          <div style={{ fontSize: 11.5, color: C.gray }}>{r.code || '-'}</div>
        </div>
      ),
    },
    {
      title: '数据源',
      dataIndex: 'datasourceName',
      width: 150,
      render: (v: string) => <Text style={{ fontSize: 12.5 }}>{v}</Text>,
    },
    {
      title: '原始表 / 解析表',
      dataIndex: 'dataTable',
      width: 260,
      render: (_: unknown, r: GovernanceRow) => (
        <div style={{ lineHeight: 1.6 }}>
          <div><Text code style={{ fontSize: 11.5 }}>{r.dataTable || '-'}</Text></div>
          <div><Text code style={{ fontSize: 11.5, color: C.gray }}>{r.parsedTable || '-'}</Text></div>
        </div>
      ),
    },
    {
      title: '数据条数',
      dataIndex: 'dataCount',
      width: 110,
      align: 'right' as const,
      render: (v: number, r: GovernanceRow) => (
        <div style={{ lineHeight: 1.5, textAlign: 'right' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>{fmtNum(v)}</div>
          <div style={{ fontSize: 11, color: C.gray }}>解析 {fmtNum(r.parsedCount)}</div>
        </div>
      ),
    },
    {
      title: '字段定义',
      dataIndex: 'fieldTotal',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: GovernanceRow) =>
        v ? (
          <Space size={4} orientation="vertical" style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12.5 }}>{v}</Text>
            {r.fieldParsed ? <Tag style={softStyle(C.primary)}>解析 {r.fieldParsed}</Tag> : null}
          </Space>
        ) : (
          <Text style={{ fontSize: 12, color: C.gray }}>未配置</Text>
        ),
    },
    {
      title: '注释覆盖',
      dataIndex: 'commentedCols',
      width: 140,
      render: (_: unknown, r: GovernanceRow) => {
        const pct = r.rawCols ? Math.round((r.commentedCols / r.rawCols) * 100) : 0;
        const color = pct >= 90 ? C.green : pct >= 60 ? C.yellow : C.orange;
        return (
          <div>
            <div style={{ fontSize: 11.5, color: C.gray, marginBottom: 2 }}>{pct}%</div>
            <Progress percent={pct} showInfo={false} size="small" strokeColor={color} railColor={NEUTRAL.surfaceSunken} />
          </div>
        );
      },
    },
    {
      title: '最近推送',
      dataIndex: 'lastPushAt',
      width: 150,
      render: (v: string | null) => (
        <Text style={{ fontSize: 12, color: v ? C.navy : C.gray }}>{v ? fmtTime(v, 'YYYY-MM-DD HH:mm') : '从未推送'}</Text>
      ),
    },
    {
      title: '操作',
      dataIndex: 'op',
      width: 100,
      fixed: 'right' as const,
      render: (_: unknown, r: GovernanceRow) => (
        <Button size="small" type="link" onClick={() => showSchema(r)}>
          表结构
        </Button>
      ),
    },
  ];

  return (
    <Page
      title="治理总览"
      stats={stats}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        {error ? <Alert type="error" showIcon title="治理数据加载失败" description={error} /> : null}

        {!canRead ? (
          <Alert type="warning" showIcon title="当前账号没有「查看项目」权限，治理总览仅展示空数据" />
        ) : null}

        {/* 质量概览 */}
        <Row gutter={[12, 12]}>
          <Col xs={24} xl={10}>
            <Card
              size="small"
              style={{ borderColor: C.line, height: '100%' }}
              title={<span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>数据质量概览</span>}
            >
              <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                {[
                  { label: '字段注释覆盖率', pct: summary.commentPct, color: C.green, hint: `${summary.commented}/${summary.rawCols} 列已有注释` },
                  { label: '字段解析率', pct: summary.parsePct, color: C.primary, hint: `${summary.fieldParsed}/${summary.fieldTotal} 个字段已配置解析` },
                  { label: '字段说明完整度', pct: summary.remarkPct, color: C.cyan, hint: `${summary.fieldTotal - summary.noRemark}/${summary.fieldTotal} 个字段已填写说明` },
                ].map((m) => (
                  <div key={m.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, color: C.navy, fontWeight: 500 }}>{m.label}</span>
                      <span style={{ fontSize: 12.5, color: m.color, fontWeight: 600 }}>{m.pct}%</span>
                    </div>
                    <Progress
                      percent={m.pct}
                      showInfo={false}
                      strokeColor={m.color}
                      railColor={NEUTRAL.surfaceSunken}
                      size={['100%', 8]}
                    />
                    <div style={{ fontSize: 11.5, color: C.gray, marginTop: 2 }}>{m.hint}</div>
                  </div>
                ))}
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={14}>
            <Card
              size="small"
              style={{ borderColor: C.line, height: '100%' }}
              title={<span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>数据资产分布</span>}
            >
              {list.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中…' : '暂无数据项目'} />
              ) : (
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                  {list.map((r) => {
                    const max = Math.max(...list.map((x) => x.dataCount || 0), 1);
                    const width = Math.max(2, Math.round(((r.dataCount || 0) / max) * 100));
                    return (
                      <div key={r.id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8 }}>
                          <span style={{ fontSize: 12.5, color: C.navy, fontWeight: 500 }}>{r.name}</span>
                          <span style={{ fontSize: 11.5, color: C.gray, flexShrink: 0 }}>{fmtNum(r.dataCount)} 条</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: NEUTRAL.surfaceSunken, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${width}%`,
                              height: '100%',
                              borderRadius: 4,
                              background: `linear-gradient(90deg, ${PALETTE.primary}, ${PALETTE.primaryLight})`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </Space>
              )}
            </Card>
          </Col>
        </Row>

        {/* 资产清单 */}
        <Card
          size="small"
          style={{ borderColor: C.line }}
          title={
            <Space size={8}>
              <DatabaseOutlined style={{ color: C.primary }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>数据资产清单</span>
              <Tag style={softStyle(C.blue)}>{list.length}</Tag>
            </Space>
          }
          extra={<Text style={{ fontSize: 11.5, color: C.gray }}>每个项目对应「解析前」与「解析后」两张数据表</Text>}
          styles={{ body: { padding: 0 } }}
        >
          <Table<GovernanceRow>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={list}
            columns={assetColumns}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: '暂无数据项目' }}
          />
        </Card>
      </Space>

      {/* 表结构对照 */}
      <Modal
        title={schemaTitle}
        open={schemaOpen}
        onCancel={() => setSchemaOpen(false)}
        footer={<Button onClick={() => setSchemaOpen(false)}>关闭</Button>}
        width={isMobile ? '100%' : 1080}
        style={isMobile ? { top: 12, maxWidth: 'calc(100vw - 24px)' } : undefined}
        destroyOnHidden
      >
        {schemaLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: C.gray }}>加载中…</div>
        ) : !schema ? (
          <Empty description="暂无表结构数据" />
        ) : (
          <Space orientation="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions
              size="small"
              column={isMobile ? 1 : 2}
              bordered
              items={[
                { key: 'name', label: '项目', children: schema.project.name },
                { key: 'code', label: '项目编码', children: schema.project.code || '-' },
                { key: 'raw', label: '原始数据表', children: <Text code>{schema.project.dataTable}</Text> },
                { key: 'parsed', label: '解析数据表', children: <Text code>{schema.project.parsedTable}</Text> },
              ]}
            />

            <Row gutter={[12, 12]}>
              <Col xs={24} lg={12}>
                <Card
                  size="small"
                  title={<span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>解析前（原始数据表）</span>}
                  extra={<Tag style={softStyle(C.gray)}>{schema.rawColumns.length} 列</Tag>}
                  styles={{ body: { padding: 0 } }}
                >
                  <Table<SchemaColumn>
                    rowKey="name"
                    size="small"
                    dataSource={schema.rawColumns}
                    columns={columnColumns}
                    pagination={false}
                    scroll={{ y: 300 }}
                    locale={{ emptyText: '无列信息' }}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card
                  size="small"
                  title={<span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>解析后（解析数据表）</span>}
                  extra={<Tag style={softStyle(C.primary)}>{schema.parsedColumns.length} 列</Tag>}
                  styles={{ body: { padding: 0 } }}
                >
                  <Table<SchemaColumn>
                    rowKey="name"
                    size="small"
                    dataSource={schema.parsedColumns}
                    columns={columnColumns}
                    pagination={false}
                    scroll={{ y: 300 }}
                    locale={{ emptyText: '无列信息' }}
                  />
                </Card>
              </Col>
            </Row>

            <Card
              size="small"
              title={<span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>字段定义与解析规则</span>}
              extra={<Tag style={softStyle(C.orange)}>{schema.fieldDefs.length} 个字段</Tag>}
              styles={{ body: { padding: 0 } }}
            >
              <Table
                rowKey="id"
                size="small"
                dataSource={schema.fieldDefs}
                pagination={false}
                scroll={{ x: 'max-content', y: 260 }}
                locale={{ emptyText: '无字段定义' }}
                columns={[
                  { title: '字段名称', dataIndex: 'field_name', width: 160 },
                  { title: '字段ID', dataIndex: 'field_key', width: 150, render: (v: string) => <Text code style={{ fontSize: 11.5 }}>{v}</Text> },
                  { title: '列名', dataIndex: 'column_name', width: 180, render: (v: string) => <Text code style={{ fontSize: 11.5 }}>{v}</Text> },
                  {
                    title: '解析方式',
                    dataIndex: 'parse_mode',
                    width: 110,
                    render: (v: string) => (
                      <Tag style={softStyle(v === 'none' ? C.gray : C.primary)}>{PARSE_MODE[v] || v || '-'}</Tag>
                    ),
                  },
                  { title: '说明', dataIndex: 'remark', render: (v: string | null) => <Text style={{ fontSize: 12, color: v ? C.navy : C.gray }}>{v || '-'}</Text> },
                ]}
              />
            </Card>
          </Space>
        )}
      </Modal>
    </Page>
  );
}