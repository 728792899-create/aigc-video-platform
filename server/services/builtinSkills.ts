/**
 * 平台内置创作技能库（v1.6.15）
 *
 * 这些技能源自 SkillHub 短视频技能市场上「热度 + 实用度」排名靠前的能力，
 * 已转化为本平台「prompt 注入式增强」格式，可在文案/图片/配音阶段叠加生效。
 *
 * 字段：
 *   name        技能名（唯一，用于去重）
 *   stage       'script'(文案) | 'image'(图片) | 'voice'(配音) | 'all'(通用)
 *   icon        显示图标
 *   description 一句话说明
 *   prompt      实际拼进 system prompt 的增强指引
 *   auto_apply  1=必用技能（生成时自动注入，无需手动勾选）；0=可选技能
 *   source      'builtin'（平台内置）
 *
 * 设计原则：
 *   - 必用技能（auto_apply=1）只保留「几乎对所有短视频都加分」的质量基线，
 *     避免过度干预用户创意：黄金3秒钩子、完播率节奏、电影级运镜、画风统一。
 *   - 其余为可选技能，用户按需在生成时勾选。
 */

export type BuiltinSkillStage = 'script' | 'image' | 'voice' | 'all'

export interface BuiltinSkill {
  name: string
  stage: BuiltinSkillStage
  icon: string
  auto_apply: 0 | 1
  source: 'builtin'
  description: string
  prompt: string
}

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  // ============ 文案 / 脚本类（script）============
  {
    name: '黄金3秒钩子', stage: 'script', icon: '🎣', auto_apply: 1, source: 'builtin',
    description: '开头3秒强钩子，抓住注意力防划走',
    prompt: '第一个分镜（开头0-3秒）必须是强钩子，用以下任一手法瞬间抓住观众：制造悬念、抛出反常识结论、提出戳痛点的问题、给出惊人数据或反差画面。开头第一句话不要铺垫、不要自我介绍，直接进入最抓人的信息点，让人本能地停下来想看下去。',
  },
  {
    name: '完播率节奏', stage: 'script', icon: '⚡', auto_apply: 1, source: 'builtin',
    description: '紧凑节奏与悬念钩，提升完播率',
    prompt: '全片节奏紧凑，信息密度高，杜绝任何拖沓和废话。每个分镜结尾都埋一个「继续看下去的理由」（未解的悬念、下一步反转的预告、递进的情绪）。中段设置至少一个小高潮或反转，避免观众中途划走。整体遵循「钩子→铺垫→冲突/高潮→反转→落点」的短视频叙事节奏。',
  },
  {
    name: '口语化改写', stage: 'script', icon: '💬', auto_apply: 0, source: 'builtin',
    description: '把书面语改成自然口播，适合朗读',
    prompt: '所有对白/旁白用自然口语表达，像和朋友面对面聊天一样。避免书面语、长难句和生硬的连接词，多用短句、口头禅、语气词（"其实""说白了""你知道吗"）。朗读起来要顺口、亲切、有呼吸感，符合真人口播习惯。',
  },
  {
    name: '情绪感染力', stage: 'script', icon: '❤️', auto_apply: 0, source: 'builtin',
    description: '强化情绪曲线，引发共鸣与转发',
    prompt: '文案要有清晰的情绪曲线：铺垫→升温→高潮→收尾落点。善用具体细节、画面感和共情场景引发观众共鸣（而非空喊口号）。结尾给观众一个明确的情绪落点或行动号召（点赞/收藏/评论区互动），制造「想转发给某个人」的冲动。',
  },
  {
    name: '爆款标题', stage: 'script', icon: '🔥', auto_apply: 0, source: 'builtin',
    description: '生成多个高点击率标题候选',
    prompt: '在 title 字段给出最强标题，并在 summary 里附带 2-3 个备选标题。标题运用爆款公式：数字化（"3个方法"）、悬念缺口（"没想到最后…"）、身份代入（"做XX的人一定要看"）、利益前置（"看完省下XX"）。控制在20字内，前6个字最吸睛，自然融入热门搜索词。',
  },
  {
    name: 'SEO关键词植入', stage: 'script', icon: '🔍', auto_apply: 0, source: 'builtin',
    description: '自然植入热门关键词提升搜索曝光',
    prompt: '在标题和文案中自然植入与主题相关的热门搜索关键词和话题标签，兼顾可读性与平台推荐曝光。关键词不堆砌、不生硬，融入语句中。可在 summary 末尾附 3-5 个推荐话题标签（#形式）。',
  },
  {
    name: '平台违禁词规避', stage: 'script', icon: '🛡️', auto_apply: 0, source: 'builtin',
    description: '规避抖音/平台违禁敏感词，防限流',
    prompt: '严格规避短视频平台的违禁词与敏感表达，防止限流：不用绝对化用语（"最""第一""国家级"）、不用诱导互动的违规话术（"点击下方""加微信"）、不涉及医疗功效承诺、不用低俗或擦边表述、不出现竞品贬低或虚假宣传。如需表达强烈语气，用合规的替代说法。',
  },
  {
    name: '反转结构', stage: 'script', icon: '🔄', auto_apply: 0, source: 'builtin',
    description: '先抑后扬/预期违背，制造记忆点',
    prompt: '采用「预期违背」的反转结构：先建立一个观众习以为常的预期或常识，在中段或结尾用一个出乎意料的事实、视角或结果打破它。反转点要在情理之中、意料之外，制造强记忆点和讨论欲，适合做评论区互动话题。',
  },

  // ============ 画面 / 图片类（image）============
  {
    name: '电影级运镜', stage: 'image', icon: '🎬', auto_apply: 1, source: 'builtin',
    description: '为画面注入电影感构图、光影与镜头语言',
    prompt: 'cinematic composition, professional camera language (close-up / wide-angle / low-angle / over-the-shoulder as fits the scene), dramatic lighting (golden hour, rembrandt lighting, rim light, volumetric light), shallow depth of field, rule-of-thirds or symmetrical framing, film grain, high dynamic range, movie-still quality',
  },
  {
    name: '画风统一锁定', stage: 'image', icon: '🎨', auto_apply: 1, source: 'builtin',
    description: '统一色调质感，跨分镜画风连贯',
    prompt: 'maintain consistent art style, unified color grading and palette across all shots, coherent lighting mood, same rendering medium and texture quality, no style drift between scenes, cohesive visual identity',
  },
  {
    name: '高级感配色', stage: 'image', icon: '🌈', auto_apply: 0, source: 'builtin',
    description: '低饱和高级色系，避免廉价感',
    prompt: 'premium aesthetic, low-saturation Morandi / muted color palette or a single dominant tone, refined texture, elegant and tasteful, avoid cluttered or garish colors, designer-grade visual harmony',
  },
  {
    name: '竖屏构图优化', stage: 'image', icon: '📱', auto_apply: 0, source: 'builtin',
    description: '9:16竖屏主体居中，适配手机全屏',
    prompt: 'optimized for 9:16 vertical short-video format, main subject centered and prominent, key elements within the safe zone (avoid top/bottom UI overlap areas), strong focal point readable on a phone screen, mobile-first composition',
  },
  {
    name: '高清写实质感', stage: 'image', icon: '✨', auto_apply: 0, source: 'builtin',
    description: '8K超清细节，真实材质光影',
    prompt: 'ultra-detailed, 8K resolution, photorealistic textures, realistic material rendering, sharp focus, natural skin and surface detail, physically based lighting, no blur, no artifacts, professional photography quality',
  },
  {
    name: '吸睛封面构图', stage: 'image', icon: '🖼️', auto_apply: 0, source: 'builtin',
    description: '强对比大主体，适合做视频封面',
    prompt: 'eye-catching thumbnail composition, bold large subject, high contrast, clear focal point, expressive emotion or dramatic moment, leaves clean space for title text overlay, scroll-stopping visual impact',
  },

  // ============ 配音 / 语音类（voice）============
  {
    name: '口播节奏感', stage: 'voice', icon: '🎙️', auto_apply: 0, source: 'builtin',
    description: '断句清晰、轻重得当的口播语气',
    prompt: '配音文本要适配口播节奏：在关键信息前适当停顿制造强调，重点词加重语气，句子长短交错避免单调。去掉拗口的连续长句，改成可一口气读完的短句，让语音听感自然、有重音、有呼吸停顿。',
  },
  {
    name: '情绪化配音脚本', stage: 'voice', icon: '🎭', auto_apply: 0, source: 'builtin',
    description: '随剧情起伏调整语气情绪',
    prompt: '配音文本随剧情情绪起伏：开头有亲和力地拉近距离，冲突段加快语速、加强情绪张力，高潮段饱满有感染力，结尾收回到沉稳或温暖的落点。让旁白不是平铺直叙地念稿，而是有表演感的讲述。',
  },
]
