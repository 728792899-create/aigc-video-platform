/**
 * AI 文案/剧本生成服务
 *
 * 升级方案 v3：内部改为走统一 LLM 适配器（services/providers/llmProvider），
 * 支持按阶段路由（stageModels.script）+ 调用时显式指定 provider/model。
 *
 * 向后兼容：
 *   - 函数名仍叫 generateScript，签名 (theme, duration, style, override?) 保持兼容；
 *   - 未配 stageModels.script 时回退到 deepseek（读旧的 deepseek.* 配置），行为与改造前一致。
 */
const config = require('./config');
const llm = require('./providers/llmProvider');

function isDemoMode() {
  return process.env.DEMO_MODE === '1' || process.env.DEMO_MODE === 'true';
}

function demoScript(theme, duration = '45-60', style = '写实', detailLevel = 'standard') {
  const cleanTheme = String(theme || 'AI 创作工作流').trim() || 'AI 创作工作流';
  const durationInfo = parseDurationRange(duration);
  const timing = buildTimingPlan(durationInfo, detailLevel);
  const sceneCount = 4;
  const baseDuration = Math.max(8, Math.round(durationInfo.target / sceneCount));
  const demoDurations = Array.from({ length: sceneCount }, (_, index) => {
    if (index === sceneCount - 1) return Math.max(5, durationInfo.target - baseDuration * (sceneCount - 1));
    return baseDuration;
  });
  return {
    title: `${cleanTheme}｜Demo 短片`,
    summary: `围绕「${cleanTheme}」展示从灵感到成片的 AIGC 创作流程，目标时长约 ${durationInfo.target} 秒。`,
    total_duration: demoDurations.reduce((sum, item) => sum + item, 0),
    visual_anchor: 'clean modern studio, young creator operating an AI video workstation, cinematic lighting, consistent character design, realistic product demo style',
    story_bible: {
      worldview: '本地优先的 AI 创作工作台，创作者把零散想法逐步变成可预览短片。',
      mainline: '输入主题、拆分分镜、生成素材、配音字幕、预览成片。',
      timeline: ['创作者打开工作台', 'AI 生成脚本与分镜', '素材被逐步补齐', '短片进入预览'],
      open_threads: ['后续可接入真实模型和队列系统'],
      locked_facts: ['这是 demo 模式，不调用真实付费模型'],
      relationships: ['创作者与 AI 工作台协作完成短视频'],
      scene_rules: `画面保持${style || '写实'}风格，信息清晰，节奏紧凑。`,
    },
    characters: [
      {
        name: '创作者',
        role: '主角',
        age: '青年',
        gender: '未限定',
        face: '专注、自然、有亲和力',
        hair: '简洁日常发型',
        clothing: '浅色衬衫或工作外套',
        signature_props: '笔记本电脑、AI 工作台界面',
        personality: '理性、好奇、重视效率',
        voice: '清晰自然的中文旁白',
        prompt_anchor: 'a focused young creator at a clean AI video workstation',
        negative_constraints: 'do not change identity, keep a consistent modern studio style',
        is_primary: true,
      },
    ],
    storyboards: [
      {
        scene_number: 1,
        description: `创作者在整洁的桌面前输入主题「${cleanTheme}」，屏幕上出现脚本、分镜、素材三个步骤的工作流。`,
        dialog: `一个想法不应该停在聊天框里。这个 demo 展示如何把「${cleanTheme}」拆成可编辑、可回退、可预览的短视频流程。`,
        duration: demoDurations[0],
        characters_in_scene: [{ name: '创作者', role: '主角', action: '输入主题', emotion: '专注', location: '工作台前', state_note: '主题已提交' }],
        continuity_notes: '开场建立产品目标和工作流入口。',
        scene_state_before: '只有一个创作主题。',
        scene_state_after: '系统开始生成脚本和分镜。',
      },
      {
        scene_number: 2,
        description: '界面切换到分镜列表，每个分镜卡片依次出现画面描述、旁白文本、时长和素材状态。',
        dialog: '我把生成过程拆成脚本、分镜、图片、配音和合成几个阶段。这样任何一步失败，都可以单独重试，而不是整条链路从头再来。',
        duration: demoDurations[1],
        characters_in_scene: [{ name: '创作者', role: '主角', action: '检查分镜卡片', emotion: '冷静', location: '屏幕前', state_note: '分镜结构稳定' }],
        continuity_notes: '承接主题输入，展示工程拆分思路。',
        scene_state_before: '脚本刚生成。',
        scene_state_after: '分镜进入素材生成。',
      },
      {
        scene_number: 3,
        description: '素材面板中显示占位图、配音波形和字幕预览，失败提示以可理解的方式出现在任务进度里。',
        dialog: 'Demo 模式不会依赖真实 API Key。图片、配音和异常状态都会用本地兜底结果表达，让面试官先看到完整闭环。',
        duration: demoDurations[2],
        characters_in_scene: [{ name: '创作者', role: '主角', action: '查看素材预览', emotion: '确认', location: '工作台前', state_note: '素材已可预览' }],
        continuity_notes: '解释 mock/demo 价值。',
        scene_state_before: '分镜等待素材。',
        scene_state_after: '素材具备预览条件。',
      },
      {
        scene_number: 4,
        description: '最后进入视频预览页，时间线、字幕和导出按钮清晰展示，旁边显示当前项目仍是本地 MVP。',
        dialog: '这个项目目前是本地 MVP，重点验证 AIGC 视频生产链路。下一步会补任务队列、生成记录持久化和更严格的错误恢复。',
        duration: demoDurations[3],
        characters_in_scene: [{ name: '创作者', role: '主角', action: '播放预览视频', emotion: '平稳自信', location: '预览页', state_note: '形成可讲述结果' }],
        continuity_notes: '收束到边界与下一步。',
        scene_state_before: '素材已生成。',
        scene_state_after: '完成可演示短片闭环。',
      },
    ],
    _demo: { mode: true, requested_duration: duration, requested_style: style, timing },
  };
}

