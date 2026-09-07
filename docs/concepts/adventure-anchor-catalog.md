# 十城冒险锚点与推进条件

## 当前交互形态

非战斗任务共用一个 `aria-modal="false"` 的浮层面板，并非会阻断整页操作的模态弹窗。
观察收集、对话、地点史实解谜、历史答题、环境解谜和 Boss 战后的史实判断都在该面板中。
战斗、施法、转动视角与街景步行发生在 canvas；战斗浮层只显示目标、剩余敌人与来源。
每个街景最多出现 2 只怪物，战斗只负责清除干扰；所有战斗点清场或跳过后，仍须完成
地点线索谜题，谜题完成才会开启下一街景。

当前版本的“观察收集”仍是点击面板按钮，“环境解谜”仍是三选一判定；直接点击街景目标、
拖拽结构或在街景中寻找热点属于后续增强，不应把当前实现描述成已经具备这些能力。

## 通用八步与进入下一锚点的条件

| 步骤 | 互动 | 当前完成条件 |
| --- | --- | --- |
| 1 | 观察收集 | 点击“收集地点线索”；当前无街景物件命中检测 |
| 2 | 对话选择 | 任一有效选项都完成；选择只改变章内掌握度或第 7 点敌人数 |
| 3 | 轻量战斗 + 地点谜题 | 清空不超过 2 只异常或安全跳过，再完成地点线索谜题 |
| 4 | 地点史实解谜 | 选中与当前地点史实一致的线索；连续失败 3 次自动揭示答案并继续 |
| 5 | 历史答题 | 选中正确史实；连续失败 3 次自动揭示答案并继续 |
| 6 | 环境解谜 | 选中正确解法；连续失败 3 次自动揭示答案并继续 |
| 7 | 轻量精英战 + 地点谜题 | 清空不超过 2 只异常或安全跳过，再解谜；“先听”可减为 1 只 |
| 8 | 轻量 Boss + 史实判断 | 清空或跳过不超过 2 只守关异常，再完成史实/奇幻判断 |

完成普通锚点后等待约 1.15 秒进入下一点；第 8 点生成文化资料卡，约 4 秒后进入下一城。
街景链接、坐标解析或地图服务失败都不是推进条件，导演会安全转场并继续任务。

## 八十个锚点

表中缩写：收集、对话、战斗、史实解谜、答题、环境解谜、精英、Boss 分别对应上述 1–8 步。

| 章 | 城市 | 锚点与交互顺序 |
| --- | --- | --- |
| 1 | 纽约 | Duffy Square（收集） → TKTS 红阶（对话） → Broadway Plaza（战斗） → One Times Square（史实解谜） → 剧院区（答题） → 42nd Street（环境解谜） → Bryant Park（精英） → Grand Central 外广场（Boss） |
| 2 | 东京 | 忠犬八公像（收集） → 涩谷十字路口（对话） → SHIBUYA 109（战斗） → Center-gai（史实解谜） → Nonbei Yokocho（答题） → Miyashita Park（环境解谜） → Shibuya Stream（精英） → Sakuragaoka（Boss） |
| 3 | 巴黎 | Trocadéro（收集） → Palais de Chaillot（对话） → Pont d’Iéna（战斗） → 埃菲尔塔北侧（史实解谜） → Champ de Mars（答题） → École Militaire（环境解谜） → Bir-Hakeim（精英） → 塞纳河岸（Boss） |
| 4 | 雅典 | 卫城博物馆（收集） → Dionysiou 步道（对话） → 酒神剧场（战斗） → Herodes Atticus 剧场（史实解谜） → Areopagus（答题） → Propylaea（环境解谜） → Parthenon 视点（精英） → Agora 方向视点（Boss） |
| 5 | 莫斯科 | Manege Square（收集） → Resurrection Gate（对话） → 国家历史博物馆（战斗） → Kazan Cathedral（史实解谜） → GUM（答题） → Nikolskaya Street（环境解谜） → St Basil / Lobnoye Mesto（精英） → Zaryadye（Boss） |
| 6 | 阿格拉 | 东门入口（收集） → 前庭（对话） → Great Gate（战斗） → Charbagh（史实解谜） → 中央倒影池（答题） → Mosque（环境解谜） → 陵墓平台（精英） → Mehtab Bagh 视点（Boss） |
| 7 | 马丘比丘 | 入口（收集） → 上层梯田（对话） → Guardhouse（战斗） → 农业区（史实解谜） → Quarry（答题） → Temple of the Sun（环境解谜） → Sacred Plaza（精英） → Intihuatana / 城区出口（Boss） |
| 8 | 开普敦 | Lower Cableway（收集） → Platteklip 起点（对话） → Upper Station（战斗） → 西侧视点（史实解谜） → Summit Path（答题） → Maclear’s Beacon（环境解谜） → Twelve Apostles 视点（精英） → 城市 / 海湾终点视点（Boss） |
| 9 | 迪拜 | Burj Plaza（收集） → Dubai Mall 外部（对话） → Dubai Fountain（战斗） → Souk Al Bahar（史实解谜） → Dubai Opera（答题） → Burj Park（环境解谜） → Sheikh Mohammed Boulevard（精英） → 天际线终点（Boss） |
| 10 | 悉尼 | Circular Quay（收集） → East Circular Quay（对话） → Bennelong Point（战斗） → Opera House Forecourt（史实解谜） → Monumental Steps（答题） → Botanic Garden Gate（环境解谜） → Mrs Macquarie’s Point（精英） → The Rocks / Harbour Bridge 视点（Boss） |
