import { SCENES } from '../config/scenes.js';

export const CULTURAL_CAMPAIGN_VERSION = 2;

export const INTERACTION_SEQUENCE = Object.freeze([
  'collect', 'dialogue', 'combat', 'puzzle', 'quiz', 'puzzle', 'combat', 'boss'
]);

const SOURCES = Object.freeze({
  newYork: {
    id: 'times-square-history',
    institution: 'Times Square Alliance / Museum of the City of New York',
    title: 'History of Times Square',
    url: 'https://www.timessquarenyc.org/times-square-alliance/history',
    verified: '2026-09-02'
  },
  tokyo: {
    id: 'shibuya-hachiko',
    institution: 'Shibuya City',
    title: 'City News Shibuya — Hachiko and the city',
    url: 'https://files.city.shibuya.tokyo.jp/assets/12995aba8b194961be709ba879857f70/5d803a748f4446d2aa7c74904d5a18de/assets_kusei_000067174.pdf',
    verified: '2026-09-02'
  },
  paris: {
    id: 'eiffel-history', institution: 'Official Eiffel Tower Website',
    title: 'The Eiffel Tower and the 1889 World’s Fair',
    url: 'https://www.toureiffel.paris/en/the-monument/history', verified: '2026-09-02'
  },
  athens: {
    id: 'acropolis-unesco', institution: 'UNESCO World Heritage Centre',
    title: 'Acropolis, Athens', url: 'https://whc.unesco.org/en/list/404', verified: '2026-09-02'
  },
  moscow: {
    id: 'red-square-unesco', institution: 'UNESCO World Heritage Centre',
    title: 'Kremlin and Red Square, Moscow', url: 'https://whc.unesco.org/en/list/545/', verified: '2026-09-02'
  },
  agra: {
    id: 'taj-mahal-unesco', institution: 'UNESCO World Heritage Centre',
    title: 'Taj Mahal', url: 'https://whc.unesco.org/en/list/252/', verified: '2026-09-02'
  },
  machu: {
    id: 'machu-picchu-unesco', institution: 'UNESCO World Heritage Centre',
    title: 'Historic Sanctuary of Machu Picchu', url: 'https://whc.unesco.org/en/list/274', verified: '2026-09-02'
  },
  capeTown: {
    id: 'table-mountain-sanparks', institution: 'South African National Parks',
    title: 'Table Mountain — Natural & Cultural History',
    url: 'https://www.sanparks.org/parks/table-mountain/explore/natural-cultural-history', verified: '2026-09-02'
  },
  dubai: {
    id: 'burj-khalifa-design', institution: 'Burj Khalifa',
    title: 'Architecture and design', url: 'https://www.burjkhalifa.ae/the-tower/architecture-design/', verified: '2026-09-02'
  },
  sydney: {
    id: 'opera-house-story', institution: 'Sydney Opera House',
    title: 'Our story', url: 'https://www.sydneyoperahouse.com/our-story', verified: '2026-09-02'
  }
});

export const CULTURAL_REVIEW_STATUS = Object.freeze({
  REVIEWED_FICTIONALISED: 'reviewed-fictionalised',
});

const ANOMALY_KIND = Object.freeze({ ABSTRACT: 'abstract' });
const ABSTRACT_ANOMALY = Object.freeze({
  kind: ANOMALY_KIND.ABSTRACT,
  label: '无定形的记忆噪声',
});

function hasCompletedCulturalReview(status) {
  return status === CULTURAL_REVIEW_STATUS.REVIEWED_FICTIONALISED;
}

function anomalyFor(seed) {
  return hasCompletedCulturalReview(seed.legendStatus)
    ? Object.freeze({ kind: CULTURAL_REVIEW_STATUS.REVIEWED_FICTIONALISED, label: seed.legend })
    : ABSTRACT_ANOMALY;
}

