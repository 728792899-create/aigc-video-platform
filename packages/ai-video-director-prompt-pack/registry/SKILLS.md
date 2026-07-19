# Skill 运营手册

> 31 个Skill均为clean-room独立策略包。运行时以`skills.json`为真相，模型首先只看到manifest，明确激活后才加载policyPatch。

每次最多激活一个主要故事类型和一个主要视觉类型；生产Skill可组合，但不能放宽安全、Schema、身份、连续性、已批准事实或工具权限。

## 1. `story.genre.urban-emotion@1.0.0` — 都市情感

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：以现实关系与选择推进冲突，避免只靠误会拖延。

### 激活后指令

- 以现实关系与选择推进冲突，避免只靠误会拖延。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 人物动机可信
- 关系变化有因果
- 情绪落点可表演

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`
## 2. `story.genre.sweet-romance@1.0.0` — 甜宠

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：建立双向吸引、边界尊重与递进互动，甜点必须推动关系。

### 激活后指令

- 建立双向吸引、边界尊重与递进互动，甜点必须推动关系。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 互动有来有回
- 冲突不伤害人格
- 高甜节点可视化

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`
## 3. `story.genre.comeback@1.0.0` — 逆袭

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：用能力、选择与代价构成逆转，提前埋设可回收证据。

### 激活后指令

- 用能力、选择与代价构成逆转，提前埋设可回收证据。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 逆转有铺垫
- 代价真实
- 爽点不依赖降智

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 4. `story.genre.mystery@1.0.0` — 悬疑

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：控制信息披露、线索公平性与误导边界，答案必须可回溯。

### 激活后指令

- 控制信息披露、线索公平性与误导边界，答案必须可回溯。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 线索可验证
- 悬念逐级升级
- 揭晓解释前文

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 5. `story.genre.thriller@1.0.0` — 惊悚

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：通过空间、声音、时间压力和未知风险制造紧张，避免无意义血腥。

### 激活后指令

- 通过空间、声音、时间压力和未知风险制造紧张，避免无意义血腥。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 威胁逐步显现
- 空间关系清楚
- 安全政策通过

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 6. `story.genre.comedy@1.0.0` — 喜剧

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：以人物目标、错位和节奏形成笑点，避免弱势群体刻板化。

### 激活后指令

- 以人物目标、错位和节奏形成笑点，避免弱势群体刻板化。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 笑点服务人物
- 铺垫与回收明确
- 节奏有停顿

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 7. `story.genre.family@1.0.0` — 家庭伦理

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：呈现代际需求、责任和边界，不把复杂关系简化为单方恶人。

### 激活后指令

- 呈现代际需求、责任和边界，不把复杂关系简化为单方恶人。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 各方诉求可理解
- 冲突可表演
- 结局回应核心选择

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 8. `story.genre.workplace@1.0.0` — 职场

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：以任务、权责、资源和职业选择推动戏剧，避免虚假专业细节。

### 激活后指令

- 以任务、权责、资源和职业选择推动戏剧，避免虚假专业细节。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 权责明确
- 专业信息可核验
- 成长有行动证据

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 9. `story.genre.costume@1.0.0` — 古装

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：统一时代语汇、礼制、服装和空间逻辑；架空设定也要内部一致。

### 激活后指令

- 统一时代语汇、礼制、服装和空间逻辑；架空设定也要内部一致。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 时代约束一致
- 称谓稳定
- 道具与礼制不穿帮

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 10. `story.genre.wuxia-xianxia@1.0.0` — 武侠仙侠

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：定义力量规则、招式代价和空间调度，动作服务人物选择。

### 激活后指令

- 定义力量规则、招式代价和空间调度，动作服务人物选择。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 力量体系不漂移
- 动作可分镜
- 升级有代价

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 11. `story.genre.science-fiction@1.0.0` — 科幻

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：先定义技术规则、限制和社会影响，再让人物选择检验设定。

### 激活后指令

- 先定义技术规则、限制和社会影响，再让人物选择检验设定。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 规则自洽
- 科技不万能
- 视觉奇观服务主题

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 12. `story.genre.healing-growth@1.0.0` — 治愈成长

- 家族：`story.genre`
- 阶段：`outline`、`script`、`shot`、`review`
- 用途：用小行动、关系支持和可观察变化呈现成长，避免口号式说教。

