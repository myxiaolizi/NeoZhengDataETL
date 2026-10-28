'use strict';

/**
 * 数据源类型目录
 *
 * 分 15 大类，覆盖数据库、业务系统、办公软件、云服务等。
 * 每类包含若干具体类型，每个类型声明其连接方式（sql / api）与所需参数。
 */

/* ══════════════════════════════════════════════════════════
 *  类别定义
 * ══════════════════════════════════════════════════════════ */

const CATEGORIES = [
  { key: 'rdb', name: '关系型数据库', icon: '⛁', desc: '传统关系型数据库，支持标准 SQL 查询' },
  { key: 'dw', name: '数仓分析', icon: '◫', desc: '数据仓库与 OLAP 分析引擎' },
  { key: 'domestic', name: '国产数据库', icon: '⛃', desc: '国产信创数据库' },
  { key: 'light', name: '轻量数据库', icon: '▤', desc: '嵌入式与文件型数据库' },
  { key: 'doc', name: '文档/缓存/检索', icon: '◍', desc: 'NoSQL 文档、键值缓存与搜索引擎' },
  { key: 'graph', name: '图谱/向量', icon: '◇', desc: '图数据库与向量数据库' },
  { key: 'tsdb', name: '时序数据库', icon: '⌇', desc: '物联网与监控时序数据' },
  { key: 'mq', name: '消息队列', icon: '⇄', desc: '消息中间件与流处理' },
  { key: 'registry', name: '注册与配置', icon: '⚙', desc: '服务注册中心与配置中心' },
  { key: 'office', name: '办公软件', icon: '▦', desc: '协同办公平台：通讯录、多维表格、审批等' },
  { key: 'biz', name: '业务系统', icon: '🏢', desc: '行业业务系统与 ERP/CRM/WMS 等' },
  { key: 'tencent', name: '腾讯系', icon: '◉', desc: '微信公众号、小程序、微信支付、企业微信' },
  { key: 'ali', name: '阿里系', icon: '◈', desc: '支付宝、淘宝、钉钉、饿了么等' },
  { key: 'cloud', name: '云服务', icon: '☁', desc: '对象存储、云数据库与云 API' },
  { key: 'other', name: '其他', icon: '⋯', desc: '其他常见接口系统与自定义 HTTP 接口' },
];

/* ══════════════════════════════════════════════════════════
 *  类型定义
 *
 *  conn: 'sql' 走数据库驱动；'api' 走 HTTP 接口
 *  driver: 底层驱动（mysql/mssql/postgres/oracle/sqlite/mongo/redis/clickhouse）
 *  auth: 鉴权方式（none/bearer/basic/apikey/oauth2/appkey）
 * ══════════════════════════════════════════════════════════ */

