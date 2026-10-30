/** 表单数据（V6.1 页面规范）：提交记录列表（动态列）/ 详情 / 导出（含移动端适配）
 *
 * 结构：[返回] 本页名称 + 搜索区 + 操作 → 数据卡片 → 提交记录列表
 * V6.1：提交详情用 Modal（禁止抽屉承载业务内容）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert, Button, Card, Descriptions, Empty, Grid, Input, Modal, Pagination, Space,
  Tag, message,
} from 'antd';
import {
  DownloadOutlined, EditOutlined, ReloadOutlined,
} from '@ant-design/icons';
import Page from '@/components/Page';
import type { StatCardItem } from '@/components/StatCards';
import { NEUTRAL, PALETTE } from '@/theme';
import { formsApi } from '@/api/forms';
import type { FormDetail, FormField, FormRecord } from '@/api/forms';
import { formatFieldValue } from '@/pages/forms/fieldTypes';
import { fmtNum, fmtTime } from '@/utils';

const { useBreakpoint } = Grid;

const PAGE_SIZE = 20;

const STATUS_META: Record<string, { text: string; color: string }> = {
  ok: { text: '正常', color: PALETTE.green },
  partial: { text: '部分成功', color: PALETTE.yellow },
  invalid: { text: '校验失败', color: PALETTE.red },
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
  const [error, setError] = useState('');
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
    setError('');
    try {
      const res = await formsApi.records(id, { page, pageSize: PAGE_SIZE, keyword });
      setRecords(res.list || []);
      setTotal(res.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交记录加载失败');
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

  /* ---------- 数据卡片 ---------- */
  const statItems = useMemo<StatCardItem[]>(() => [
    { key: 'total', label: '提交总数', value: fmtNum(detail?.submitCount ?? total), suffix: '条', color: PALETTE.primary },
    { key: 'fields', label: '字段数', value: fmtNum(fields.length), suffix: '个', color: PALETTE.cyan },
    { key: 'page', label: '当前页', value: fmtNum(records.length), suffix: '条', color: PALETTE.orange, hint: `第 ${page} 页` },
  ], [detail, total, fields.length, records.length, page]);

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
        sorter: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')),
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
          <span style={{ fontSize: 12, color: NEUTRAL.textTertiary }}>{record.ip || '-'}</span>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        render: (_: React.ReactNode, record: FormRecord) => {
          const meta = STATUS_META[record.status] || { text: record.status, color: NEUTRAL.textTertiary };
          return (
            <Tag style={{ color: meta.color, background: NEUTRAL.surface, borderColor: meta.color, margin: 0 }}>
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

  /* ---------- 移动端卡片 ---------- */
  const mobileList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {records.length === 0 ? (
        <Empty description={loading ? '加载中…' : '还没有提交数据'} />
      ) : (
        records.map((record) => (
          <Card key={record.id} size="small" onClick={() => setActive(record)} styles={{ body: { padding: 14 } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: NEUTRAL.textTertiary }}>{fmtTime(record.created_at)}</span>
              <Tag
                style={{
                  color: (STATUS_META[record.status] || { color: NEUTRAL.textTertiary }).color,
                  background: NEUTRAL.surface,
                  borderColor: (STATUS_META[record.status] || { color: NEUTRAL.border }).color,
                  marginInlineEnd: 0,
                }}
              >
                {STATUS_META[record.status]?.text || record.status}
              </Tag>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: NEUTRAL.text }}>
              {fields
                .filter((f) => {
                  const v = record.data?.[f.key];
                  return v !== null && v !== undefined && v !== '';
                })
                .slice(0, 3)
                .map((f) => `${f.label}：${formatFieldValue(f, record.data?.[f.key])}`)
                .join('　') || '（无内容）'}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: NEUTRAL.textTertiary }}>
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
      back="/forms"
      backText="返回表单中心"
      title={detail ? detail.name : '表单数据'}
      search={
        <Input.Search
          allowClear
          placeholder="搜索提交内容 / 提交人 / IP"
          value={searchText}
          onChange={(e) => {
            const v = e.target.value;
            setSearchText(v);
            if (!v) {
              setPage(1);
              setKeyword('');
            }
          }}
          onSearch={(v) => {
            setPage(1);
            setKeyword(v.trim());
          }}
          style={{ width: isMobile ? '100%' : 260 }}
        />
      }
      actions={
        <>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/forms/${id}/design`)}>
            {isMobile ? '' : '表单设计'}
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={doExport}>
            {isMobile ? '' : '导出 CSV'}
          </Button>
        </>
      }
      stats={statItems}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={load}>重试</Button>}
          style={{ marginBottom: 12 }}
        />
      ) : null}

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

      {/* 提交详情：内容少 → Modal（V6.1 禁止右侧抽屉） */}
      <Modal
        title="提交详情"
        open={!!active}
        onCancel={() => setActive(null)}
        footer={<Button onClick={() => setActive(null)}>关闭</Button>}
        width={isMobile ? '94%' : 640}
        destroyOnHidden
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 } }}
      >
        {active && (
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
                  margin: 0, fontSize: 12, background: NEUTRAL.surfaceSunken, padding: 10,
                  borderRadius: 8, overflow: 'auto', maxHeight: 240, color: NEUTRAL.textSecondary,
                }}
              >
                {JSON.stringify(active.data, null, 2)}
              </pre>
            </Card>
          </Space>
        )}
      </Modal>
    </Page>
  );
}