const CHAPTER_SEEDS = [
  {
    id: 'new-york', sceneId: 'times-square', zh: '纽约 · 光之广场', en: 'New York — Electric Square',
    legend: '百老汇幽灵与地下都市传说的异常投影',
    legendStatus: CULTURAL_REVIEW_STATUS.REVIEWED_FICTIONALISED,
    theme: '从 Longacre Square、百老汇和电光广告走到公共城市空间。',
    route: [
      ['duffy-square', 'Duffy Square', 40.75902, -73.98502], ['tkts-steps', 'TKTS 红阶', 40.7589, -73.98474],
      ['broadway-plaza', 'Broadway Plaza', 40.75805, -73.98516], ['one-times-square', 'One Times Square', 40.75643, -73.9865],
      ['theater-district', '剧院区', 40.75872, -73.98773], ['west-42nd', '42nd Street', 40.7569, -73.98602],
      ['bryant-park', 'Bryant Park', 40.7536, -73.98323], ['grand-central', 'Grand Central 外广场', 40.75273, -73.97723]
    ],
    facts: [
      '这里早期被称为 Longacre Square，与马车交易区有关。', '电灯、剧院广告和公共交通共同改变了广场。',
      '百老汇的剧场文化让这一带成为娱乐中心。', '1904 年，这一带随《纽约时报》大楼更名为 Times Square。',
      '剧院与街头广告共同塑造了这里的视觉语言。', '早期地铁让纽约人更容易抵达这个路口。',
      '公共座椅与步行空间改变了人们使用街道的方式。', '纽约的时间、交通与表演在这里交汇。'
    ], source: SOURCES.newYork, puzzle: '把“马车广场 → 地铁 → 电光广告 → 公共步行空间”按时间顺序排列。'
  },
  {
    id: 'tokyo', sceneId: 'shibuya', zh: '东京 · 人潮的十字', en: 'Tokyo — Crossing of Crowds',
    legend: '付丧神、狐与都市妖怪的异常化身', legendStatus: 'review-required',
    theme: '忠诚、战后青年文化、路口秩序与车站持续再开发。',
    route: [
      ['hachiko', '忠犬八公像', 35.65906, 139.70065], ['scramble', '涩谷十字路口', 35.65949, 139.70051],
      ['shibuya-109', 'SHIBUYA 109', 35.65965, 139.69931], ['center-gai', 'Center-gai', 35.66023, 139.69905],
      ['nonbei-yokocho', 'Nonbei Yokocho', 35.66087, 139.70135], ['miyashita', 'Miyashita Park', 35.66178, 139.70142],
      ['shibuya-stream', 'Shibuya Stream', 35.65755, 139.70336], ['sakuragaoka', 'Sakuragaoka', 35.65695, 139.69955]
    ],
    facts: [
      '八公因长期在涩谷站等待主人而成为忠诚的象征。', '全向放行让行人在一个信号周期内从多个方向穿越。',
      '商业立面不断改变涩谷的青年文化表达。', '中心街把音乐、时装与夜间城市生活聚在一起。',
      '狭窄巷道保存了与大型商业体不同的城市尺度。', '公园与交通设施在高密度城市里叠合。',
      '涩谷川周边再开发重新显露了城市与水的关系。', '车站持续施工使涩谷成为“不断完成中的城市”。'
    ], source: SOURCES.tokyo, puzzle: '根据行人信号，把来自四个方向的人流放进不相撞的穿越顺序。'
  },
  {
    id: 'paris', sceneId: 'eiffel', zh: '巴黎 · 铁之轴线', en: 'Paris — Axis of Iron',
    legend: '石像鬼与地下幽灵的异常化身', legendStatus: 'review-required',
    theme: '世界博览会、铁结构、城市轴线、科学实验与公共记忆。',
    route: [
      ['trocadero', 'Trocadéro', 48.86225, 2.2882], ['chaillot', 'Palais de Chaillot', 48.862, 2.28803],
      ['iena-bridge', 'Pont d’Iéna', 48.85962, 2.2925], ['north-pillar', '埃菲尔塔北侧', 48.85845, 2.2945],
      ['champ-de-mars', 'Champ de Mars', 48.85665, 2.29665], ['ecole-militaire', 'École Militaire', 48.8525, 2.30425],
      ['bir-hakeim', 'Bir-Hakeim', 48.8554, 2.2892], ['seine-quay', '塞纳河岸', 48.85815, 2.28755]
    ],
    facts: [
      'Trocadéro 提供了观察塔与城市轴线的正面视角。', '今天的 Chaillot 宫延续了世界博览会场地的城市角色。',
      '耶拿桥把塞纳河两岸的博览会空间连接起来。', '埃菲尔塔为 1889 年世界博览会而建。',
      '塔的铁结构曾引发关于现代工程与城市美感的争论。', '塔的高度让它后来成为科学实验与无线通信的平台。',
      '桥梁结构提供了另一种观察钢铁时代的方式。', '塞纳河把纪念物放回巴黎长期演化的城市景观中。'
    ], source: SOURCES.paris, puzzle: '旋转三段铁桁架，让受力线从塔基连续传到中心。'
  },
  {
    id: 'athens', sceneId: 'acropolis', zh: '雅典 · 石与声音', en: 'Athens — Stone and Voice',
    legend: '鹰身女妖、迷宫与古代自动机的异常化身', legendStatus: 'review-required',
    theme: '民主、戏剧、神庙比例，以及遗址在两千多年中的不断变化。',
    route: [
      ['museum', '卫城博物馆', 37.96845, 23.72855], ['dionysiou', 'Dionysiou 步道', 37.96808, 23.72684],
      ['dionysus-theatre', '酒神剧场', 37.97028, 23.72742], ['herodes', 'Herodes Atticus 剧场', 37.97083, 23.72455],
      ['areopagus', 'Areopagus', 37.9722, 23.7233], ['propylaea', 'Propylaea', 37.97175, 23.7251],
      ['parthenon', 'Parthenon 视点', 37.97153, 23.72672], ['agora-view', 'Agora 方向视点', 37.9747, 23.7228]
    ],
    facts: [
      '博物馆把出土材料与遗址本身保持视觉联系。', '南坡步道连接多处表演与宗教空间。',
      '戏剧与公共表达是古典雅典文化的重要组成。', '古代剧场至今仍说明声音、坡度与观众之间的关系。',
      '岩丘与城市公共空间共同形成讨论和记忆的地景。', 'Propylaea 是进入卫城纪念建筑群的重要门廊。',
      '公元前五世纪的建设计划塑造了今天最熟悉的卫城形象。', '卫城经历战争、爆炸、改建与修复，并非被冻结的遗迹。'
    ], source: SOURCES.athens, puzzle: '把柱基、柱身与柱头拖到正确层级，再找出负责承重的连续结构。'
  },
  {
    id: 'moscow', sceneId: 'red-square', zh: '莫斯科 · 层叠之城', en: 'Moscow — Layers of Power',
    legend: '家宅精灵与火鸟阴影的异常化身', legendStatus: 'review-required',
    theme: '市集、宗教、帝国、苏联与当代城市在同一广场上的叠层。',
    route: [
      ['manege', 'Manege Square', 55.75582, 37.6173], ['resurrection-gate', 'Resurrection Gate', 55.7557, 37.61782],
      ['history-museum', '国家历史博物馆', 55.7553, 37.6177], ['kazan', 'Kazan Cathedral', 55.75558, 37.6191],
      ['gum', 'GUM', 55.75472, 37.6215], ['nikolskaya', 'Nikolskaya Street', 55.757, 37.6215],
      ['st-basil', 'St Basil / Lobnoye Mesto', 55.7525, 37.6231], ['zaryadye', 'Zaryadye', 55.751, 37.628]
    ],
    facts: [
      '广场周边空间记录了莫斯科中心不断扩展的边界。', '城门把城市街道引向克里姆林宫与红场。',
      '历史博物馆属于十九世纪末完成的广场建筑层。', '宗教建筑提醒人们广场并非只有政治功能。',
      'GUM 延续了红场作为交易空间的一面。', 'Nikolskaya 是通向城市旧核心的重要街道之一。',
      '圣瓦西里大教堂建于十六世纪，并成为广场南端的视觉标志。', '现代公园让河岸与历史核心重新连接。'
    ], source: SOURCES.moscow, puzzle: '把“堡垒、宗教、市场、纪念性政治建筑”放到同一广场的正确方向。'
  },
  {
    id: 'agra', sceneId: 'taj-mahal', zh: '阿格拉 · 镜园', en: 'Agra — Garden of Mirrors',
    legend: '经审核的镜像精灵；宗教性形象不作为敌人', legendStatus: 'fallback-abstract-until-reviewed',
    theme: '莫卧儿花园几何、跨地区工艺、河流与纪念叙事。',
    route: [
      ['east-gate', '东门入口', 27.1743, 78.0436], ['forecourt', '前庭', 27.17415, 78.0429],
      ['great-gate', 'Great Gate', 27.17445, 78.0422], ['charbagh', 'Charbagh', 27.1739, 78.0421],
      ['reflecting-pool', '中央倒影池', 27.1747, 78.0421], ['mosque', 'Mosque', 27.1752, 78.0408],
      ['mausoleum-terrace', '陵墓平台', 27.1751, 78.0421], ['mehtab-bagh', 'Mehtab Bagh 视点', 27.1796, 78.0419]
    ],
    facts: [
      '入口序列把喧闹城市逐步过渡到纪念性花园。', '外庭与后续完成的附属空间共同构成完整建筑群。',
      '主门承担了框景作用，使陵墓在门洞中逐渐出现。', 'Taj Mahal 位于亚穆纳河右岸约十七公顷的莫卧儿花园中。',
      '水道与倒影强化了花园的轴线和对称。', '清真寺与相对建筑共同平衡陵墓平台。',
      '工程汇集了帝国、伊朗与中亚等地的工匠传统。', '隔河观察能看见纪念物、花园和河流作为一个整体。'
    ], source: SOURCES.agra, puzzle: '补全四分花园的水道，让四个象限重新围绕中轴对称。'
  },
  {
    id: 'machu-picchu', sceneId: 'machu-picchu', zh: '马丘比丘 · 云上石城', en: 'Machu Picchu — City in the Clouds',
    legend: '山灵只作为经审核的引导者；战斗使用石与云的异常回声', legendStatus: 'fallback-abstract-until-reviewed',
    theme: '山地工程、农业梯田、道路、天文观察与考古叙事边界。',
    route: [
      ['entrance', '入口', -13.1641, -72.5459], ['upper-terraces', '上层梯田', -13.1637, -72.5454],
      ['guardhouse', 'Guardhouse', -13.1633, -72.5452], ['agricultural-sector', '农业区', -13.164, -72.5451],
      ['quarry', 'Quarry', -13.163, -72.5447], ['temple-sun', 'Temple of the Sun', -13.1631, -72.545],
      ['sacred-plaza', 'Sacred Plaza', -13.1628, -72.5448], ['intihuatana', 'Intihuatana / 城区出口', -13.1625, -72.5449]
    ],
    facts: [
      '遗址位于安第斯山与亚马孙盆地交会的高山环境。', '梯田把农业、排水与山体稳定联系在一起。',
      '上层视点清楚显示建筑与陡峭地形的结合。', '城市规划区分农业、居住与公共空间。',
      '许多建筑直接利用和修整原有岩体。', '部分建筑与太阳观察有关，但具体用途仍有未解问题。',
      '约两百座结构组成宗教、仪式、天文与农业中心。', '遗址叙事必须区分印加历史、后来的考古解释与仍未确定的推测。'
    ], source: SOURCES.machu, puzzle: '调整梯田、水渠与坡度，让雨水依次穿过农业区而不冲毁石墙。'
  },
  {
    id: 'cape-town', sceneId: 'table-mountain', zh: '开普敦 · 海中之山', en: 'Cape Town — Mountain in the Sea',
    legend: '飞翔荷兰人与桌布云的异常化身', legendStatus: 'review-required',
    theme: '地质、桌布云、生物多样性、航海方向与多语言历史。',
    route: [
      ['lower-cableway', 'Lower Cableway', -33.9573, 18.4039], ['platteklip', 'Platteklip 起点', -33.9603, 18.4096],
      ['upper-station', 'Upper Station', -33.9628, 18.4038], ['western-view', '西侧视点', -33.963, 18.402],
      ['summit-path', 'Summit Path', -33.9626, 18.407], ['maclears-beacon', 'Maclear’s Beacon', -33.9629, 18.425],
      ['twelve-apostles', 'Twelve Apostles 视点', -33.966, 18.398], ['city-bay-view', '城市 / 海湾终点视点', -33.9618, 18.4101]
    ],
    facts: [
      '山体长期作为城市方向标与通往高地的入口。', 'Platteklip Gorge 在欧洲人抵达前已是本地上山通道。',
      '缆车把登山路径之外的公众带到高原。', '山与海的关系体现在早期 Khoi 名称 Hoerikwaggo 中。',
      '夏季东南风形成著名的“桌布云”。', '高原的地形与气候支持独特植物群落。',
      '山地属于全球重要的开普植物区保护体系。', '保护工作同时涉及生态、火灾、外来种与社区文化遗产。'
    ], source: SOURCES.capeTown, puzzle: '根据风向、湿度和山脊位置，判断桌布云会从哪一侧越过山顶。'
  },
  {
    id: 'dubai', sceneId: 'burj-khalifa', zh: '迪拜 · 沙海垂线', en: 'Dubai — Vertical Mirage',
    legend: '未经阿语文化审核时使用沙暴与海市蜃楼异常', legendStatus: 'fallback-abstract-until-reviewed',
    theme: '珍珠贸易、沙漠用水、现代结构、公共艺术与城市速度。',
    route: [
      ['burj-plaza', 'Burj Plaza', 25.1973, 55.2742], ['dubai-mall', 'Dubai Mall 外部', 25.197, 55.279],
      ['fountain', 'Dubai Fountain', 25.1955, 55.2754], ['souk-al-bahar', 'Souk Al Bahar', 25.1959, 55.274],
      ['dubai-opera', 'Dubai Opera', 25.1909, 55.2718], ['burj-park', 'Burj Park', 25.193, 55.2728],
      ['mbr-boulevard', 'Sheikh Mohammed Boulevard', 25.192, 55.278], ['skyline', '天际线终点', 25.198, 55.271]
    ],
    facts: [
      '塔与周边广场共同构成步行尺度和超高层尺度的对比。', '商业空间与公共交通支持高密度目的地。',
      '水景在沙漠城市中同时是工程资源与公共表演。', '传统市集意象在现代城区被重新解释。',
      '表演空间使新区不只依赖购物和观景。', '公共绿地调节高密度建筑之间的停留节奏。',
      '塔采用三翼围绕六边形核心的 Y 形平面以应对风力。', '建筑于 2010 年正式启用，成为迪拜快速城市化的标志。'
    ], source: SOURCES.dubai, puzzle: '分配有限水量给生活、绿地与冷却系统，在不透支储备的情况下维持城市。'
  },
  {
    id: 'sydney', sceneId: 'opera-house', zh: '悉尼 · 港湾回声', en: 'Sydney — Harbour Echo',
    legend: '原住民神圣故事不作为敌人；默认使用港湾幽灵船异常', legendStatus: 'fallback-abstract-until-reviewed',
    theme: 'Gadigal Country、殖民港口、现代建筑、表演艺术与海港生态。',
    route: [
      ['circular-quay', 'Circular Quay', -33.861, 151.2102], ['east-quay', 'East Circular Quay', -33.8594, 151.212],
      ['bennelong-point', 'Bennelong Point', -33.8574, 151.2149], ['forecourt', 'Opera House Forecourt', -33.8568, 151.2153],
      ['steps', 'Monumental Steps', -33.8566, 151.2152], ['botanic-gate', 'Botanic Garden Gate', -33.859, 151.2169],
      ['mrs-macquaries', 'Mrs Macquarie’s Point', -33.8598, 151.2223], ['rocks-view', 'The Rocks / Harbour Bridge 视点', -33.8572, 151.2099]
    ],
    facts: [
      'Circular Quay 是港口交通、步行与城市仪式交汇的空间。', '沿岸路线逐渐把视线引向 Bennelong Point。',
      '歌剧院所在地在 Gadigal 传统中称为 Tubowgule，是聚会与仪式之地。', '建筑由丹麦建筑师 Jørn Utzon 设计。',
      '屋顶形式最终通过球面几何找到可建造的统一解法。', '建筑、植物园和港湾共同构成公共海岸线。',
      '歌剧院于 1973 年开放，并成为持续使用的表演艺术中心。', '保护遗产既包括建筑，也包括场地更早的原住民历史与当代公共生活。'
    ], source: SOURCES.sydney, puzzle: '用同一个球面切出三组壳片，让不同大小的屋顶共享一种几何规则。'
  }
];

