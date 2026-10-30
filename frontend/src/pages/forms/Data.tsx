/** 表单数据：提交记录列表（动态列）/ 详情 / 导出（含移动端适配） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Button, Card, Descriptions, Drawer, Empty, Grid, Input, Pagination, Space,
  Statistic, Tag, Tooltip, message,
} from 'antd';
import {
  DownloadOutlined, LeftOutlined, ReloadOutlined, RightOutlined, SearchOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import { formsApi } from '@/api/forms';
import type { FormDetail, FormField, FormRecord } from '@/api/forms';
import { formatFieldValue } from '@/pages/forms/fieldTypes';
import { fmtTime } from '@/utils';

const { useBreakpoint } = Grid;

/** 调色板（契约唯一允许的 13 色） */
const C = {
  primary: '#3687FF',
  blue: '#2D6FE4',
  deep: '#003378',
  green: '#A2D73C',
  orange: '#EC673C',
  red: '#E86161',
  yellow: '#FFC000',
  gray: '#B5B5B6',
  line: '#DCDDDD',
};

const PAGE_SIZE = 20;

const STATUS_META: Record<string, { text: string; color: string }> = {
  ok: { text: '正常', color: C.green },
  partial: { text: '部分成功', color: C.yellow },
  invalid: { text: '校验失败', color: C.red },
};