### 激活后指令

- 用小行动、关系支持和可观察变化呈现成长，避免口号式说教。
- 类型规则只能增强表达，不得改变已批准剧情事实。
- 把类型节拍转成可观察动作、对白或镜头。

### 评测 Rubric

- 变化渐进
- 情绪留白有效
- 收束不虚假完美

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 13. `art.style.cinematic-realism@1.0.0` — 电影写实

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用可信材质、物理光线、镜头景深和克制调色；保持人物真实比例。

### 激活后指令

- 使用可信材质、物理光线、镜头景深和克制调色；保持人物真实比例。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 材质可信
- 光源有依据
- 不过度磨皮或塑料感

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 14. `art.style.commercial@1.0.0` — 商业广告

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：突出单一卖点、清晰产品层级、干净构图与品牌安全留白。

### 激活后指令

- 突出单一卖点、清晰产品层级、干净构图与品牌安全留白。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 主体一眼可读
- 卖点不被特效遮挡
- 文字安全区充足

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 15. `art.style.japanese-2d@1.0.0` — 日系二维动画

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用二维线条、分层色块、明确轮廓和动画化表演，不模仿具体艺术家。

### 激活后指令

- 使用二维线条、分层色块、明确轮廓和动画化表演，不模仿具体艺术家。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 轮廓稳定
- 色块干净
- 角色表情可持续

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 16. `art.style.chinese-2d@1.0.0` — 国风二维动画

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：结合中国视觉元素、克制线色与空间意境，避免无依据符号堆砌。

### 激活后指令

- 结合中国视觉元素、克制线色与空间意境，避免无依据符号堆砌。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 文化元素有语境
- 留白服务叙事
- 服饰道具统一

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 17. `art.style.3d-animation@1.0.0` — 三维动画

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：统一建模比例、材质响应、灯光和镜头尺度，保持角色拓扑视觉稳定。

### 激活后指令

- 统一建模比例、材质响应、灯光和镜头尺度，保持角色拓扑视觉稳定。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 模型比例稳定
- 材质与光照一致
- 运动有重量

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 18. `art.style.cel-shaded@1.0.0` — 赛璐璐

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用清晰色阶、受控阴影边界和统一描边，避免写实噪声破坏风格。

### 激活后指令

- 使用清晰色阶、受控阴影边界和统一描边，避免写实噪声破坏风格。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 色阶数量稳定
- 描边一致
- 阴影方向统一

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 19. `art.style.manga-ink@1.0.0` — 漫画墨线

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用黑白或有限色、线条粗细、网点和分格节奏，保证阅读方向。

### 激活后指令

- 使用黑白或有限色、线条粗细、网点和分格节奏，保证阅读方向。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 线条层级清楚
- 网点不过载
- 分格视线连续

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 20. `art.style.watercolor@1.0.0` — 水彩绘本

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用透明叠色、纸张纹理、柔和边缘和保留高光，同时锁定角色轮廓。

### 激活后指令

- 使用透明叠色、纸张纹理、柔和边缘和保留高光，同时锁定角色轮廓。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 水色自然扩散
- 主体仍可识别
- 色彩不脏

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 21. `art.style.ink-wash@1.0.0` — 水墨

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用墨色层次、虚实、气韵与留白，人物和关键道具仍保持可辨身份。

### 激活后指令

- 使用墨色层次、虚实、气韵与留白，人物和关键道具仍保持可辨身份。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 墨色层次明确
- 留白有功能
- 身份锚点不丢失

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 22. `art.style.clay-stop-motion@1.0.0` — 黏土定格

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：表现手工材质、微小指纹、分帧运动和实体布景尺度。

### 激活后指令

- 表现手工材质、微小指纹、分帧运动和实体布景尺度。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 材质统一
- 运动有定格节奏
- 布景尺度可信

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 23. `art.style.cyber-neon@1.0.0` — 赛博霓虹

- 家族：`art.style`
- 阶段：`style`、`assets`、`frame`、`render`、`review`
- 用途：使用受控霓虹、湿地反射、技术界面和高低明度层级，避免视觉信息过载。

### 激活后指令