const TIER_UNLOCKS = [
  ['ice', 'thunder'], ['meteor', 'beam'], ['snare', 'glacier'],
  ['void', 'phoenix'], ['singularity', 'worldtree', 'repulse', 'heal']
];

function enemyRoster(chapterIndex, elite = false) {
  const tier = Math.floor(chapterIndex / 2);
  const kinds = ['normal', 'runner', 'tank', 'elite'].slice(0, Math.min(4, tier + 1));
  // Combat is punctuation, not the campaign's progression engine. Keep every
  // street readable and touch-friendly with at most two simultaneous targets.
  const count = 2;
  return Array.from({ length: count }, (_, index) => ({
    archetype: elite && index === 0 ? 'elite' : kinds[index % kinds.length],
    behaviour: index % 3 === 0 ? 'sentry' : index % 3 === 1 ? 'chase' : 'wanderer'
  }));
}

function interactionFor(seed, chapterIndex, anchorIndex) {
  const type = INTERACTION_SEQUENCE[anchorIndex];
  const fact = seed.facts[anchorIndex];
  const anomaly = anomalyFor(seed);
  if (type === 'dialogue') return {
    type, prompt: `你如何回应守望者关于“${seed.theme}”的提问？`,
    choices: [
      { id: 'listen', label: '先听完当地人的解释', effect: 'insight' },
      { id: 'act', label: '先处理眼前的异常', effect: 'momentum' }
    ]
  };
  if (type === 'combat' || type === 'boss') {
    const roster = enemyRoster(chapterIndex, anchorIndex >= 6);
    const followUp = type === 'boss' ? {
      type: 'quiz', label: '章末史实判断',
      prompt: '哪一句属于有来源的历史事实，而不是遗物制造的奇幻叙事？',
      choices: [fact, `遗物在这里创造了${anomaly.label}`, '所有传说都已被历史证实'], correct: 0
    } : {
      type: 'puzzle', label: '地点线索解谜',
      prompt: '净化只是清除干扰；选择与此地史实吻合的线索，才能开启下一段街景。',
      choices: [fact, `追随${anomaly.label}离开地点`, '忽略地点线索并随机选择方向'], correct: 0
    };
    return {
      type, count: roster.length, roster, anomaly, legend: anomaly.label,
      prompt: type === 'boss' ? `净化守关异常：${anomaly.label}` : `净化异常：${anomaly.label}`,
      followUp
    };
  }
  if (type === 'quiz') return {
    type, prompt: '哪一项最符合此地点的史实？',
    choices: [fact, '这一切都由遗物在一夜之间建成。', '这里从未经历用途或城市环境的变化。'], correct: 0
  };
  if (type === 'puzzle') return {
    type,
    prompt: anchorIndex === 3
      ? '找出与眼前地点史实一致的线索，排除遗物制造的虚构叙述。'
      : seed.puzzle,
    choices: anchorIndex === 3
      ? [fact, `这里的格局完全由${anomaly.label}在一夜之间创造。`, '地点的用途与城市环境从未发生变化。']
      : ['按地点线索恢复正确结构', '忽略地形，只按颜色排列', '让遗物替你完成'],
    correct: 0
  };
  return { type: 'collect', prompt: `观察街景，点击收集“${seed.route[anchorIndex][1]}”的线索。`, actionLabel: '收集地点线索' };
}

