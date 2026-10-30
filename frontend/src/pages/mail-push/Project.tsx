/**
 * 邮件推送 · 数据项目详情（V4.1 新页面）
 *
 * 背景：V4.0 里「数据项目」的管理界面曾是右侧抽屉，
 * 内容包含「数据明细 / 项目信息 / 导入日志」三大块 + CSV 导出 + 改配置 + 清空 + 删除，
 * 信息量大，抽屉宽度不够用。按 V4.1 规范改为**独立新页面**。
 *
 * 路由：/mail-push/projects/:id
 *
 * ⚠️ 本文件当前为路由占位骨架，由 mail-push 负责人按 V4.1 规范实现完整功能。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Empty, Input, Modal, Space, Spin, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import Page from '@/components/Page';
import DataTable, { filtersToQuery, type FilterItem, type SortState } from '@/components/DataTable';
import { usePermission } from '@/stores/app';
import { fmtAgo, fmtNum, fmtTime, truncate } from '@/utils';
import { clearMailProject, deleteMailProject, getMailProject, listMailLogs, listMailProjectRows, mailProjectExportUrl, updateMailProject } from '@/api/mail-push';
import type { MailLogRow, MailProject, MailProjectColumn, MailProjectDetail, MailRow } from '@/api/mail-push';
import { NEUTRAL, PALETTE } from '@/theme';

const { Text } = Typography;
const RESULT_META: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: PALETTE.green }, skipped: { label: '跳过', color: PALETTE.yellow }, failed: { label: '失败', color: PALETTE.red },
};

export default function MailPushProjectPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const can = usePermission();
  const [detail, setDetail] = useState<MailProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('records');
  const [rows, setRows] = useState<MailRow[]>([]);
  const [columns, setColumns] = useState<MailProjectColumn[]>([]);
  const [total, setTotal] = useState(0);
  const [rowLoading, setRowLoading] = useState(false);
  const [rowError, setRowError] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<FilterItem[]>([]);
  const [rowsReloadKey, setRowsReloadKey] = useState(0);
  const [logs, setLogs] = useState<MailLogRow[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const project = detail?.project;

  const loadDetail = useCallback(async () => {
    setLoading(true); setError('');
    try { setDetail(await getMailProject(id, 20)); }
    catch (e) { setDetail(null); setError(e instanceof Error ? e.message : '读取项目失败'); }
    finally { setLoading(false); }
  }, [id]);
  const loadRows = useCallback(async (p = 1, s = 20, nextKeyword = '', nextSort: SortState | null = null, nextFilters: FilterItem[] = []) => {
    if (!can('data:read')) return;
    setRowLoading(true);
    setRowError('');
    try {
      const result = await listMailProjectRows(id, {
        page: p,
        size: s,
        keyword: nextKeyword || undefined,
        sort: nextSort?.column,
        order: nextSort?.order,
        filters: filtersToQuery(nextFilters) || undefined,
      });
      setRows(result.rows || []);
      setColumns(result.columns || []);
      setTotal(Number(result.total || 0));
    } catch (e) {
      const nextError = e instanceof Error ? e.message : '读取数据失败';
      message.error(nextError);
      setRowError(nextError);
      setRows([]);
    } finally { setRowLoading(false); }
  }, [can, id, message]);
  const loadLogs = useCallback(async () => {
    if (!can('log:read')) return;
    setLogLoading(true);
    try { setLogs((await listMailLogs({ limit: 100, projectId: id })).filter((r) => Number(r.project_id) === id)); }
    catch (e) { message.error(e instanceof Error ? e.message : '读取导入日志失败'); setLogs([]); }
    finally { setLogLoading(false); }
  }, [can, id, message]);

  /**
   * 数据加载（V4.1 修复：原实现存在**无限请求循环**）
   *
   * 原写法把三个 loader 一并放进同一个 effect 的依赖里，而 loadRows 的
   * useCallback 依赖 detail?.columns —— loadDetail 每次都 setDetail(新对象)，
   * detail.columns 每次都是新数组引用 → loadRows 身份变化 → effect 重跑
   * → 又调 loadDetail …… 实测 6 秒内发出 145 次请求，会打爆后端。
   *
   * 现在拆成两个 effect，且 loadRows 的依赖只剩 [can, id, message]（稳定）：
   *  - effect A：只随 id 变化，拉详情 + 日志（两者互不影响分页）
   *  - effect B：只随分页/搜索/排序/筛选的原始状态变化，拉数据行
   *    （不依赖 detail / columns 等每次请求都会更新的对象引用）
   */
  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) { setLoading(false); setError('项目编号无效'); return; }
    void loadDetail();
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    void loadRows(page, size, keyword, sort, filters);
  }, [filters, id, keyword, loadRows, page, rowsReloadKey, size, sort]);

  const applySearch = useCallback(() => {
    setPage(1);
    setKeyword(keywordInput.trim());
  }, [keywordInput]);
  const resetSearch = useCallback(() => {
    setKeywordInput('');
    setKeyword('');
    setSort(null);
    setFilters([]);
    setPage(1);
  }, []);
  const handleSortChange = useCallback((nextSort: SortState | null) => {
    setPage(1);
    setSort(nextSort);
  }, []);
  const handleFiltersChange = useCallback((nextFilters: FilterItem[]) => {
    setPage(1);
    setFilters(nextFilters);
  }, []);
  const handlePageChange = useCallback((nextPage: number, nextSize: number) => {
    setPage(nextPage);
    setSize(nextSize);
  }, []);
  const exportCsv = () => { const a = document.createElement('a'); a.href = mailProjectExportUrl(id); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); };
  const rename = () => {
    if (!project || !can('project:write')) return;
    let value = project.name;
    modal.confirm({ title: '修改项目名称', content: <Input defaultValue={value} maxLength={100} onChange={(e) => { value = e.target.value; }} />, okText: '保存', cancelText: '取消', onOk: async () => {
      const name = value.replace(/\s+/g, ' ').trim(); if (!name) { message.error('项目名称不能为空'); throw new Error('empty name'); }
      try { const updated = await updateMailProject(id, { name }); setDetail((prev) => prev ? { ...prev, project: updated } : prev); message.success('项目名称已更新'); }
      catch (e) { message.error(e instanceof Error ? e.message : '保存失败'); throw e; }
    } });
  };
  const clear = () => modal.confirm({ title: `清空项目「${project?.name}」的数据`, content: <>此操作仅删除数据行并保留表结构，不可恢复。</>, okText: '清空', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
    try {
      const r = await clearMailProject(id);
      if (r?.ok === false) throw new Error(r.message || '清空失败');
      message.success(r?.message || '数据已清空');
      setPage(1);
      setRowsReloadKey((value) => value + 1);
      void loadDetail();
      void loadLogs();
    } catch (e) { message.error(e instanceof Error ? e.message : '清空失败'); throw e; }
  } });
  const remove = () => modal.confirm({ title: `删除项目「${project?.name}」`, content: <>项目数据表和导入日志将一并删除，且不可恢复。</>, okText: '删除', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
    try { const r = await deleteMailProject(id, true); if (r?.ok === false) throw new Error(r.message || '删除失败'); message.success(r?.message || '项目已删除'); navigate('/mail-push'); }
    catch (e) { message.error(e instanceof Error ? e.message : '删除失败'); throw e; }
  } });
  const projectCols: TableColumnsType<MailProjectColumn> = [
    { title: '序号', dataIndex: 'pos', width: 70 }, { title: '列名', dataIndex: 'name', width: 200, render: (v: string) => <Text code>{v}</Text> },
    { title: '中文名', dataIndex: 'comment', render: (v?: string) => v || '-' }, { title: '类型', dataIndex: 'type', width: 150 }, { title: '键', dataIndex: 'ckey', width: 90 }, { title: '额外', dataIndex: 'extra', width: 150 },
  ];
  const logCols: TableColumnsType<MailLogRow> = [
    { title: '导入时间', dataIndex: 'created_at', width: 170, render: (v: string) => fmtTime(v) },
    { title: '结果', dataIndex: 'result', width: 90, render: (v: string) => <Tag color={(RESULT_META[v] || { color: NEUTRAL.textTertiary }).color}>{(RESULT_META[v] || { label: v }).label}</Tag> },
    { title: '附件文件', dataIndex: 'filename', ellipsis: true }, { title: '行数', dataIndex: 'rows_total', width: 90 }, { title: '列数', dataIndex: 'columns_total', width: 90 }, { title: '说明', dataIndex: 'message', ellipsis: true },
  ];
  const stats = [
    { label: '总记录数', value: project?.row_count || 0, suffix: '行', color: PALETTE.primary },
    { label: '字段数', value: detail?.columns?.length || 0, suffix: '列', color: PALETTE.cyan },
    { label: '导入次数', value: logs.length, suffix: '次', color: PALETTE.green },
    { label: '最近导入', value: project?.last_import_at ? fmtAgo(project.last_import_at) : '-', color: PALETTE.violet },
  ];
  const tabItems = [
    { key: 'records', label: '数据明细', children: !can('data:read') ? <Alert type="warning" showIcon title="无权限读取数据，需要 data:read 权限" /> : (
      <DataTable<MailRow>
        title="数据明细"
        total={total}
        rows={rows}
        columns={(columns.length ? columns : detail?.columns || []).map((column) => ({
          name: column.name,
          label: column.comment || column.name,
          comment: column.comment || undefined,
          type: column.type,
        }))}
        loading={rowLoading}
        error={rowError}
        onRetry={() => setRowsReloadKey((value) => value + 1)}
        rowKey={(row) => String(row.id ?? JSON.stringify(row))}
        searchPlaceholder="搜索数据"
        keywordInput={keywordInput}
        onKeywordInputChange={setKeywordInput}
        onSearch={applySearch}
        onResetSearch={resetSearch}
        sort={sort}
        onSortChange={handleSortChange}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        page={page}
        pageSize={size}
        onPageChange={handlePageChange}
        extra={<Button size="small" icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button>}
        storageKey="mail-push.project.records"
      />
    ) },
    { key: 'info', label: '项目信息', children: <>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }} items={[
        { key: 'name', label: '项目名称', children: project?.name || '-' }, { key: 'code', label: '项目编码', children: project?.code || '-' }, { key: 'table', label: '数据表', children: project?.data_table || '-' }, { key: 'mail', label: '来源邮箱', children: project?.source_mail || '-' },
        { key: 'rows', label: '累计行数', children: fmtNum(project?.row_count || 0) }, { key: 'cols', label: '字段数', children: fmtNum(detail?.columns.length || 0) }, { key: 'last', label: '最近导入', children: project?.last_import_at ? fmtTime(project.last_import_at) : '-' }, { key: 'file', label: '最近文件', children: project?.last_file ? <Tooltip title={project.last_file}>{truncate(project.last_file, 48)}</Tooltip> : '-' }, { key: 'created', label: '创建时间', children: project?.created_at ? fmtTime(project.created_at) : '-' }, { key: 'updated', label: '更新时间', children: project?.updated_at ? fmtTime(project.updated_at) : '-' },
      ]} />
      <Space wrap style={{ margin: '16px 0' }}>{can('project:write') && <><Button icon={<EditOutlined />} onClick={rename}>改配置</Button><Button danger onClick={clear}>清空数据</Button><Button danger onClick={remove}>删除项目</Button></>}{can('data:read') && <Button icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button>}</Space>
      <Table<MailProjectColumn> rowKey="name" size="small" pagination={false} dataSource={detail?.columns || []} columns={projectCols} scroll={{ x: 750 }} locale={{ emptyText: <Empty description="暂无字段信息" /> }} />
    </> },
    { key: 'logs', label: '导入日志', children: can('log:read') ? <Table<MailLogRow> rowKey="id" size="small" loading={logLoading} dataSource={logs} columns={logCols} scroll={{ x: 800 }} pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} locale={{ emptyText: <Empty description="暂无导入记录" /> }} /> : <Alert type="warning" showIcon title="无权限查看导入日志，需要 log:read 权限" /> },
  ];
  return <Page back="/mail-push" backText="返回邮箱推送" title={project?.name || '数据项目详情'} stats={project ? stats : undefined}>
    {loading ? <div style={{ padding: 48, textAlign: 'center' }}><Spin tip="加载项目…" /></div> : error ? <Alert type="error" showIcon title="无法打开数据项目" description={error} action={<Button onClick={() => navigate('/mail-push')}>返回邮箱推送</Button>} /> : !project ? <Empty description="数据项目不存在或已删除" /> : <Tabs activeKey={tab} onChange={setTab} items={tabItems} />}
  </Page>;
}
