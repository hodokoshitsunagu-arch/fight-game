const target = (lat, lng, heading, transition = 'coordinate') => ({
  position: { lat, lng },
  radiusMetres: 55,
  heading,
  headingTolerance: 30,
  pitch: 0,
  pitchTolerance: 18,
  roadRelationship: 'observe-from-public-right-of-way',
  transition,
  routeStatus: 'needs-live-check',
});

const fallback = (id, actionId) => ({
  id,
  mode: 'retry-then-continue',
  maxAttempts: 3,
  actionId,
  unblocks: true,
});

const sources = [
  ['bowling-green', 'NYC Parks', 'Bowling Green history', 'https://nycgovparks.org/about/history/bowling-boules-bocce'],
  ['castle-clinton', 'National Park Service', 'Castle Clinton history', 'https://www.nps.gov/cacl/learn/historyculture/index.htm'],
  ['federal-hall', 'National Park Service', 'Congress at Federal Hall', 'https://www.nps.gov/feha/learn/historyculture/the-congress-at-federal-hall.htm'],
  ['bryant-park', 'Bryant Park', 'Bryant Park history', 'https://bryantpark.org/blog/history'],
  ['grand-central', 'Grand Central Terminal', 'What to see at Grand Central', 'https://grandcentralterminal.com/what-to-see/'],
  ['times-square', 'Times Square Alliance', 'New Year history at Times Square', 'https://www.timessquarenyc.org/nye/nye-history-times-square-ball'],
].map(([id, institution, title, url]) => ({
  id, institution, title, url, verified: '2026-09-07',
}));

const cases = [
  {
    id: 'manhattan-time',
    title: '曼哈顿时间档案案',
    routeSummary: '公共钟表、交通、广告与表演时间如何保留不同用途。',
    truth: '异常强行合并了服务不同公共目的的时间系统，抹掉先后与因果。',
    endingId: 'manhattan-time-restored',
  },
  {
    id: 'brooklyn-shoreline',
    title: '布鲁克林岸线档案案',
    routeSummary: '港口、工业、污染、社区行动与公共投资如何共同改写岸线。',
    truth: '异常伪造了工业自然进化成公园的单线故事。',
    endingId: 'brooklyn-shoreline-restored',
  },
  {
    id: 'queens-future',
    title: '皇后未来档案案',
    routeSummary: '世博建筑、交通、公共空间、家庭档案与迁移网络如何共同表达未来。',
    truth: '异常把企业展馆和纪念建筑写成了唯一未来。',
    endingId: 'queens-future-restored',
  },
];

const evidence = [
  ['time-dossier-clue', '公共时间用途线索', 'bowling-green'],
  ['shoreline-dossier-clue', '岸线用途叠层线索', 'bowling-green'],
  ['future-dossier-clue', '公共未来网络线索', 'bowling-green'],
  ['protected-archive-layer', '受保护的地点用途层', 'castle-clinton'],
  ['manhattan-time-combined-evidence', '曼哈顿时序组合', 'bryant-park'],
  ['brooklyn-shoreline-combined-evidence', '布鲁克林岸线组合', 'bryant-park'],
  ['queens-future-combined-evidence', '皇后未来组合', 'bryant-park'],
  ['manhattan-time-causal-sequence', '曼哈顿因果时序', 'grand-central'],
  ['brooklyn-shoreline-causal-sequence', '布鲁克林岸线因果', 'grand-central'],
  ['queens-future-causal-sequence', '皇后未来因果', 'grand-central'],
  ['manhattan-time-conclusion', '曼哈顿案件结论', 'times-square'],
  ['brooklyn-shoreline-conclusion', '布鲁克林案件结论', 'times-square'],
  ['queens-future-conclusion', '皇后案件结论', 'times-square'],
].map(([id, label, sourceId]) => ({ id, label, sourceRefs: [sourceId] }));

const caseActions = (verb, suffix) => cases.map((item) => ({
  id: `${verb}-${item.id}`,
  label: `${verb === 'combine' ? '组合' : verb === 'rebuild' ? '重建' : '确认'} · ${item.title}`,
  caseId: item.id,
  grantsEvidence: [`${item.id}-${suffix}`],
}));