export default function FormDataPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [records, setRecords] = useState<FormRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [active, setActive] = useState<FormRecord | null>(null);

  /* 表单定义 */
  useEffect(() => {
    if (!id) return;
    formsApi
      .detail(id)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null));
  }, [id]);

  /* 提交记录 */
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await formsApi.records(id, { page, pageSize: PAGE_SIZE, keyword });
      setRecords(res.list || []);
      setTotal(res.total || 0);
    } catch {
      /* client 已提示 */
    } finally {
      setLoading(false);
    }
  }, [id, page, keyword]);

  useEffect(() => {
    load();
  }, [load]);

  const fields = useMemo(
    () => (detail?.fields || []).filter((f) => f.type !== 'divider' && f.type !== 'section'),
    [detail]
  );

  const doExport = async () => {
    if (!id) return;
    setExporting(true);
    try {
      await formsApi.exportCsv(id, `${detail?.code || 'form'}_${Date.now()}.csv`);
      message.success('导出完成');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  /* ---------- 列 ---------- */
  const columns: ProColumns<FormRecord>[] = useMemo(() => {
    const fieldCols: ProColumns<FormRecord>[] = fields.map((f: FormField) => ({
      title: f.label,
      key: f.key,
      width: 150,
      ellipsis: true,
      render: (_: React.ReactNode, record: FormRecord) => {
        const text = formatFieldValue(f, record.data?.[f.key]);
        return <span title={text}>{text}</span>;
      },
    }));

    return [
      {
        title: '提交时间',
        dataIndex: 'created_at',
        width: 165,
        fixed: 'left',
        render: (_: React.ReactNode, record: FormRecord) => (
          <span style={{ fontSize: 12.5 }}>{fmtTime(record.created_at)}</span>
        ),
      },
      {
        title: '提交人',
        dataIndex: 'submitter',
        width: 110,
        render: (_: React.ReactNode, record: FormRecord) => record.submitter || '匿名用户',
      },
      ...fieldCols,
      {
        title: '提交 IP',
        dataIndex: 'ip',
        width: 130,
        render: (_: React.ReactNode, record: FormRecord) => (
          <span style={{ fontSize: 12, color: C.gray }}>{record.ip || '-'}</span>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        render: (_: React.ReactNode, record: FormRecord) => {
          const meta = STATUS_META[record.status] || { text: record.status, color: C.gray };
          return (
            <Tag style={{ color: meta.color, background: '#FFFFFF', borderColor: meta.color }}>
              {meta.text}
            </Tag>
          );
        },
      },
      {
        title: '操作',
        valueType: 'option',
        width: 90,
        fixed: 'right',
        render: (_: React.ReactNode, record: FormRecord) => [
          <a key="view" onClick={() => setActive(record)}>
            详情
          </a>,
        ],
      },
    ];
  }, [fields]);

  /* ---------- 详情内容 ---------- */
  const detailContent = active ? (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Descriptions
        size="small"
        column={1}
        bordered
        items={[
          { key: 'time', label: '提交时间', children: fmtTime(active.created_at) },
          { key: 'submitter', label: '提交人', children: active.submitter || '匿名用户' },
          { key: 'ip', label: '提交 IP', children: active.ip || '-' },
          {
            key: 'status',
            label: '状态',
            children: STATUS_META[active.status]?.text || active.status,
          },
          ...(active.message
            ? [{ key: 'msg', label: '备注', children: active.message }]
            : []),
          ...(active.user_agent
            ? [{ key: 'ua', label: '浏览器', children: <span style={{ fontSize: 12 }}>{active.user_agent}</span> }]
            : []),
        ]}
      />
      <Card size="small" title="提交内容">
        <Descriptions
          size="small"
          column={1}
          bordered
          items={fields.map((f) => ({
            key: f.key,
            label: f.label,
            children: <span style={{ wordBreak: 'break-all' }}>{formatFieldValue(f, active.data?.[f.key])}</span>,
          }))}
        />
      </Card>
      <Card size="small" title="原始 JSON">
        <pre
          style={{
            margin: 0, fontSize: 12, background: 'rgba(54,135,255,.04)', padding: 10,
            borderRadius: 8, overflow: 'auto', maxHeight: 240,
          }}
        >
          {JSON.stringify(active.data, null, 2)}
        </pre>
      </Card>
    </Space>
  ) : null;

  /* ---------- 移动端卡片 ---------- */
  const mobileList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {records.length === 0 ? (
        <Empty description={loading ? '加载中…' : '还没有提交数据'} />
      ) : (
        records.map((record) => (
          <Card key={record.id} size="small" onClick={() => setActive(record)} styles={{ body: { padding: 14 } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: C.gray }}>{fmtTime(record.created_at)}</span>
              <Tag
                style={{
                  color: (STATUS_META[record.status] || { color: C.gray }).color,
                  background: '#FFFFFF',
                  borderColor: (STATUS_META[record.status] || { color: C.gray }).color,
                  marginInlineEnd: 0,
                }}
              >
                {STATUS_META[record.status]?.text || record.status}
              </Tag>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: C.deep }}>
              {fields
                .filter((f) => {
                  const v = record.data?.[f.key];
                  return v !== null && v !== undefined && v !== '';
                })
                .slice(0, 3)
                .map((f) => `${f.label}：${formatFieldValue(f, record.data?.[f.key])}`)
                .join('　') || '（无内容）'}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: C.gray }}>
              提交人：{record.submitter || '匿名用户'} · IP：{record.ip || '-'}
            </div>
          </Card>
        ))
      )}
      <div style={{ textAlign: 'center', paddingTop: 4 }}>
        <Pagination
          simple
          current={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={(p) => setPage(p)}
        />
      </div>
    </div>
  );

  return (
    <Page
      title={`表单数据${detail ? ` · ${detail.name}` : ''}`}
      subTitle={detail ? `${detail.code} · 共 ${total} 条提交记录` : '加载中…'}
      extra={
        <Space wrap size={8}>
          <Button icon={<LeftOutlined />} onClick={() => navigate('/forms')}>
            返回表单中心
          </Button>
          <Button
            icon={<RightOutlined />}
            onClick={() => navigate(`/forms/${id}/design`)}
          >
            表单设计
          </Button>
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={doExport}>
            导出 CSV
          </Button>
        </Space>
      }
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic title="提交总数" value={detail?.submitCount ?? total} styles={{ content: { color: C.primary, fontWeight: 700 } }} />
        </Card>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic title="字段数" value={fields.length} styles={{ content: { color: C.blue, fontWeight: 700 } }} />
        </Card>
        <Card size="small" style={{ flex: 1, minWidth: 150 }} styles={{ body: { padding: 14 } }}>
          <Statistic title="当前页" value={records.length} styles={{ content: { color: C.orange, fontWeight: 700 } }} />
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: C.gray }} />}
          placeholder="搜索提交内容 / 提交人 / IP"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onPressEnter={() => {
            setPage(1);
            setKeyword(searchText.trim());
          }}
          style={{ width: isMobile ? '100%' : 320 }}
        />
        <Space>
          <Button
            type="primary"
            onClick={() => {
              setPage(1);
              setKeyword(searchText.trim());
            }}
          >
            搜索
          </Button>
          <Tooltip title="重新加载当前页">
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          </Tooltip>
          {keyword && (
            <Button
              onClick={() => {
                setSearchText('');
                setKeyword('');
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          )}
        </Space>
      </div>

      {isMobile ? (
        mobileList
      ) : (
        <>
          <ProTable<FormRecord>
            rowKey="id"
            columns={columns}
            dataSource={records}
            loading={loading}
            search={false}
            options={false}
            cardBordered
            headerTitle="提交记录"
            toolBarRender={false}
            pagination={false}
            scroll={{ x: Math.max(900, 280 + fields.length * 150) }}
            locale={{ emptyText: <Empty description="还没有提交数据" /> }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              showTotal={(t) => `共 ${t} 条`}
              onChange={(p) => setPage(p)}
            />
          </div>
        </>
      )}

      <Drawer
        title="提交详情"
        placement="right"
        size={isMobile ? '100%' : 560}
        open={!!active}
        onClose={() => setActive(null)}
      >
        {detailContent}
      </Drawer>
    </Page>
  );
}