- 使用受控霓虹、湿地反射、技术界面和高低明度层级，避免视觉信息过载。
- 只描述可观察视觉特征，不模仿具体在世艺术家。
- 人物身份、资产版本和连续性优先于风格变化。

### 评测 Rubric

- 主体从霓虹中分离
- 界面不抢叙事
- 色彩层级清楚

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 24. `production.vertical-short@1.0.0` — 竖屏短视频

- 家族：`production`
- 阶段：`brief`、`outline`、`script`、`shot`、`frame`、`render`、`compose`、`review`
- 用途：以9:16安全区、前三秒钩子、近中景主体和移动端字幕可读性组织镜头。

### 激活后指令

- 以9:16安全区、前三秒钩子、近中景主体和移动端字幕可读性组织镜头。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 开场三秒有信息增量
- 人物面部与字幕不冲突
- 节奏适配目标时长

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 25. `production.horizontal-film@1.0.0` — 横屏短片

- 家族：`production`
- 阶段：`brief`、`outline`、`script`、`shot`、`frame`、`render`、`compose`、`review`
- 用途：以16:9空间调度、环境关系和更长呼吸组织镜头，避免把竖屏构图直接拉宽。

### 激活后指令

- 以16:9空间调度、环境关系和更长呼吸组织镜头，避免把竖屏构图直接拉宽。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 空间建立充分
- 景别变化有目的
- 画面边缘有叙事信息

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 26. `production.comic-panels@1.0.0` — 漫剧分格

- 家族：`production`
- 阶段：`shot`、`frame`、`render`、`compose`、`review`
- 用途：按阅读顺序、视线、对白气泡安全区和分格节奏设计画面，保持角色朝向。

### 激活后指令

- 按阅读顺序、视线、对白气泡安全区和分格节奏设计画面，保持角色朝向。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 阅读顺序无歧义
- 对白与主体不遮挡
- 分格间动作承接

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 27. `production.novel-adaptation@1.0.0` — 小说改编

- 家族：`production`
- 阶段：`import`、`outline`、`script`、`shot`
- 用途：保留来源跨度和核心因果，把内心叙述转换为动作、对白、声音或可见选择。

### 激活后指令

- 保留来源跨度和核心因果，把内心叙述转换为动作、对白、声音或可见选择。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 来源映射完整
- 不擅自改核心结局
- 内心信息完成视听转译

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 28. `production.character-consistency@1.0.0` — 角色一致性

- 家族：`production`
- 阶段：`assets`、`continuity`、`frame`、`render`、`review`
- 用途：强制注入角色版本、身份锚点、允许变体和禁改项；候选必须逐项检查。

### 激活后指令

- 强制注入角色版本、身份锚点、允许变体和禁改项；候选必须逐项检查。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 面孔与年龄稳定
- 服装变化有版本
- 引用角色不混淆

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 29. `production.spatial-continuity@1.0.0` — 空间连续性

- 家族：`production`
- 阶段：`assets`、`continuity`、`shot`、`frame`、`render`、`review`
- 用途：锁定入口、光源、屏幕方向、角色站位和场景关键地标。

### 激活后指令

- 锁定入口、光源、屏幕方向、角色站位和场景关键地标。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 轴线可解释
- 入口出口一致
- 光源方向连续

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 30. `production.prop-continuity@1.0.0` — 道具状态连续性

- 家族：`production`
- 阶段：`assets`、`continuity`、`shot`、`frame`、`render`、`review`
- 用途：锁定道具版本、比例、持有者、左右手、损耗与交接状态。

### 激活后指令

- 锁定道具版本、比例、持有者、左右手、损耗与交接状态。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 道具不消失
- 左右手与位置承接
- 状态变化有事件依据

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`

## 31. `production.candidate-supervision@1.0.0` — 候选质量监督

- 家族：`production`
- 阶段：`review`
- 用途：先独立评分再排序；硬失败单列，允许全部不合格并建议最小重做范围。

### 激活后指令

- 先独立评分再排序；硬失败单列，允许全部不合格并建议最小重做范围。
- 只追加生产策略和评测标准，不直接写数据库或批准产物。
- 任何能力降级、权利风险或身份冲突都必须暂停。

### 评测 Rubric

- 评分有可观察证据
- 不受候选顺序影响
- 硬失败不被平均分掩盖

### 不可覆盖

`system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions`、`network-policy`