const nodes = [
  {
    id: 'S1',
    segment: 'shared-opening',
    title: 'S1 · 边界缺口',
    fact: 'NYC Parks 将 Bowling Green 记为 1733 年建立的纽约首座公共公园，并记录了它早期的多种用途。',
    fantasy: '失序档案正把地点边界从城市记录中擦除。',
    sourceRefs: ['bowling-green'],
    culturalStatus: 'needs-review',
    safeNode: true,
    streetViewTarget: target(40.70408, -74.01317, 18),
    interaction: {
      type: 'observation',
      prompt: '每位参与者从共享街景提交一条最值得追查的档案层。',
      actions: [
        { id: 'inspect-time-layer', label: '观察公共时间边界', grantsEvidence: ['time-dossier-clue'] },
        { id: 'inspect-shoreline-layer', label: '观察岸线用途边界', grantsEvidence: ['shoreline-dossier-clue'] },
        { id: 'inspect-future-layer', label: '观察公共未来边界', grantsEvidence: ['future-dossier-clue'] },
      ],
    },
    fallback: fallback('S1-authored-observation', 'inspect-time-layer'),
  },
  {
    id: 'S2',
    segment: 'shared-opening',
    title: 'S2 · 保护用途叠层',
    fact: 'Castle Clinton 的机构历史记录了同一地点经历的多种公共用途。',
    fantasy: '两个抽象噪声体试图把这些用途压成单一标签。',
    sourceRefs: ['castle-clinton'],
    culturalStatus: 'needs-review',
    streetViewTarget: target(40.70345, -74.0168, 215, 'walk'),
    interaction: {
      type: 'combat',
      enemyCount: 2,
      opponentKind: 'abstract-anomaly',
      evidenceOutcome: 'protect',
      prompt: '四类职责共同保护用途叠层；战斗结果只通过案件证据推进。',
      actions: [
        { id: 'stabilize-anomaly', label: '稳定异常边缘', role: 'attack' },
        { id: 'shield-archive', label: '防护档案层', role: 'defense' },
        { id: 'decode-overwrite', label: '解码覆写', role: 'evidence' },
        { id: 'sustain-team', label: '维持团队同步', role: 'support' },
      ],
      grantsEvidence: ['protected-archive-layer'],
    },
    fallback: fallback('S2-combat-inaccessible', 'stabilize-anomaly'),
  },
  {
    id: 'S3',
    segment: 'shared-opening',
    title: 'S3 · 案件档案表决',
    fact: 'National Park Service 记录，改建后的 Federal Hall 曾容纳参议院、众议院和总统办公室。',
    fantasy: '三份案件档案同时亮起；小组必须公开决定本局追查路线。',
    sourceRefs: ['federal-hall'],
    culturalStatus: 'needs-review',
    safeNode: true,
    streetViewTarget: target(40.70735, -74.01018, 300, 'walk'),
    interaction: {
      type: 'vote',
      prompt: '查看三案主题与预计路线后公开投票。票数实时可见。',
      actions: cases.map((item) => ({
        id: `choose-${item.id.split('-')[0]}`,
        label: `${item.title}｜${item.routeSummary}`,
        selectsCaseId: item.id,
        tieBreakEvidenceId: item.id === 'manhattan-time' ? 'time-dossier-clue'
          : item.id === 'brooklyn-shoreline' ? 'shoreline-dossier-clue'
            : 'future-dossier-clue',
      })),
    },
    fallback: fallback('S3-navigator-case-decision', 'choose-manhattan'),
  },
  {
    id: 'S4',
    segment: 'final-reasoning',
    title: 'S4 · 汇合案件证据',
    fact: 'Bryant Park 的机构历史记录了这片土地从水库广场、展览场地到公共公园的用途变化。',
    fantasy: '小组把本案证据放回城市档案的不同层次。',
    sourceRefs: ['bryant-park'],
    culturalStatus: 'needs-review',
    safeNode: true,
    streetViewTarget: target(40.7536, -73.9832, 90, 'narrative'),
    interaction: {
      type: 'puzzle',
      prompt: '组合所选案件的地点证据；失败三次会给出完整档案关系并继续。',
      actions: caseActions('combine', 'combined-evidence'),
    },
    fallback: fallback('S4-reveal-evidence-relation', 'combine-manhattan-time'),
  },
  {
    id: 'S5',
    segment: 'final-reasoning',
    title: 'S5 · 重建因果',
    fact: 'Grand Central 将信息亭时钟称为会合地标，并说明站内时钟与标准时间校准。',
    fantasy: '失序档案把并存关系伪装成唯一的进步顺序。',
    sourceRefs: ['grand-central'],
    culturalStatus: 'needs-review',
    safeNode: true,
    streetViewTarget: target(40.75265, -73.97725, 45, 'walk'),
    interaction: {
      type: 'puzzle',
      prompt: '重建所选案件中不能被压平的因果与并存关系。',
      actions: caseActions('rebuild', 'causal-sequence'),
    },
    fallback: fallback('S5-reveal-causal-sequence', 'rebuild-manhattan-time'),
  },
  {
    id: 'S6',
    segment: 'final-reasoning',
    title: 'S6 · 公开案件结论',
    fact: 'Times Square Alliance 记录了 1904 年首次跨年庆典与 1907 年首次落球仪式。',
    fantasy: '本案结论揭示失序档案如何伪造城市总谜团的一部分。',
    sourceRefs: ['times-square'],
    culturalStatus: 'needs-review',
    safeNode: true,
    streetViewTarget: target(40.7567, -73.9863, 20, 'walk'),
    interaction: {
      type: 'conclusion',
      prompt: '共同确认所选案件的客观谜底，并保留它与城市总异常的联系。',
      actions: caseActions('conclude', 'conclusion'),
    },
    fallback: fallback('S6-confirm-authored-conclusion', 'conclude-manhattan-time'),
  },
];