function parseDurationRange(duration) {
  const nums = String(duration || '')
    .match(/\d+(\.\d+)?/g)
    ?.map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0) || [];
  if (!nums.length) return { min: 60, max: 180, target: 120 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, target: Math.round((min + max) / 2) };
}

const LONG_NARRATION_CPS = {
  concise: 3.5,
  standard: 4.25,
  rich: 5.1,
};

function narrationCps(detailLevel = 'standard') {
  return LONG_NARRATION_CPS[detailLevel] || LONG_NARRATION_CPS.standard;
}

function countNarrationChars(text) {
  return String(text || '')
    .replace(/(^|[\n。！？；.!?;])\s*[（(【[][^）)】\]\n]{1,12}[）)】\]][:：]?\s*/g, '$1')
    .replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '')
    .replace(/[\s"'“”‘’《》〈〉「」『』【】（）()\[\]{}、，。！？；：,.!?;:—…·-]/g, '')
    .length;
}

function estimateNarrationSeconds(text, detailLevel = 'standard') {
  return countNarrationChars(text) / narrationCps(detailLevel);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function longSceneSeconds(durationInfo) {
  const target = Number(durationInfo?.target || 600);
  if (target >= 600) return 30;
  return 24;
}

function longChapterCount(targetSec) {
  return Math.max(2, Math.ceil(targetSec / 300));
}

function splitDuration(totalSec, count) {
  const base = Math.floor(totalSec / count);
  const chunks = Array.from({ length: count }, () => base);
  let rest = totalSec - base * count;
  for (let i = 0; i < chunks.length && rest > 0; i++, rest--) chunks[i] += 1;
  return chunks;
}

function defaultLongChapters(theme, durationInfo) {
  const cleanTheme = String(theme || '长视频主题').trim() || '长视频主题';
  const targetSec = Math.max(600, Math.round(durationInfo?.target || 600));
  const count = longChapterCount(targetSec);
  const chapterSeconds = splitDuration(targetSec, count);
  const chapterAngles = [
    ['问题建立', '先把观众为什么要看下去说清楚'],
    ['背景与动机', '解释这个主题背后的真实场景和核心矛盾'],
    ['关键案例', '用一个具体案例把抽象问题落到画面和行动里'],
    ['方法拆解', '把可复用的方法一步一步拆开'],
    ['细节验证', '说明哪些细节会影响结果，哪些只是表面热闹'],
    ['行动建议', '把前面的判断整理成可执行步骤'],
    ['风险边界', '讲清楚哪些地方还不能承诺，避免误导观众'],
    ['总结复盘', '回到主题，给观众留下清楚的结论和下一步'],
  ];
  return chapterSeconds.map((target_duration_sec, index) => {
    const angle = index === chapterSeconds.length - 1
      ? chapterAngles[chapterAngles.length - 1]
      : chapterAngles[index % (chapterAngles.length - 1)];
    return {
      chapter_index: index + 1,
      title: `第 ${index + 1} 章：${angle[0]}`,
      summary: `围绕「${cleanTheme}」${angle[1]}，本章用自然旁白推进，不用空镜头硬撑时长。`,
      target_duration_sec,
    };
  });
}

function longSceneBeats(index, total) {
  if (index === 1) return { key: 'opening', label: '章节开场', visual: '稳定开场镜头，先建立本章要解决的问题和观看动机' };
  if (index === total) return { key: 'summary', label: '章节小结', visual: '收束镜头，把本章结论落到下一章或下一步行动' };
  const beats = [
    { key: 'context', label: '背景解释', visual: '用环境、人物或屏幕信息呈现问题发生的真实语境' },
    { key: 'case', label: '案例展开', visual: '切入一个具体例子，让观众看到问题如何发生' },
    { key: 'detail', label: '细节放大', visual: '近景展示一个容易被忽视但会影响结果的细节' },
    { key: 'contrast', label: '对比说明', visual: '用前后对比或左右对照呈现认知变化' },
    { key: 'method', label: '方法拆解', visual: '把操作步骤、判断顺序或工作流清楚铺开' },
    { key: 'bridge', label: '过渡承接', visual: '用平稳转场承接上一点，并自然引出下一点' },
  ];
  return beats[(index - 2) % beats.length];
}

function longSceneExpansionSentences(theme, chapter, beat, localIndex) {
  const cleanTheme = String(theme || '这个主题').trim() || '这个主题';
  return [
    `放在「${cleanTheme}」这个主题里看，真正重要的不是把概念说得多满，而是让观众知道它和自己看到的画面、做出的判断有什么关系。`,
    `所以这一段不急着抛结论，而是先把原因、现象和后果放在同一个画面里，让信息自然往前走。`,
    `如果只是把时间拉长，观众很快会感觉内容在原地打转；但把细节讲透，长视频才会有继续看下去的价值。`,
    `这里可以让画面配合旁白慢慢推进：先给出场景，再给出动作，最后给出一个可以被记住的判断。`,
    `这一镜承担的任务，是把上一段留下的问题接住，同时为下一段的方法或案例铺出一个顺滑的入口。`,
    `观众不需要听到更多口号，他们需要看到一个具体判断如何形成，以及这个判断为什么值得相信。`,
    `因此旁白要保持稳定节奏，每句话都服务于一个信息点，避免为了凑时长重复同一句意思。`,
    `当这个细节被讲清楚后，后面的章节就能继续加深，而不是突然跳到另一个没有铺垫的话题。`,
    `第 ${localIndex} 个镜头可以把节奏稍微放慢，让观众有时间消化，同时保持画面仍在提供新信息。`,
    `这也是长视频和短视频最大的不同：它不靠密集刺激撑住注意力，而是靠连续、可信、层层递进的解释。`,
    `本章的重点始终围绕「${chapter.title.replace(/^第\s*\d+\s*章[:：]\s*/, '')}」，所以每个镜头都要回应同一个核心问题。`,
    `只要这一点成立，后面的配图、配音和字幕就不是机械拼接，而是在同一条叙事线上继续往前走。`,
  ];
}

function fitDialogToTarget(seed, targetChars, theme, chapter, beat, localIndex) {
  let dialog = String(seed || '').trim();
  const sentences = longSceneExpansionSentences(theme, chapter, beat, localIndex);
  let guard = 0;
  while (countNarrationChars(dialog) < targetChars && guard < sentences.length + 4) {
    const sentence = sentences[(localIndex + guard) % sentences.length];
    if (!dialog.includes(sentence)) dialog += `${dialog ? '' : ''}${sentence}`;
    guard++;
  }
  return dialog;
}

function fallbackLongDialog(theme, chapter, beat, localIndex, sceneCount, targetSeconds, detailLevel) {
  const cleanTheme = String(theme || '这个主题').trim() || '这个主题';
  const chapterName = chapter.title.replace(/^第\s*\d+\s*章[:：]\s*/, '');
  const targetChars = Math.round(targetSeconds * narrationCps(detailLevel) * 0.96);
  let seed = '';
  if (beat.key === 'opening') {
    seed = `这一章先从「${chapterName}」讲起。关于「${cleanTheme}」，很多人第一眼会看到一个结果，却忽略结果前面发生了什么。我们先把问题放回真实场景里：观众为什么会被吸引，信息为什么会断裂，创作者又为什么需要一个更稳定的判断顺序。`;
  } else if (beat.key === 'summary') {
    seed = `到这里，本章已经把「${chapterName}」里的关键线索整理清楚。它不是一个孤立结论，而是后面继续展开的基础。下一步我们要把这些判断放进更具体的场景里，看它怎样影响画面、节奏、素材选择和最终成片的可信度。`;
  } else if (beat.key === 'case') {
    seed = `可以想象一个具体场景：用户打开项目，只给出「${cleanTheme}」这样一个方向。系统如果只给几句泛泛的文案，视频很快就会显得空。真正有效的做法，是把主题拆成场景、行动、冲突和结果，让每一步都能被画面承接。`;
  } else if (beat.key === 'method') {
    seed = `这一段把方法拆开看。第一步是确认本章只解决一个问题，第二步是把这个问题变成可拍摄的画面，第三步才是安排旁白和字幕。这样生成出来的内容，不会只是把同一句话换个说法重复，而是每个镜头都有自己的任务。`;
  } else if (beat.key === 'contrast') {
    seed = `这里做一个对比会更清楚。短视频可以依靠快速切换制造节奏，但长视频如果每十几秒都没有新信息，观众会立刻感到拖沓。相反，只要每个镜头都补充一个具体细节，即使画面是静图运镜，内容也会持续向前。`;
  } else if (beat.key === 'detail') {
    seed = `这一镜放大一个细节：旁白的长度必须和画面停留时间匹配。只有 duration 变长，而文字没有变多，导出时就会出现明显停顿。更合理的方式，是先写够能自然朗读的内容，再由真实音频时长反推画面节奏。`;
  } else if (beat.key === 'bridge') {
    seed = `这段起到承上启下的作用。前面我们已经把问题说清楚，接下来要把它放进更可执行的流程里。观众需要听到一个平稳过渡：为什么刚才的判断成立，以及下一步为什么要进入新的案例或方法。`;
  } else {
    seed = `回到「${cleanTheme}」本身，这一镜继续补充本章的核心信息。它需要提供新的判断，而不是重复上一镜的句式。画面可以保持稳定，旁白则负责把原因、影响和下一步讲得更完整。`;
  }
  return fitDialogToTarget(seed, targetChars, theme, chapter, beat, localIndex);
}

function fallbackLongScene(theme, chapter, localIndex, sceneCount, targetSeconds, style, detailLevel) {
  const beat = longSceneBeats(localIndex, sceneCount);
  const dialog = fallbackLongDialog(theme, chapter, beat, localIndex, sceneCount, targetSeconds, detailLevel);
  const estimatedSeconds = Math.round(estimateNarrationSeconds(dialog, detailLevel));
  return {
    scene_number: localIndex,
    chapter_index: chapter.chapter_index,
    chapter_title: chapter.title,
    description: `${chapter.title} · ${beat.label}。${beat.visual}。画面保持${style || '写实'}风格，构图稳定，适合静图运镜、字幕展示和自然旁白承接。`,
    dialog,
    duration: clamp(estimatedSeconds, 12, 45),
    characters_in_scene: [{ name: '讲述者', role: '旁白', action: beat.label, emotion: '稳定清晰', location: '主题场景', state_note: `${chapter.title}第 ${localIndex} 镜` }],
    continuity_notes: `${beat.label}，围绕本章主题自然推进，不用静默镜头硬撑时长。`,
    scene_state_before: localIndex === 1 ? `进入${chapter.title}` : '上一镜信息已铺垫',
    scene_state_after: localIndex === sceneCount ? `完成${chapter.title}` : '继续展开本章信息',
  };
}

function fallbackLongChapterStoryboards(theme, chapter, style, detailLevel) {
  const sceneSeconds = 30;
  const sceneCount = Math.max(8, Math.ceil((Number(chapter.target_duration_sec) || 300) / sceneSeconds));
  const durations = splitDuration(Number(chapter.target_duration_sec) || sceneSeconds * sceneCount, sceneCount);
  return durations.map((seconds, index) => fallbackLongScene(theme, chapter, index + 1, sceneCount, seconds, style, detailLevel));
}

function longScriptScaffold(theme, duration = '3600-3600', style = '写实', detailLevel = 'standard', extraWarnings = []) {
  const cleanTheme = String(theme || '长视频主题').trim() || '长视频主题';
  const durationInfo = parseDurationRange(duration);
  const chapters = defaultLongChapters(cleanTheme, durationInfo);
  const storyboards = chapters.flatMap((chapter) => fallbackLongChapterStoryboards(cleanTheme, chapter, style, detailLevel));
  const result = {
    title: `${cleanTheme}｜长视频章节脚本`,
    summary: `围绕「${cleanTheme}」生成的旁白驱动长视频脚本，按章节展开，每个分镜都用足量台词支撑画面时长。`,
    long_video_mode: true,
    chapters,
    visual_anchor: `consistent ${style || 'realistic'} documentary explainer style, clear composition, stable narrator identity, cohesive color grading, long-form narration pacing`,
    story_bible: {
      worldview: `围绕「${cleanTheme}」展开的长视频内容结构。`,
      mainline: '按章节推进问题、背景、案例、方法和总结。',
      timeline: chapters.map((c) => c.title),
      open_threads: ['可继续逐章精修文案和素材'],
      locked_facts: ['长视频以旁白驱动，画面时长跟随真实配音'],
      relationships: ['讲述者与观众之间的信息传递关系'],
      scene_rules: `全片保持${style || '写实'}风格，长视频默认按章节分段生产。`,
    },
    characters: [{
      name: '讲述者',
      role: '旁白',
      age: '成年',
      gender: '未限定',
      face: '稳定、可信、自然',
      hair: '简洁自然',
      clothing: '适合主题的简洁服装',
      signature_props: '主题相关道具或屏幕内容',
      personality: '清晰、耐心、有条理',
      voice: '自然中文旁白',
      prompt_anchor: 'a calm professional narrator, consistent identity, documentary explainer style',
      negative_constraints: 'do not change identity across chapters',
      is_primary: true,
    }],
    storyboards,
    _long_scaffold: { mode: true, chapter_count: chapters.length, target_duration_sec: durationInfo.target },
  };
  return enrichLongScriptResult(result, durationInfo, detailLevel, extraWarnings);
}

/** 取剧本阶段的路由（provider + model），带三级回退 */
function resolveScriptModel(override) {
  const stage = config.get('stageModels.script') || {};
  const provider = (override && override.provider) || stage.provider || 'deepseek';
  const model = (override && override.model) || stage.model || (provider === 'deepseek' ? (config.get('deepseek.model') || 'deepseek-chat') : undefined);
  return { provider, model };
}

// dialog 丰富度档位：控制每个分镜对白/旁白的篇幅与细腻度
const DETAIL_LEVELS = {
  concise: { label: '精简', density: [2.5, 3.5], words: '每个分镜的 dialog 控制在 15-25 字，简洁有力，突出关键信息' },
  standard: { label: '标准', density: [3.5, 5], words: '每个分镜的 dialog 控制在 30-50 字，语言自然流畅，有完整的表达' },
  rich: { label: '丰富', density: [5, 6.5], words: '每个分镜的 dialog 控制在 50-90 字，内容充实、有情绪和细节、有画面感，像专业口播稿/剧情对白一样打动人' },
};

function estimateSceneSeconds(durationInfo) {
  const target = Number(durationInfo?.target || 120);
  if (target >= 600) return longSceneSeconds(durationInfo);
  if (target >= 150) return 12;
  if (target >= 90) return 10;
  return 8;
}

function roundToFive(value) {
  return Math.max(5, Math.round(value / 5) * 5);
}

function dialogWordRange(detailLevel, durationInfo) {
  const detail = DETAIL_LEVELS[detailLevel] || DETAIL_LEVELS.standard;
  const sceneSeconds = estimateSceneSeconds(durationInfo);
  return [
    roundToFive(detail.density[0] * sceneSeconds),
    roundToFive(detail.density[1] * sceneSeconds),
  ];
}

function buildTimingPlan(durationInfo, detailLevel = 'standard') {
  const info = durationInfo || parseDurationRange('150-210');
  const sceneSeconds = estimateSceneSeconds(info);
  const sceneCount = Math.max(3, Math.round((info.target || 120) / sceneSeconds));
  const sceneCountMin = Math.max(3, Math.floor(sceneCount * 0.85));
  const sceneCountMax = Math.max(sceneCountMin, Math.ceil(sceneCount * 1.15));
  const [wordMin, wordMax] = dialogWordRange(detailLevel, info);
  return {
    sceneSeconds,
    sceneCountMin,
    sceneCountMax,
    wordMin,
    wordMax,
    sceneDurationText: `${Math.max(3, sceneSeconds - 2)}-${sceneSeconds + 2}秒`,
  };
}

function detailInstruction(detailLevel, durationInfo) {
  const detail = DETAIL_LEVELS[detailLevel] || DETAIL_LEVELS.standard;
  const timing = buildTimingPlan(durationInfo, detailLevel);
  return `采用「${detail.label}」台词密度，每个分镜 dialog 建议约 ${timing.wordMin}-${timing.wordMax} 字，按 ${timing.sceneDurationText} 的自然中文朗读节奏估算；避免为了凑字数重复空话。`;
}

function totalStoryboardDuration(result) {
  return (result?.storyboards || []).reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
}

function buildChaptersFromStoryboards(storyboards = []) {
  const groups = new Map();
  for (const item of storyboards) {
    const index = Number(item.chapter_index || item.chapter || 1) || 1;
    if (!groups.has(index)) {
      groups.set(index, {
        chapter_index: index,
        title: item.chapter_title || `第 ${index} 章`,
        summary: '',
        target_duration_sec: 0,
      });
    }
    const group = groups.get(index);
    group.target_duration_sec += Number(item.duration) || 0;
    if (!group.title && item.chapter_title) group.title = item.chapter_title;
  }
  return [...groups.values()]
    .sort((a, b) => a.chapter_index - b.chapter_index)
    .map((chapter) => ({ ...chapter, target_duration_sec: Math.round(chapter.target_duration_sec) }));
}

function hasChapterStructure(result) {
  const storyboards = result?.storyboards || [];
  if (!storyboards.length) return false;
  return storyboards.some((item) => Number(item.chapter_index || item.chapter) > 0 && String(item.chapter_title || '').trim());
}

function dialogSignature(text) {
  return String(text || '')
    .replace(/[「」『』“”"'，。！？；：,.!?;:\s]/g, '')
    .slice(0, 36);
}

function hasConsecutiveRepeatedDialog(storyboards = []) {
  for (let i = 0; i <= storyboards.length - 3; i++) {
    const a = dialogSignature(storyboards[i]?.dialog);
    const b = dialogSignature(storyboards[i + 1]?.dialog);
    const c = dialogSignature(storyboards[i + 2]?.dialog);
    if (a && a === b && b === c) return true;
  }
  return false;
}

function narrationStatsForStoryboards(storyboards = [], durationInfo, detailLevel = 'standard') {
  const totalDuration = storyboards.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  const charCount = storyboards.reduce((sum, item) => sum + countNarrationChars(item.dialog || item.subtitle_text || ''), 0);
  const estimatedNarrationSec = charCount / narrationCps(detailLevel);
  const target = Math.round(durationInfo?.target || totalDuration || 0);
  const min = Math.round(durationInfo?.min || 0);
  const max = Math.round(durationInfo?.max || 0);
  return {
    char_count: charCount,
    chars_per_second: narrationCps(detailLevel),
    storyboard_duration_sec: Math.round(totalDuration),
    estimated_narration_sec: Math.round(estimatedNarrationSec),
    target_duration_sec: target,
    target_min_sec: min,
    target_max_sec: max,
    narration_coverage: target ? Math.round((estimatedNarrationSec / target) * 1000) / 1000 : 0,
    min_coverage: min ? Math.round((estimatedNarrationSec / min) * 1000) / 1000 : 0,
  };
}

function normalizeLongStoryboards(storyboards = [], detailLevel = 'standard') {
  return storyboards.map((item, index) => {
    const chapterIndex = Number(item.chapter_index || item.chapter || 1) || 1;
    const dialog = String(item.dialog || item.subtitle_text || '').trim();
    const estimated = dialog ? Math.round(estimateNarrationSeconds(dialog, detailLevel)) : Number(item.duration) || 20;
    return {
      ...item,
      scene_number: index + 1,
      chapter_index: chapterIndex,
      chapter_title: item.chapter_title || `第 ${chapterIndex} 章`,
      description: String(item.description || item.prompt || '').trim(),
      dialog,
      duration: clamp(estimated, 8, 60),
    };
  });
}

function enrichLongScriptResult(result, durationInfo, detailLevel = 'standard', extraWarnings = []) {
  const storyboards = normalizeLongStoryboards(result?.storyboards || [], detailLevel);
  const stats = narrationStatsForStoryboards(storyboards, durationInfo, detailLevel);
  const warnings = [...(result?.quality_warnings || result?._warnings || []), ...extraWarnings].filter(Boolean);
  if (stats.estimated_narration_sec < Math.round((durationInfo?.min || 0) * 0.85)) {
    warnings.push(`预计旁白约 ${stats.estimated_narration_sec} 秒，低于目标下限 ${Math.round(durationInfo.min)} 秒，导出后可能停顿过多。`);
  }
  if (stats.storyboard_duration_sec < Math.round((durationInfo?.min || 0) * 0.85)) {
    warnings.push(`分镜总时长约 ${stats.storyboard_duration_sec} 秒，低于目标范围。`);
  }
  if (durationInfo?.max && stats.estimated_narration_sec > Math.round(durationInfo.max * 1.08)) {
    warnings.push(`预计旁白约 ${stats.estimated_narration_sec} 秒，高于目标上限 ${Math.round(durationInfo.max)} 秒，内容需要压缩。`);
  }
  if (hasConsecutiveRepeatedDialog(storyboards)) {
    warnings.push('检测到连续分镜对白结构过于重复，已建议重新生成或扩写。');
  }
  const chapters = result?.chapters?.length ? result.chapters : buildChaptersFromStoryboards(storyboards);
  return {
    ...result,
    total_duration: stats.storyboard_duration_sec,
    long_video_mode: true,
    chapters,
    storyboards,
    narration_stats: stats,
    quality_warnings: [...new Set(warnings)],
  };
}

function validateLongScriptResult(result, theme, duration, style, detailLevel, durationInfo) {
  if (!result) return result;
  if (!durationInfo || durationInfo.max < 600) return result;

  const enriched = enrichLongScriptResult(result, durationInfo, detailLevel);
  const minAcceptable = Math.max(1, durationInfo.min * 0.85);
  const missingChapterFields = !hasChapterStructure(enriched);
  const narrationTooShort = enriched.narration_stats.estimated_narration_sec < minAcceptable;
  const narrationTooLong = durationInfo.max && enriched.narration_stats.estimated_narration_sec > durationInfo.max * 1.08;
  const durationTooShort = enriched.narration_stats.storyboard_duration_sec < minAcceptable;
  const durationTooLong = durationInfo.max && enriched.narration_stats.storyboard_duration_sec > durationInfo.max * 1.08;
  if (!missingChapterFields && !narrationTooShort && !narrationTooLong && !durationTooShort && !durationTooLong && !hasConsecutiveRepeatedDialog(enriched.storyboards)) {
    return enriched;
  }

  return longScriptScaffold(theme, duration, style, detailLevel, [
    `长视频生成结果未达到旁白时长或章节质量要求，已回退为旁白驱动章节脚本。原始预计旁白约 ${enriched.narration_stats.estimated_narration_sec} 秒，目标范围约 ${Math.round(durationInfo.min)}-${Math.round(durationInfo.max)} 秒。`,
  ]);
}

function parseJsonObject(content) {
  try { return JSON.parse(content); } catch {}
  const m = String(content || '').match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

async function generateLongOutline(theme, durationInfo, style, override, provider, model) {
  const fallback = defaultLongChapters(theme, durationInfo);
  if (isDemoMode()) return fallback;
  const prompt = `请为一个旁白驱动的长视频生成章节大纲。
主题：${theme}
目标总时长：约 ${durationInfo.target} 秒
章节数量：${fallback.length}
画面风格：${style}

要求：
1. 每章 3-5 分钟左右，章节之间自然递进。
2. 不要写空泛标题，要能指导后续分镜和旁白。
3. 返回严格 JSON：{"chapters":[{"title":"第 1 章：...","summary":"..."}]}`;
  try {
    const content = await llm.chat({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是一位长视频内容策划，擅长把主题拆成可讲、可看、可分段生成的章节结构。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.65,
      maxTokens: 1600,
      jsonMode: true,
    });
    const parsed = parseJsonObject(content);
    const incoming = Array.isArray(parsed?.chapters) ? parsed.chapters : [];
    if (!incoming.length) return fallback;
    return fallback.map((chapter, index) => ({
      ...chapter,
      title: incoming[index]?.title || chapter.title,
      summary: incoming[index]?.summary || chapter.summary,
    }));
  } catch {
    return fallback;
  }
}

async function generateLongChapter(theme, chapter, style, detailLevel, override, provider, model) {
  const targetSec = Math.round(Number(chapter.target_duration_sec) || 300);
  const sceneSeconds = 30;
  const sceneCount = Math.max(8, Math.ceil(targetSec / sceneSeconds));
  const targetCharsPerScene = Math.round((targetSec / sceneCount) * narrationCps(detailLevel) * 0.95);
  const skillPrompt = override?.skillPrompt ? `\n额外创作指引：${override.skillPrompt}` : '';
  const continuityContext = override?.continuityContext ? `\n连续性上下文：${override.continuityContext}` : '';
  const prompt = `请为长视频的一个章节生成分镜脚本。
全片主题：${theme}
当前章节：${chapter.title}
章节摘要：${chapter.summary}
章节目标时长：约 ${targetSec} 秒
建议分镜数：${sceneCount} 个
每镜旁白目标：约 ${targetCharsPerScene} 个中文字符，必须能自然朗读 ${Math.round(targetSec / sceneCount)} 秒左右
画面风格：${style}

要求：
1. 旁白为主，每个分镜 dialog 都要有足量内容，不允许只写一句短句后靠 duration 硬撑。
2. 每个分镜必须提供新的信息点，避免连续三镜使用同样句式。
3. 章节开头要自然引入，章节结尾要小结并承接下一段。
4. duration 请按 dialog 的自然朗读时长估算，通常 18-30 秒。
5. 返回严格 JSON：{"storyboards":[{"description":"","dialog":"","duration":24,"chapter_index":${chapter.chapter_index},"chapter_title":"${chapter.title}","characters_in_scene":[],"continuity_notes":"","scene_state_before":"","scene_state_after":""}]}${skillPrompt}${continuityContext}`;

  if (isDemoMode()) return fallbackLongChapterStoryboards(theme, chapter, style, detailLevel);
  try {
    const content = await llm.chat({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是一位长视频编剧。重点不是堆分镜数量，而是让每镜旁白自然、足量、有新信息，并能支撑真实配音时长。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.78,
      maxTokens: 6500,
      jsonMode: true,
    });
    const parsed = parseJsonObject(content);
    const storyboards = Array.isArray(parsed?.storyboards) ? parsed.storyboards : [];
    if (!storyboards.length) return fallbackLongChapterStoryboards(theme, chapter, style, detailLevel);
    const normalized = normalizeLongStoryboards(storyboards.map((item) => ({
      ...item,
      chapter_index: chapter.chapter_index,
      chapter_title: chapter.title,
    })), detailLevel);
    const stats = narrationStatsForStoryboards(normalized, { min: targetSec, max: targetSec, target: targetSec }, detailLevel);
    if (stats.estimated_narration_sec < targetSec * 0.85 || hasConsecutiveRepeatedDialog(normalized)) {
      return fallbackLongChapterStoryboards(theme, chapter, style, detailLevel);
    }
    return normalized;
  } catch {
    return fallbackLongChapterStoryboards(theme, chapter, style, detailLevel);
  }
}

async function generateLongScript(theme, duration, style, override, durationInfo, detailLevel) {
  const { provider, model } = resolveScriptModel(override);
  const chapters = await generateLongOutline(theme, durationInfo, style, override, provider, model);
  const storyboards = [];
  for (const chapter of chapters) {
    const chapterBoards = await generateLongChapter(theme, chapter, style, detailLevel, override, provider, model);
    storyboards.push(...chapterBoards);
  }
  const result = {
    title: `${String(theme || '长视频主题').trim() || '长视频主题'}｜长视频章节脚本`,
    summary: `按 ${chapters.length} 个章节生成的旁白驱动长视频脚本，分镜时长由对白自然朗读长度估算。`,
    long_video_mode: true,
    chapters,
    visual_anchor: `consistent ${style || 'realistic'} documentary explainer style, clear composition, stable narrator identity, cohesive color grading, long-form narration pacing`,
    story_bible: {
      worldview: `围绕「${theme}」展开的长视频内容结构。`,
      mainline: chapters.map((c) => c.title).join(' → '),
      timeline: chapters.map((c) => c.title),
      open_threads: ['可继续逐章精修文案和素材'],
      locked_facts: ['长视频以旁白驱动，画面时长跟随真实配音'],
      relationships: ['讲述者与观众之间的信息传递关系'],
      scene_rules: `全片保持${style || '写实'}风格，分镜必须由足量旁白支撑。`,
    },
    characters: [{
      name: '讲述者',
      role: '旁白',
      voice: '自然中文旁白',
      prompt_anchor: 'a calm professional narrator, consistent identity, documentary explainer style',
      negative_constraints: 'do not change identity across chapters',
      is_primary: true,
    }],
    storyboards,
  };
  return validateLongScriptResult(result, theme, duration, style, detailLevel, durationInfo);
}

function buildSystemPrompt(style, detailLevel = 'standard', skillPrompt = '', continuityContext = '', durationInfo = null) {
  const timing = buildTimingPlan(durationInfo, detailLevel);
  const detailText = detailInstruction(detailLevel, durationInfo);
  const skillBlock = skillPrompt && skillPrompt.trim()
    ? `\n\n【创作技能增强】请在创作时遵循以下额外指引：\n${skillPrompt.trim()}\n`
    : '';
  const continuityBlock = continuityContext && continuityContext.trim()
    ? `\n\n${continuityContext.trim()}\n`
    : '';
  return `你是一位专业的短视频编剧、分镜设计师和文案写手。用户会给你一个创作主题，你需要根据主题生成完整、可直接拍摄的短视频文案和分镜脚本。

要求：
1. 根据视频时长合理拆分分镜：建议生成 ${timing.sceneCountMin}-${timing.sceneCountMax} 个分镜，每个分镜约 ${timing.sceneDurationText}，总时长必须尽量落在用户给定范围内
2. 每个分镜包含：场景描述（description）、角色对白/旁白（dialog）、建议时长（duration，单位秒）
3. 场景描述要详细具体（环境、人物、动作、光线、氛围、镜头），适合直接作为AI绘图提示词
4. 对白/旁白要丰富且有感染力：${detailText} 要有信息量、节奏感和情绪起伏，符合口语表达习惯
5. 画面风格统一为：${style}
6. 【画风一致性关键】先产出一份全局视觉设定 visual_anchor，用一段英文绘图提示词描述：
   主角的固定外貌（性别/年龄/发型/发色/服装/显著特征）、统一的画面风格与媒介、
   统一的色调与光线氛围、统一的镜头质感。这份设定将被前置到每个分镜的绘图提示词，
   确保所有分镜里主角长相一致、画风连贯。各分镜 description 只描述"本镜的动作/场景变化"，
   不要重复或改变主角外貌设定。
7. 【人物一致性关键】必须返回 story_bible 和 characters。characters 是结构化角色库，包含固定外貌、服装、标志道具、性格、声音和 negative_constraints。
8. 每个分镜必须返回 characters_in_scene，引用 characters 里的角色 name，记录本镜角色动作、情绪、位置、服装变化和状态。不要在分镜里重新发明主角外貌。
9. 如果给定了系列连续性要求，必须承接上一集结尾、人物关系、时间线和禁改事实，不得自相矛盾。
10. 返回严格的JSON格式${skillBlock}${continuityBlock}

返回格式示例：
{
  "title": "视频标题",
  "summary": "剧情简介（50字内）",
  "total_duration": 120,
  "visual_anchor": "a young girl with long black ponytail, wearing red hoodie and jeans, warm cinematic lighting, soft pastel color palette, consistent anime style, shallow depth of field",
  "story_bible": {
    "worldview": "故事世界观",
    "mainline": "本系列主线",
    "timeline": ["已发生的重要事件"],
    "open_threads": ["未解决伏笔"],
    "locked_facts": ["禁止改写的人物/世界观事实"],
    "relationships": ["人物关系"],
    "scene_rules": "画面、场景和连续性规则"
  },
  "characters": [
    {
      "name": "主角姓名",
      "role": "主角",
      "age": "年龄段",
      "gender": "性别",
      "face": "固定脸部特征",
      "hair": "固定发型发色",
      "clothing": "默认服装",
      "signature_props": "标志道具",
      "personality": "性格",
      "voice": "声音气质",
      "prompt_anchor": "English drawing prompt for this character identity",
      "negative_constraints": "do not change face, hair, outfit, age, signature props",
      "is_primary": true
    }
  ],
  "storyboards": [
    {
      "scene_number": 1,
      "description": "详细的画面场景描述，包含环境、人物动作、光线、氛围等（不重复主角固定外貌）",
      "dialog": "丰富、有画面感、有情绪的旁白或对白文本",
      "duration": 5,
      "characters_in_scene": [
        { "name": "主角姓名", "role": "主角", "action": "本镜动作", "emotion": "情绪", "location": "位置", "state_note": "本镜结束状态" }
      ],
      "continuity_notes": "与上一镜/上一集衔接的说明",
      "scene_state_before": "本镜开始前状态",
      "scene_state_after": "本镜结束后状态"
    }
  ]
}`;
}

/**
 * 生成分镜脚本。
 * @param {string} theme 创作主题
 * @param {string} [duration] 目标时长区间
 * @param {string} [style] 画面风格
 * @param {object} [override] 可选 { provider, model } 覆盖阶段路由
 * @returns {Promise<object>} 解析后的脚本 JSON
 */
async function generateScript(theme, duration = '150-210', style = '写实', override = null) {
  const durationInfo = parseDurationRange(duration);
  const detailLevel = (override && override.detailLevel) || 'standard';
  if (durationInfo.max >= 600) {
    return generateLongScript(theme, duration, style, override || {}, durationInfo, detailLevel);
  }
  if (isDemoMode()) return demoScript(theme, duration, style, detailLevel);
  const { provider, model } = resolveScriptModel(override);
  const skillPrompt = (override && override.skillPrompt) || '';
  const continuityContext = (override && override.continuityContext) || '';
  const timing = buildTimingPlan(durationInfo, detailLevel);
  const systemPrompt = buildSystemPrompt(style, detailLevel, skillPrompt, continuityContext, durationInfo);
  const userPrompt = `创作主题：${theme}\n目标视频时长范围：${duration}秒（目标约 ${durationInfo.target} 秒）\n建议分镜数量：${timing.sceneCountMin}-${timing.sceneCountMax} 个\n建议单镜时长：${timing.sceneDurationText}\n画面风格：${style}\n\n请生成完整的分镜脚本，确保返回有效的JSON格式。`;

  const content = await llm.chat({
    provider,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    maxTokens: 4096,
    jsonMode: true,
  });

  try {
    return validateLongScriptResult(JSON.parse(content), theme, duration, style, detailLevel, durationInfo);
  } catch {
    // 容错：部分模型会用 ```json 包裹，剥掉再试
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { return validateLongScriptResult(JSON.parse(m[0]), theme, duration, style, detailLevel, durationInfo); } catch { /* fallthrough */ }
    }
    throw new Error('AI 返回的内容不是有效的 JSON 格式');
  }
}

/**
 * AI 扩写/改写单条台词，让 dialog 更丰富有画面感。
 * @param {string} dialog 原台词
 * @param {object} [opts] { style, detailLevel, skillPrompt, scene, override }
 * @returns {Promise<string>} 改写后的台词
 */
async function expandDialog(dialog, opts = {}) {
  if (isDemoMode()) {
    return `Demo 改写：${String(dialog || '').trim()}。这段内容会保留原意，并补充更清晰的画面目标和行动节奏。`;
  }
  const { style = '写实', detailLevel = 'rich', skillPrompt = '', scene = '', override = null } = opts;
  const { provider, model } = resolveScriptModel(override);
  const detail = DETAIL_LEVELS[detailLevel] || DETAIL_LEVELS.rich;
  const skillBlock = skillPrompt && skillPrompt.trim() ? `\n额外创作指引：${skillPrompt.trim()}` : '';
  const sysPrompt = `你是一位短视频文案写手。请把用户给的台词/旁白改写得更丰富、有感染力、有画面感。${detail.words}。保持原意和语言，符合「${style}」风格，口语自然，可直接朗读。${skillBlock}\n只返回改写后的台词文本，不要任何解释、标题或引号。`;
  const userPrompt = scene ? `画面场景：${scene}\n原台词：${dialog}` : `原台词：${dialog}`;
  const content = await llm.chat({
    provider, model,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.85,
    maxTokens: 512,
  });
  return String(content || '').trim().replace(/^["「『]|["」』]$/g, '');
}

/**
 * ✨ 主题 AI 优化（问题7）：把用户口语化的主题润色成更具画面感、更适合短视频脚本的描述。
 * 复用脚本阶段路由（默认走内置 DeepSeek key，零成本）。
 * @param {string} theme 原始主题
 * @param {object} [opts] { style, override }
 * @returns {Promise<string>} 优化后的主题描述
 */
async function optimizeTheme(theme, opts = {}) {
  if (isDemoMode()) {
    return `围绕「${String(theme || '').trim()}」制作一条结构清晰、画面统一、适合展示 AIGC 工作流闭环的短视频。`;
  }
  const { style = '', override = null } = opts;
  const { provider, model } = resolveScriptModel(override);
  const styleHint = style ? `目标画面风格：「${style}」，优化时可呼应该风格。` : '';
  const sysPrompt = `你是一位资深短视频策划。用户会给你一个口语化、可能很简短的创作主题，请把它优化成一句更具画面感、更适合作为短视频脚本起点的主题描述。
要求：
1. 保留用户的核心意图与题材，不要跑题、不要替换成别的主题
2. 补充画面感、情绪基调、叙事视角或场景线索，让它能直接激发分镜创作
3. 控制在 40-80 字，一段话，口语自然、有吸引力，不要分点、不要加标题
4. ${styleHint}
只返回优化后的主题描述本身，不要任何解释、引号或前后缀。`;
  const userPrompt = `原始主题：${theme}`;
  const content = await llm.chat({
    provider, model,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.85,
    maxTokens: 400,
  });
  return String(content || '').trim().replace(/^["「『]|["」』]$/g, '');
}

module.exports = { generateScript, resolveScriptModel, expandDialog, optimizeTheme, DETAIL_LEVELS };