const TYPES = [
  /* ────────── 关系型数据库 ────────── */
  {
    key: 'mysql', name: 'MySQL / MariaDB', category: 'rdb', conn: 'sql', driver: 'mysql',
    defaultPort: 3306, available: true,
    desc: '最流行的开源关系型数据库',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'mssql', name: 'SQL Server', category: 'rdb', conn: 'sql', driver: 'mssql',
    defaultPort: 1433, available: true,
    desc: '微软 SQL Server',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'postgres', name: 'PostgreSQL', category: 'rdb', conn: 'sql', driver: 'postgres',
    defaultPort: 5432, available: false, driverPkg: 'pg',
    desc: '功能强大的开源对象关系型数据库',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'oracle', name: 'Oracle', category: 'rdb', conn: 'sql', driver: 'oracle',
    defaultPort: 1521, available: false, driverPkg: 'oracledb',
    desc: '甲骨文企业级数据库',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'db2', name: 'IBM DB2', category: 'rdb', conn: 'sql', driver: 'db2',
    defaultPort: 50000, available: false, driverPkg: 'ibm_db',
    desc: 'IBM 企业级数据库',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },

  /* ────────── 数仓分析 ────────── */
  {
    key: 'clickhouse', name: 'ClickHouse', category: 'dw', conn: 'sql', driver: 'clickhouse',
    defaultPort: 8123, available: false, driverPkg: '@clickhouse/client',
    desc: '列式存储 OLAP 分析引擎，亿级数据秒级查询',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'doris', name: 'Apache Doris', category: 'dw', conn: 'sql', driver: 'mysql',
    defaultPort: 9030, available: true,
    desc: '百度开源的 MPP 分析型数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'starrocks', name: 'StarRocks', category: 'dw', conn: 'sql', driver: 'mysql',
    defaultPort: 9030, available: true,
    desc: '新一代极速全场景 MPP 数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'hive', name: 'Apache Hive', category: 'dw', conn: 'sql', driver: 'hive',
    defaultPort: 10000, available: false, driverPkg: 'hive-driver',
    desc: 'Hadoop 生态数据仓库',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'maxcompute', name: '阿里云 MaxCompute', category: 'dw', conn: 'api', driver: 'odps',
    defaultPort: 0, available: false, driverPkg: 'odps',
    desc: '阿里云大数据计算服务',
    fields: ['accessKeyId', 'accessKeySecret', 'project', 'endpoint'],
  },
  {
    key: 'snowflake', name: 'Snowflake', category: 'dw', conn: 'sql', driver: 'snowflake',
    defaultPort: 443, available: false, driverPkg: 'snowflake-sdk',
    desc: '云原生数据仓库',
    fields: ['account', 'user', 'password', 'database', 'warehouse'],
  },

  /* ────────── 国产数据库 ────────── */
  {
    key: 'dm', name: '达梦 DM', category: 'domestic', conn: 'sql', driver: 'oracle',
    defaultPort: 5236, available: false, driverPkg: 'oracledb',
    desc: '达梦数据库，兼容 Oracle 语法',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'kingbase', name: '人大金仓 KingBase', category: 'domestic', conn: 'sql', driver: 'postgres',
    defaultPort: 54321, available: false, driverPkg: 'pg',
    desc: '人大金仓，兼容 PostgreSQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'gbase', name: 'GBase 8a', category: 'domestic', conn: 'sql', driver: 'mysql',
    defaultPort: 5258, available: true,
    desc: '南大通用分析型数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'oceanbase', name: 'OceanBase', category: 'domestic', conn: 'sql', driver: 'mysql',
    defaultPort: 2881, available: true,
    desc: '蚂蚁集团分布式数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'tidb', name: 'TiDB', category: 'domestic', conn: 'sql', driver: 'mysql',
    defaultPort: 4000, available: true,
    desc: 'PingCAP 分布式 HTAP 数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'polardb', name: 'PolarDB', category: 'domestic', conn: 'sql', driver: 'mysql',
    defaultPort: 3306, available: true,
    desc: '阿里云云原生数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'opengauss', name: 'openGauss', category: 'domestic', conn: 'sql', driver: 'postgres',
    defaultPort: 5432, available: false, driverPkg: 'pg',
    desc: '华为开源数据库，兼容 PostgreSQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },

  /* ────────── 轻量数据库 ────────── */
  {
    key: 'sqlite', name: 'SQLite', category: 'light', conn: 'sql', driver: 'sqlite',
    defaultPort: 0, available: false, driverPkg: 'better-sqlite3',
    desc: '嵌入式文件数据库，无需服务进程',
    fields: ['database'],
  },
  {
    key: 'duckdb', name: 'DuckDB', category: 'light', conn: 'sql', driver: 'duckdb',
    defaultPort: 0, available: false, driverPkg: '@duckdb/node-api',
    desc: '嵌入式 OLAP 分析数据库',
    fields: ['database'],
  },
  {
    key: 'access', name: 'MS Access', category: 'light', conn: 'sql', driver: 'access',
    defaultPort: 0, available: false, driverPkg: 'node-adodb',
    desc: '微软 Access 文件数据库',
    fields: ['database'],
  },

  /* ────────── 文档/缓存/检索 ────────── */
  {
    key: 'mongodb', name: 'MongoDB', category: 'doc', conn: 'sql', driver: 'mongodb',
    defaultPort: 27017, available: false, driverPkg: 'mongodb',
    desc: '文档型 NoSQL 数据库',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'redis', name: 'Redis', category: 'doc', conn: 'sql', driver: 'redis',
    defaultPort: 6379, available: false, driverPkg: 'redis',
    desc: '高性能键值缓存',
    fields: ['host', 'port', 'password', 'database'],
  },
  {
    key: 'elasticsearch', name: 'Elasticsearch', category: 'doc', conn: 'api', driver: 'es',
    defaultPort: 9200, available: true,
    desc: '分布式搜索引擎，支持全文检索与聚合分析',
    fields: ['host', 'port', 'user', 'password', 'index'],
  },
  {
    key: 'opensearch', name: 'OpenSearch', category: 'doc', conn: 'api', driver: 'es',
    defaultPort: 9200, available: true,
    desc: 'AWS 开源搜索引擎，兼容 Elasticsearch API',
    fields: ['host', 'port', 'user', 'password', 'index'],
  },
  {
    key: 'meilisearch', name: 'Meilisearch', category: 'doc', conn: 'api', driver: 'http',
    defaultPort: 7700, available: true,
    desc: '轻量级开源搜索引擎',
    fields: ['host', 'port', 'apiKey'],
  },

  /* ────────── 图谱/向量 ────────── */
  {
    key: 'neo4j', name: 'Neo4j', category: 'graph', conn: 'api', driver: 'neo4j',
    defaultPort: 7474, available: false, driverPkg: 'neo4j-driver',
    desc: '主流图数据库，Cypher 查询语言',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'nebula', name: 'NebulaGraph', category: 'graph', conn: 'api', driver: 'nebula',
    defaultPort: 9669, available: false, driverPkg: '@nebula-contrib/nebula-nodejs',
    desc: '开源分布式图数据库',
    fields: ['host', 'port', 'user', 'password', 'space'],
  },
  {
    key: 'milvus', name: 'Milvus', category: 'graph', conn: 'api', driver: 'milvus',
    defaultPort: 19530, available: false, driverPkg: '@zilliz/milvus2-sdk-node',
    desc: '开源向量数据库，用于 AI 语义检索',
    fields: ['host', 'port', 'user', 'password', 'collection'],
  },
  {
    key: 'qdrant', name: 'Qdrant', category: 'graph', conn: 'api', driver: 'http',
    defaultPort: 6333, available: true,
    desc: '向量相似度搜索引擎',
    fields: ['host', 'port', 'apiKey'],
  },
  {
    key: 'pgvector', name: 'pgvector', category: 'graph', conn: 'sql', driver: 'postgres',
    defaultPort: 5432, available: false, driverPkg: 'pg',
    desc: 'PostgreSQL 向量扩展',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },

  /* ────────── 时序数据库 ────────── */
  {
    key: 'influxdb', name: 'InfluxDB', category: 'tsdb', conn: 'api', driver: 'http',
    defaultPort: 8086, available: true,
    desc: '主流时序数据库，适合监控与 IoT',
    fields: ['host', 'port', 'token', 'org', 'bucket'],
  },
  {
    key: 'tdengine', name: 'TDengine', category: 'tsdb', conn: 'sql', driver: 'mysql',
    defaultPort: 6030, available: true,
    desc: '涛思数据时序数据库，兼容 MySQL 协议',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'timescaledb', name: 'TimescaleDB', category: 'tsdb', conn: 'sql', driver: 'postgres',
    defaultPort: 5432, available: false, driverPkg: 'pg',
    desc: 'PostgreSQL 时序扩展',
    fields: ['host', 'port', 'user', 'password', 'database'],
  },
  {
    key: 'prometheus', name: 'Prometheus', category: 'tsdb', conn: 'api', driver: 'http',
    defaultPort: 9090, available: true,
    desc: '云原生监控系统',
    fields: ['host', 'port'],
  },
  {
    key: 'iotdb', name: 'Apache IoTDB', category: 'tsdb', conn: 'api', driver: 'http',
    defaultPort: 18080, available: true,
    desc: '物联网时序数据库',
    fields: ['host', 'port', 'user', 'password'],
  },

  /* ────────── 消息队列 ────────── */
  {
    key: 'kafka', name: 'Apache Kafka', category: 'mq', conn: 'api', driver: 'kafka',
    defaultPort: 9092, available: false, driverPkg: 'kafkajs',
    desc: '分布式消息流平台',
    fields: ['brokers', 'topic', 'groupId', 'saslUser', 'saslPassword'],
  },
  {
    key: 'rocketmq', name: 'RocketMQ', category: 'mq', conn: 'api', driver: 'rocketmq',
    defaultPort: 9876, available: false, driverPkg: 'rocketmq-client-nodejs',
    desc: '阿里开源消息中间件',
    fields: ['namesrv', 'topic', 'groupId', 'accessKey', 'secretKey'],
  },
  {
    key: 'rabbitmq', name: 'RabbitMQ', category: 'mq', conn: 'api', driver: 'http',
    defaultPort: 15672, available: true,
    desc: 'AMQP 消息队列，通过管理 API 读取',
    fields: ['host', 'port', 'user', 'password', 'queue'],
  },
  {
    key: 'pulsar', name: 'Apache Pulsar', category: 'mq', conn: 'api', driver: 'pulsar',
    defaultPort: 8080, available: false, driverPkg: 'pulsar-client',
    desc: '云原生分布式消息流平台',
    fields: ['serviceUrl', 'topic', 'token'],
  },
  {
    key: 'mqtt', name: 'MQTT Broker', category: 'mq', conn: 'api', driver: 'mqtt',
    defaultPort: 1883, available: false, driverPkg: 'mqtt',
    desc: '物联网消息协议',
    fields: ['host', 'port', 'user', 'password', 'topic'],
  },

  /* ────────── 注册与配置 ────────── */
  {
    key: 'nacos', name: 'Nacos', category: 'registry', conn: 'api', driver: 'http',
    defaultPort: 8848, available: true,
    desc: '阿里开源服务注册与配置中心',
    fields: ['host', 'port', 'namespace', 'username', 'password'],
  },
  {
    key: 'consul', name: 'Consul', category: 'registry', conn: 'api', driver: 'http',
    defaultPort: 8500, available: true,
    desc: 'HashiCorp 服务发现与配置',
    fields: ['host', 'port', 'token'],
  },
  {
    key: 'etcd', name: 'etcd', category: 'registry', conn: 'api', driver: 'http',
    defaultPort: 2379, available: true,
    desc: '分布式键值存储与配置中心',
    fields: ['host', 'port', 'user', 'password'],
  },
  {
    key: 'zookeeper', name: 'ZooKeeper', category: 'registry', conn: 'api', driver: 'http',
    defaultPort: 8080, available: true,
    desc: '分布式协调服务（通过 Exporter 读取）',
    fields: ['host', 'port'],
  },
  {
    key: 'apollo', name: 'Apollo 配置中心', category: 'registry', conn: 'api', driver: 'http',
    defaultPort: 8070, available: true,
    desc: '携程开源配置管理中心',
    fields: ['host', 'port', 'appId', 'token'],
  },

  /* ────────── 办公软件 ────────── */
  {
    key: 'dingtalk', name: '钉钉', category: 'office', conn: 'api', driver: 'dingtalk',
    defaultPort: 443, available: true,
    desc: '通讯录、审批、考勤、多维表格、群机器人',
    fields: ['appKey', 'appSecret', 'agentId'],
    resources: [
      { key: 'contacts', name: '通讯录（部门/成员）', api: '/topapi/v2/department/listsub' },
      { key: 'attendance', name: '考勤打卡记录', api: '/topapi/attendance/list' },
      { key: 'approval', name: '审批实例', api: '/topapi/processinstance/listids' },
      { key: 'workrecord', name: '日志（日报周报）', api: '/topapi/workrecord/list' },
      { key: 'notable', name: '多维表格（Notable）', api: '/topapi/notable/records/list' },
      { key: 'drive', name: '钉钉文档/表格', api: '/topapi/doc/export' },
    ],
  },
  {
    key: 'wecom', name: '企业微信', category: 'office', conn: 'api', driver: 'wecom',
    defaultPort: 443, available: true,
    desc: '通讯录、审批、打卡、客户联系、文档',
    fields: ['corpId', 'corpSecret', 'agentId'],
    resources: [
      { key: 'department', name: '部门列表', api: '/cgi-bin/department/list' },
      { key: 'user', name: '成员列表', api: '/cgi-bin/user/list' },
      { key: 'checkin', name: '打卡记录', api: '/cgi-bin/checkin/getcheckindata' },
      { key: 'approval', name: '审批单', api: '/cgi-bin/oa/getapprovalinfo' },
      { key: 'external', name: '外部联系人', api: '/cgi-bin/externalcontact/list' },
      { key: 'wedoc', name: '微文档/表格', api: '/cgi-bin/wedoc/get_doc_auth' },
    ],
  },
  {
    key: 'feishu', name: '飞书', category: 'office', conn: 'api', driver: 'feishu',
    defaultPort: 443, available: true,
    desc: '通讯录、审批、考勤、多维表格、电子表格、文档',
    fields: ['appId', 'appSecret'],
    resources: [
      { key: 'contact', name: '通讯录（部门/用户）', api: '/open-apis/contact/v3/users' },
      { key: 'bitable', name: '多维表格（Bitable）', api: '/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records' },
      { key: 'sheet', name: '电子表格（Sheet）', api: '/open-apis/sheets/v2/spreadsheets/:token/values' },
      { key: 'docx', name: '文档（Docx）', api: '/open-apis/docx/v1/documents/:id/raw_content' },
      { key: 'approval', name: '审批实例', api: '/open-apis/approval/v4/instances' },
      { key: 'attendance', name: '考勤记录', api: '/open-apis/attendance/v1/user_tasks/query' },
      { key: 'calendar', name: '日历日程', api: '/open-apis/calendar/v4/calendars' },
    ],
  },
  {
    key: 'wps', name: 'WPS 金山文档', category: 'office', conn: 'api', driver: 'wps',
    defaultPort: 443, available: true,
    desc: 'WPS 表格、文档、轻维表',
    fields: ['appId', 'appSecret'],
    resources: [
      { key: 'sheet', name: 'WPS 表格', api: '/openapi/v1/files/:file_id/sheets' },
      { key: 'doc', name: 'WPS 文档', api: '/openapi/v1/files/:file_id/content' },
      { key: 'dbt', name: '轻维表（DBT）', api: '/openapi/v1/dbt/sheets/:file_id/records' },
    ],
  },
  {
    key: 'lark_bitable', name: '飞书多维表格（独立）', category: 'office', conn: 'api', driver: 'feishu',
    defaultPort: 443, available: true,
    desc: '仅接入飞书多维表格数据',
    fields: ['appId', 'appSecret', 'appToken', 'tableId'],
  },
  {
    key: 'dingtalk_notable', name: '钉钉多维表格（独立）', category: 'office', conn: 'api', driver: 'dingtalk',
    defaultPort: 443, available: true,
    desc: '仅接入钉钉多维表格数据',
    fields: ['appKey', 'appSecret', 'baseId', 'sheetId'],
  },

  /* ────────── 业务系统 ────────── */
  {
    key: 'haidian', name: '海典 ERP', category: 'biz', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '海典医药零售 ERP，支持商品、库存、销售、会员数据',
    fields: ['baseUrl', 'appKey', 'appSecret', 'orgCode'],
    resources: [
      { key: 'goods', name: '商品档案', api: '/api/goods/list' },
      { key: 'stock', name: '库存数据', api: '/api/stock/list' },
      { key: 'sale', name: '销售流水', api: '/api/sale/list' },
      { key: 'member', name: '会员档案', api: '/api/member/list' },
      { key: 'store', name: '门店档案', api: '/api/store/list' },
    ],
  },
  {
    key: 'yunuo', name: '雨诺 ERP', category: 'biz', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '雨诺医药零售管理系统',
    fields: ['baseUrl', 'appKey', 'appSecret'],
    resources: [
      { key: 'goods', name: '商品资料', api: '/openapi/goods' },
      { key: 'stock', name: '库存查询', api: '/openapi/stock' },
      { key: 'sale', name: '销售单据', api: '/openapi/sale' },
      { key: 'member', name: '会员信息', api: '/openapi/member' },
    ],
  },
  {
    key: 'qianfang', name: '千方百计', category: 'biz', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '千方百计医药零售 ERP',
    fields: ['baseUrl', 'appKey', 'appSecret', 'tenantId'],
    resources: [
      { key: 'goods', name: '商品主数据', api: '/api/v1/goods' },
      { key: 'stock', name: '库存数据', api: '/api/v1/stock' },
      { key: 'order', name: '订单数据', api: '/api/v1/order' },
    ],
  },
  {
    key: 'yonyou', name: '用友 U8 / YonSuite', category: 'biz', conn: 'api', driver: 'yonyou',
    defaultPort: 443, available: true,
    desc: '用友 ERP，支持 U8、U9、YonSuite',
    fields: ['baseUrl', 'appKey', 'appSecret', 'accountId'],
    resources: [
      { key: 'customer', name: '客户档案', api: '/api/customer/list' },
      { key: 'supplier', name: '供应商档案', api: '/api/supplier/list' },
      { key: 'inventory', name: '存货档案', api: '/api/inventory/list' },
      { key: 'voucher', name: '凭证数据', api: '/api/voucher/list' },
      { key: 'stock', name: '现存量', api: '/api/stock/current' },
    ],
  },
  {
    key: 'kingdee', name: '金蝶 K3 / 云星空', category: 'biz', conn: 'api', driver: 'kingdee',
    defaultPort: 443, available: true,
    desc: '金蝶 ERP 系统',
    fields: ['baseUrl', 'appId', 'appSecret', 'accountId'],
    resources: [
      { key: 'material', name: '物料档案', api: '/k3cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery' },
      { key: 'stock', name: '即时库存', api: '/k3cloud/executeBillQuery/STK_Inventory' },
      { key: 'sale', name: '销售订单', api: '/k3cloud/executeBillQuery/SAL_SaleOrder' },
    ],
  },
  {
    key: 'sap', name: 'SAP', category: 'biz', conn: 'api', driver: 'sap',
    defaultPort: 443, available: false, driverPkg: 'node-rfc',
    desc: 'SAP ERP（RFC / OData）',
    fields: ['ashost', 'sysnr', 'client', 'user', 'password'],
  },
  {
    key: 'hishop', name: '海鼎 POS', category: 'biz', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '海鼎零售 POS 系统',
    fields: ['baseUrl', 'appKey', 'appSecret'],
  },
  {
    key: 'fuwuqi', name: '富基 POS', category: 'biz', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '富基零售 POS 系统',
    fields: ['baseUrl', 'appKey', 'appSecret'],
  },
  {
    key: 'custom_api', name: '自定义 HTTP 接口', category: 'biz', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '任意 RESTful / GraphQL 接口',
    fields: ['baseUrl', 'authType', 'token', 'headers'],
  },

  /* ────────── 腾讯系 ────────── */
  {
    key: 'wechat_mp', name: '微信公众号', category: 'tencent', conn: 'api', driver: 'wechat',
    defaultPort: 443, available: true,
    desc: '公众号用户、素材、消息、数据统计',
    fields: ['appId', 'appSecret'],
    resources: [
      { key: 'user', name: '用户列表', api: '/cgi-bin/user/get' },
      { key: 'usertag', name: '用户标签', api: '/cgi-bin/tags/get' },
      { key: 'material', name: '素材列表', api: '/cgi-bin/material/batchget_material' },
      { key: 'datacube', name: '数据统计', api: '/datacube/getusersummary' },
    ],
  },
  {
    key: 'wechat_mini', name: '微信小程序', category: 'tencent', conn: 'api', driver: 'wechat',
    defaultPort: 443, available: true,
    desc: '小程序用户、访问分析、订阅消息',
    fields: ['appId', 'appSecret'],
    resources: [
      { key: 'analysis', name: '访问分析', api: '/datacube/getweanalysisappiddailysummarytrend' },
      { key: 'user', name: '用户画像', api: '/datacube/getweanalysisappiduserportrait' },
    ],
  },
  {
    key: 'wechat_pay', name: '微信支付', category: 'tencent', conn: 'api', driver: 'wechatpay',
    defaultPort: 443, available: true,
    desc: '支付订单、退款、账单下载',
    fields: ['mchId', 'apiKey', 'apiV3Key', 'certPath'],
    resources: [
      { key: 'order', name: '支付订单', api: '/v3/pay/transactions/out-trade-no/:out_trade_no' },
      { key: 'bill', name: '交易账单', api: '/v3/bill/tradebill' },
      { key: 'refund', name: '退款记录', api: '/v3/refund/domestic/refunds' },
    ],
  },
  {
    key: 'qq', name: 'QQ 互联', category: 'tencent', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: 'QQ 登录与用户信息',
    fields: ['appId', 'appKey'],
  },
  {
    key: 'tencent_cloud', name: '腾讯云 API', category: 'tencent', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '腾讯云各项服务（CVM/COS/CDB 等）',
    fields: ['secretId', 'secretKey', 'region'],
  },

  /* ────────── 阿里系 ────────── */
  {
    key: 'alipay', name: '支付宝', category: 'ali', conn: 'api', driver: 'alipay',
    defaultPort: 443, available: true,
    desc: '支付宝交易、账单、对账',
    fields: ['appId', 'privateKey', 'alipayPublicKey'],
    resources: [
      { key: 'trade', name: '交易查询', api: '/gateway.do?method=alipay.trade.query' },
      { key: 'bill', name: '对账单下载', api: '/gateway.do?method=alipay.data.dataservice.bill.downloadurl.query' },
    ],
  },
  {
    key: 'taobao', name: '淘宝/天猫开放平台', category: 'ali', conn: 'api', driver: 'taobao',
    defaultPort: 443, available: true,
    desc: '商品、订单、库存、物流',
    fields: ['appKey', 'appSecret', 'sessionKey'],
    resources: [
      { key: 'item', name: '商品列表', api: '/router/rest?method=taobao.items.onsale.get' },
      { key: 'trade', name: '订单列表', api: '/router/rest?method=taobao.trades.sold.get' },
      { key: 'stock', name: '库存同步', api: '/router/rest?method=taobao.item.quantity.update' },
    ],
  },
  {
    key: 'eleme', name: '饿了么', category: 'ali', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '外卖订单、商品、门店',
    fields: ['appId', 'appSecret', 'shopId'],
  },
  {
    key: 'aliyun', name: '阿里云 API', category: 'ali', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '阿里云各项服务（ECS/OSS/RDS 等）',
    fields: ['accessKeyId', 'accessKeySecret', 'region'],
  },
  {
    key: 'dingtalk_robot', name: '钉钉群机器人', category: 'ali', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '通过 Webhook 推送消息到钉钉群',
    fields: ['webhook', 'secret'],
  },

  /* ────────── 云服务 ────────── */
  {
    key: 'oss', name: '阿里云 OSS', category: 'cloud', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '对象存储文件列表与下载',
    fields: ['endpoint', 'accessKeyId', 'accessKeySecret', 'bucket'],
  },
  {
    key: 'cos', name: '腾讯云 COS', category: 'cloud', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '对象存储文件列表与下载',
    fields: ['region', 'secretId', 'secretKey', 'bucket'],
  },
  {
    key: 's3', name: 'S3 兼容存储', category: 'cloud', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: 'MinIO / AWS S3 / 七牛等',
    fields: ['endpoint', 'accessKey', 'secretKey', 'bucket'],
  },
  {
    key: 'salesforce', name: 'Salesforce', category: 'cloud', conn: 'api', driver: 'salesforce',
    defaultPort: 443, available: true,
    desc: 'CRM SaaS 平台',
    fields: ['instanceUrl', 'clientId', 'clientSecret', 'username', 'password'],
  },
  {
    key: 'hubspot', name: 'HubSpot', category: 'cloud', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '营销与 CRM SaaS',
    fields: ['apiKey'],
  },

  /* ────────── 其他 ────────── */
  {
    key: 'http', name: '通用 HTTP 接口', category: 'other', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '任意 HTTP/HTTPS 接口，支持 GET/POST 与多种鉴权',
    fields: ['baseUrl', 'authType', 'token', 'headers'],
  },
  {
    key: 'graphql', name: 'GraphQL 接口', category: 'other', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: 'GraphQL 查询接口',
    fields: ['endpoint', 'token', 'query'],
  },
  {
    key: 'soap', name: 'SOAP / WebService', category: 'other', conn: 'api', driver: 'http',
    defaultPort: 443, available: true,
    desc: '传统 WebService 接口',
    fields: ['wsdl', 'user', 'password'],
  },
  {
    key: 'ftp', name: 'FTP / SFTP', category: 'other', conn: 'api', driver: 'ftp',
    defaultPort: 21, available: false, driverPkg: 'basic-ftp',
    desc: '文件服务器，定时拉取 CSV/Excel',
    fields: ['host', 'port', 'user', 'password', 'path'],
  },
  {
    key: 'webhook', name: 'Webhook 接收', category: 'other', conn: 'api', driver: 'webhook',
    defaultPort: 443, available: true,
    desc: '由对方主动推送到本平台生成的接收地址',
    fields: [],
  },
];

const TYPE_MAP = {};
TYPES.forEach((t) => { TYPE_MAP[t.key] = t; });

/* ══════════════════════════════════════════════════════════
 *  驱动可用性检测（运行时探测，覆盖静态声明）
 * ══════════════════════════════════════════════════════════ */

/** 驱动包 → 是否已安装（带缓存） */
const DRIVER_CACHE = {};

function hasModule(name) {
  if (DRIVER_CACHE[name] !== undefined) return DRIVER_CACHE[name];
  try {
    require.resolve(name);
    DRIVER_CACHE[name] = true;
  } catch (_) {
    DRIVER_CACHE[name] = false;
  }
  return DRIVER_CACHE[name];
}

/** 底层 driver → npm 包名 */
const DRIVER_PKG = {
  mysql: 'mysql2',
  mssql: 'mssql',
  postgres: 'pg',
  oracle: 'oracledb',
  sqlite: 'better-sqlite3',
  mongodb: 'mongodb',
  redis: 'redis',
  clickhouse: '@clickhouse/client',
  db2: 'ibm_db',
  hive: 'hive-driver',
  snowflake: 'snowflake-sdk',
  odps: 'odps',
  duckdb: '@duckdb/node-api',
  access: 'node-adodb',
  kafka: 'kafkajs',
  rocketmq: 'rocketmq-client-nodejs',
  pulsar: 'pulsar-client',
  mqtt: 'mqtt',
  neo4j: 'neo4j-driver',
  nebula: '@nebula-contrib/nebula-nodejs',
  milvus: '@zilliz/milvus2-sdk-node',
  ftp: 'basic-ftp',
  sap: 'node-rfc',
  /* 以下为纯 HTTP 实现，无需驱动 */
  es: null, http: null, dingtalk: null, wecom: null, feishu: null, wps: null,
  wechat: null, wechatpay: null, alipay: null, taobao: null, yonyou: null,
  kingdee: null, salesforce: null, webhook: null,
};

/** 类型是否实际可用 */
function isAvailable(type) {
  const t = typeof type === 'string' ? TYPE_MAP[type] : type;
  if (!t) return false;

  // 显式声明了驱动包：检测安装情况
  if (t.driverPkg) return hasModule(t.driverPkg);

  // API 类：Node 18+ 内置 fetch，直接可用
  if (t.conn === 'api') return true;

  // SQL 类：按底层 driver 判断
  const pkg = DRIVER_PKG[t.driver];
  if (pkg === null || pkg === undefined) return true;
  return hasModule(pkg);
}

/** 驱动安装状态汇总 */
function driverStatus() {
  const seen = new Set();
  const list = [];

  TYPES.forEach((t) => {
    const pkg = t.driverPkg || DRIVER_PKG[t.driver];
    if (!pkg || seen.has(pkg)) return;
    seen.add(pkg);
    list.push({
      pkg,
      installed: hasModule(pkg),
      types: TYPES.filter((x) => (x.driverPkg || DRIVER_PKG[x.driver]) === pkg).map((x) => x.name),
    });
  });

  return list.sort((a, b) => (a.installed === b.installed ? 0 : a.installed ? -1 : 1));
}

/* ══════════════════════════════════════════════════════════
 *  查询函数
 * ══════════════════════════════════════════════════════════ */

/** 按类别分组（available 为运行时探测结果） */
function grouped() {
  return CATEGORIES.map((c) => ({
    key: c.key,
    name: c.name,
    icon: c.icon,
    desc: c.desc,
    types: TYPES.filter((t) => t.category === c.key).map((t) => ({
      key: t.key,
      name: t.name,
      desc: t.desc,
      conn: t.conn,
      defaultPort: t.defaultPort,
      available: isAvailable(t),
      driverPkg: t.driverPkg || DRIVER_PKG[t.driver] || null,
      resourceCount: (t.resources || []).length,
    })),
  })).filter((c) => c.types.length > 0);
}

/** 按 key 查找 */
function get(key) {
  const t = TYPE_MAP[key];
  if (!t) return null;
  return Object.assign({}, t, {
    available: isAvailable(t),
    driverPkg: t.driverPkg || DRIVER_PKG[t.driver] || null,
  });
}

/** 统计 */
function stats() {
  const avail = TYPES.filter((t) => isAvailable(t)).length;
  return {
    categories: CATEGORIES.length,
    types: TYPES.length,
    available: avail,
    unavailable: TYPES.length - avail,
    sqlTypes: TYPES.filter((t) => t.conn === 'sql').length,
    apiTypes: TYPES.filter((t) => t.conn === 'api').length,
  };
}

module.exports = {
  CATEGORIES, TYPES, TYPE_MAP, DRIVER_PKG,
  grouped, get, stats, isAvailable, driverStatus, hasModule,
};
