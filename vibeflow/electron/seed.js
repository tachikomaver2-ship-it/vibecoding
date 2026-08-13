const STAGES = require('../shared/stages.json');

const DAY = 86400000;
const HOUR = 3600000;

function buildSeed() {
  const t = Date.now();
  const channels = [
    { id: 'c_inspire', name: '#灵感池', description: '各平台连接器沉淀的产品灵感', type: 'source' },
    { id: 'c_compete', name: '#竞品观察', description: '从社交媒体 / 文章抓取的可借鉴点', type: 'source' },
    { id: 'c_team', name: '#团队', description: '内部讨论与评审', type: 'team' },
  ];

  const connectors = [
    { id: 'conn_manual', name: '手动剪贴板', type: 'manual', enabled: true, config: {} },
    { id: 'conn_file', name: '文件导入', type: 'file', enabled: true, config: {} },
    {
      id: 'conn_webhook',
      name: 'Webhook 接收',
      type: 'webhook',
      enabled: true,
      config: { port: 18720, path: '/webhook' },
    },
    { id: 'conn_github', name: 'GitHub Issues', type: 'github', enabled: false, config: { repo: '' } },
    { id: 'conn_slack', name: 'Slack 频道', type: 'slack', enabled: false, config: { webhookUrl: '' } },
  ];

  const inbox = [
    {
      id: 'in_1',
      channelId: 'c_inspire',
      title: '用语音记录灵感，自动转成需求卡片',
      content:
        '用户在通勤时用语音说出产品想法，工具通过 STT 自动转写并归类到「想法」阶段。来源：播客片段。',
      source: 'podcast',
      author: 'you',
      createdAt: t - 2 * HOUR,
      status: 'pending',
      linkedGoalId: null,
      reviewedAt: null,
    },
    {
      id: 'in_2',
      channelId: 'c_compete',
      title: 'Linear 的快捷键体验值得借鉴',
      content: '竞品 Linear 的命令面板 + 键盘流非常顺滑，可作为开发阶段交互参考。',
      source: 'article',
      author: 'you',
      createdAt: t - 5 * HOUR,
      status: 'pending',
      linkedGoalId: null,
      reviewedAt: null,
    },
  ];

  const goals = [
    {
      id: 'g_idea1',
      title: 'AI 读书笔记助手',
      description: '把读到的文章 / 书摘通过连接器沉淀为想法，自动生成读书卡片与关联图谱。',
      stage: 'idea',
      createdAt: t - 1 * DAY,
      updatedAt: t - 3 * HOUR,
      progress: 8,
      tasks: [],
      history: [
        { id: 'h1', ts: t - 3 * HOUR, type: 'create', message: '由知识库灵感经审核进入想法阶段', author: '你' },
      ],
      sourceIds: ['in_1'],
      reviewedBy: null,
      reviewNote: '',
      reviewedAt: null,
    },
    {
      id: 'g_req1',
      title: '团队协作看板',
      description: '支持多人实时协作的目标看板，每个目标带阶段与进度条。',
      stage: 'requirement',
      createdAt: t - 4 * DAY,
      updatedAt: t - 6 * HOUR,
      progress: 28,
      tasks: [
        { id: 't1', text: '定义目标卡片字段（标题/阶段/进度）', done: true, createdAt: t - 4 * DAY },
        { id: 't2', text: '设计阶段流转规则', done: true, createdAt: t - 3 * DAY },
        { id: 't3', text: '编写需求文档', done: false, createdAt: t - 1 * DAY },
      ],
      history: [
        { id: 'h2', ts: t - 6 * HOUR, type: 'stage', message: '阶段推进：想法 → 需求（审核人：你）', author: '你' },
        { id: 'h3', ts: t - 1 * DAY, type: 'task', message: '新增任务：编写需求文档', author: '你' },
      ],
      sourceIds: [],
      reviewedBy: '你',
      reviewNote: '需求清晰，可进入开发',
      reviewedAt: t - 6 * HOUR,
    },
    {
      id: 'g_dev1',
      title: '命令行待办工具',
      description: '一个零依赖的 CLI 待办，支持自然语言添加与完成。',
      stage: 'dev',
      createdAt: t - 9 * DAY,
      updatedAt: t - 2 * HOUR,
      progress: 64,
      tasks: [
        { id: 't4', text: '搭建 CLI 框架', done: true, createdAt: t - 9 * DAY },
        { id: 't5', text: '实现自然语言解析', done: true, createdAt: t - 8 * DAY },
        { id: 't6', text: '本地持久化存储', done: true, createdAt: t - 7 * DAY },
        { id: 't7', text: '编写单元测试', done: false, createdAt: t - 2 * DAY },
      ],
      history: [
        { id: 'h4', ts: t - 2 * HOUR, type: 'codex', message: 'Codex 生成了 1 项任务：编写单元测试', author: 'Codex' },
        { id: 'h5', ts: t - 7 * DAY, type: 'stage', message: '阶段推进：需求 → 开发', author: '你' },
      ],
      sourceIds: [],
      reviewedBy: '你',
      reviewNote: '',
      reviewedAt: t - 7 * DAY,
    },
    {
      id: 'g_test1',
      title: '图片压缩服务',
      description: '上传图片返回多种压缩比，提供 API 与网页端。',
      stage: 'test',
      createdAt: t - 14 * DAY,
      updatedAt: t - 10 * HOUR,
      progress: 82,
      tasks: [
        { id: 't8', text: '实现压缩核心', done: true, createdAt: t - 14 * DAY },
        { id: 't9', text: '编写 API', done: true, createdAt: t - 12 * DAY },
        { id: 't10', text: '回归测试', done: true, createdAt: t - 11 * DAY },
        { id: 't11', text: '压测与边界用例', done: false, createdAt: t - 10 * HOUR },
      ],
      history: [
        { id: 'h6', ts: t - 10 * HOUR, type: 'stage', message: '阶段推进：开发 → 测试', author: '你' },
      ],
      sourceIds: [],
      reviewedBy: '你',
      reviewNote: '',
      reviewedAt: t - 11 * DAY,
    },
    {
      id: 'g_dep1',
      title: '个人主页生成器',
      description: '根据 GitHub 数据一键生成个人主页。',
      stage: 'deploy',
      createdAt: t - 30 * DAY,
      updatedAt: t - 3 * DAY,
      progress: 100,
      tasks: [
        { id: 't12', text: '抓取 GitHub 数据', done: true, createdAt: t - 30 * DAY },
        { id: 't13', text: '模板渲染', done: true, createdAt: t - 28 * DAY },
        { id: 't14', text: '部署到静态托管', done: true, createdAt: t - 25 * DAY },
      ],
      history: [
        { id: 'h7', ts: t - 3 * DAY, type: 'stage', message: '阶段推进：测试 → 部署上线', author: '你' },
        { id: 'h8', ts: t - 25 * DAY, type: 'create', message: '创建目标，初始阶段「想法」', author: '你' },
      ],
      sourceIds: [],
      reviewedBy: '你',
      reviewNote: '',
      reviewedAt: t - 28 * DAY,
    },
  ];

  return {
    version: 1,
    settings: { codexApiKey: '', codexModel: 'gpt-4o-mini', webhookPort: 18720, webhookEnabled: true },
    channels,
    connectors,
    inbox,
    goals,
  };
}

module.exports = { buildSeed };