export const CITY_CHAPTERS = CHAPTER_SEEDS.map((seed, chapterIndex) => ({
  id: seed.id,
  order: chapterIndex + 1,
  sceneId: seed.sceneId,
  zh: seed.zh,
  en: seed.en,
  theme: seed.theme,
  legend: { description: seed.legend, status: seed.legendStatus, treatment: '净化遗物扭曲出的异常化身' },
  sources: [seed.source],
  tier: Math.floor(chapterIndex / 2),
  unlocks: TIER_UNLOCKS[Math.floor(chapterIndex / 2)],
  anchors: seed.route.map(([id, name, lat, lng], anchorIndex) => ({
    id: `${seed.id}-${id}`,
    order: anchorIndex + 1,
    name,
    lat,
    lng,
    radius: anchorIndex === 0 ? 180 : 120,
    transition: anchorIndex === 0 || anchorIndex === 7 ? 'cut' : 'walk',
    walkSteps: 4,
    routeStatus: 'needs-live-check',
    fact: seed.facts[anchorIndex],
    sourceRefs: [seed.source.id],
    interaction: interactionFor(seed, chapterIndex, anchorIndex)
  }))
}));

export const TOTAL_CULTURAL_ANCHORS = CITY_CHAPTERS.reduce((sum, chapter) => sum + chapter.anchors.length, 0);