const streetViewInputs = {
  S1: 'range',
  S2: 'range',
  S3: 'heading',
  S4: 'range',
  S5: 'heading',
  S6: 'heading',
};
for (const node of nodes) {
  node.interaction.actions = node.interaction.actions.map((action) => ({
    ...action,
    streetViewInput: streetViewInputs[node.id],
  }));
}

const edges = [
  { from: 'S1', to: 'S2' },
  { from: 'S2', to: 'S3' },
  ...cases.map((item) => ({
    from: 'S3', to: 'S4', actionId: `choose-${item.id.split('-')[0]}`,
  })),
  { from: 'S4', to: 'S5' },
  { from: 'S5', to: 'S6' },
];

export const NEW_YORK_SHARED_SHELL_PACKAGE = Object.freeze({
  schemaVersion: 1,
  id: 'new-york-disordered-archive',
  version: '0.2.0-dev',
  status: 'development',
  title: '失序的城市档案 · 纽约共享剧情壳',
  city: 'New York',
  releaseCriteria: {
    anchorCount: 36,
    segmentCounts: { 'shared-opening': 3, case: 30, 'final-reasoning': 3 },
    caseAnchorCounts: {
      'manhattan-time': 10,
      'brooklyn-shoreline': 10,
      'queens-future': 10,
    },
  },
  participantRules: {
    min: 1,
    max: 4,
    navigation: { rotation: 'per-noncombat-anchor' },
    contributionRegions: { layout: 'shared-panorama-overlay', persistentPanels: false },
    voting: {
      visibility: 'public', tieBreak: ['evidence', 'navigator'], evidenceDecision: 'group',
    },
    combatRoles: ['attack', 'defense', 'evidence', 'support'],
    roleAssignments: {
      1: [['attack', 'defense', 'evidence', 'support']],
      2: [['attack', 'defense'], ['evidence', 'support']],
      3: [['attack', 'defense'], ['evidence'], ['support']],
      4: [['attack'], ['defense'], ['evidence'], ['support']],
    },
  },
  nextCityIntentions: [
    'london', 'paris', 'rome', 'cairo', 'istanbul', 'mumbai', 'bangkok', 'tokyo', 'sydney',
  ],
  cases,
  sources,
  evidence,
  graph: { startNodeId: 'S1', nodes, edges },
  geography: {
    routes: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      transition: nodes.find((node) => node.id === edge.to)?.streetViewTarget.transition ?? 'walk',
      routeStatus: 'needs-live-check',
    })),
  },
  endings: cases.map((item) => ({
    id: item.endingId,
    caseId: item.id,
    title: `${item.title} · 档案关系已恢复`,
    caseTruth: item.truth,
    cityMystery: '本案证明失序档案通过删除并存关系来制造单线城市记忆。',
    requiresEvidence: [
      'protected-archive-layer',
      `${item.id}-combined-evidence`,
      `${item.id}-causal-sequence`,
      `${item.id}-conclusion`,
    ],
    cultureCard: { id: `${item.id}-culture-card` },
  })),
});