export function chapterById(id) {
  return CITY_CHAPTERS.find((chapter) => chapter.id === id) ?? null;
}

export function sceneForChapter(chapter) {
  return SCENES.find((scene) => scene.id === chapter?.sceneId) ?? null;
}

export function unlockedForChapter(chapterIndex) {
  const tier = Math.floor(Math.max(0, chapterIndex) / 2);
  return TIER_UNLOCKS.slice(0, tier + 1).flat();
}

export function sourcesForAnchor(chapter, anchor) {
  if (!Array.isArray(anchor?.sourceRefs) || !Array.isArray(chapter?.sources)) return [];
  const sourceById = new Map(chapter.sources.map((source) => [source.id, source]));
  return anchor.sourceRefs.map((id) => sourceById.get(id)).filter(Boolean);
}

function isValidSource(source) {
  if (![source?.id, source?.institution, source?.title].every((value) =>
    typeof value === 'string' && value.trim())) return false;
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !url.hostname) return false;
  } catch {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.verified ?? '')) return false;
  const date = new Date(`${source.verified}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === source.verified;
}

export function validateCityChapters(chapters = CITY_CHAPTERS) {
  const errors = [];
  const ids = new Set();
  if (chapters.length !== 10) errors.push(`expected 10 chapters, got ${chapters.length}`);
  chapters.forEach((chapter, chapterIndex) => {
    if (chapter.anchors.length !== 8) errors.push(`${chapter.id}: expected 8 anchors`);
    const sourceIds = new Set();
    if (!Array.isArray(chapter.sources) || !chapter.sources.length) errors.push(`${chapter.id}: missing sources`);
    for (const source of chapter.sources ?? []) {
      if (!isValidSource(source)) errors.push(`${chapter.id}: invalid source ${source?.id ?? '(missing id)'}`);
      if (sourceIds.has(source?.id)) errors.push(`${chapter.id}: duplicate source ${source.id}`);
      sourceIds.add(source?.id);
    }
    chapter.anchors.forEach((anchor, anchorIndex) => {
      if (ids.has(anchor.id)) errors.push(`${anchor.id}: duplicate id`);
      ids.add(anchor.id);
      if (anchor.interaction.type !== INTERACTION_SEQUENCE[anchorIndex]) {
        errors.push(`${anchor.id}: expected ${INTERACTION_SEQUENCE[anchorIndex]}`);
      }
      if (!Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) errors.push(`${anchor.id}: invalid coordinates`);
      if (!anchor.fact) errors.push(`${anchor.id}: missing historical fact`);
      if (!Array.isArray(anchor.sourceRefs) || !anchor.sourceRefs.length) {
        errors.push(`${anchor.id}: missing source refs`);
      } else {
        for (const sourceRef of anchor.sourceRefs) {
          if (!sourceIds.has(sourceRef)) errors.push(`${anchor.id}: unknown source ref ${sourceRef}`);
        }
      }
      if (!hasCompletedCulturalReview(chapter.legend?.status) &&
          ['combat', 'boss'].includes(anchor.interaction.type) &&
          anchor.interaction.anomaly?.kind !== ANOMALY_KIND.ABSTRACT) {
        errors.push(`${anchor.id}: unreviewed culture must use an abstract anomaly`);
      }
    });
    if (chapter.order !== chapterIndex + 1) errors.push(`${chapter.id}: invalid order`);
  });
  return errors;
}
