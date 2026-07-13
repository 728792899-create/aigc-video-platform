/**
 * 请求体 Schema 校验（基于 Zod）
 * ------------------------------------------------------------------
 * 约束依据：企业级 AI 约束文档 2.2 —— 对所有外部输入进行严格的 Schema 校验，
 * 不信任宽松的隐式类型转换，统一拦截非法/超长/越界输入。
 *
 * 设计原则（向后兼容，纯加法，不破坏现有功能）：
 *   - 只校验关键字段的类型 / 必填 / 长度与范围上限；
 *   - .passthrough() 允许未在 schema 中声明的字段透传（前端会传很多可选项，
 *     逐一枚举成本高且易漏，故只对已知关键字段设防）；
 *   - 字符串统一 trim + 上限，防止超长输入撑爆 prompt / DB；
 *   - 数值用 z.coerce 容忍字符串数字（前端 form 常传字符串），再做范围 clamp 由业务层处理。
 *
 * 用法：router.post('/x', validateBody(schemas.xxx), handler)
 *   校验失败 → 统一返回 400 + 友好中文 message，不进入 handler。
 */

const { z } = require('zod');

// ---------- 复用片段 ----------
const themeStr = z.string().trim().min(1, '请输入创作主题').max(500, '主题过长（上限 500 字）');
const idNum = z.coerce.number().int().positive();
const optStr = (max = 200) => z.string().trim().max(max).optional();

// ---------- 各接口 Schema ----------
const schemas = {
  // POST /api/ai/generate-script
  generateScript: z.object({
    theme: themeStr,
    duration: z.union([z.string(), z.number()]).optional(),
    style: optStr(100),
    scriptProvider: optStr(60),
    scriptModel: optStr(120),
    detailLevel: optStr(40),
    skill_id: z.union([z.string(), z.number()]).optional(),
    skill_ids: z.array(z.union([z.string(), z.number()])).max(20, '技能选择数量过多（上限 20 个）').optional(),
  }).passthrough(),

  // POST /api/ai/optimize-theme
  optimizeTheme: z.object({
    theme: themeStr,
  }).passthrough(),

  // POST /api/ai/generate-image
  generateImage: z.object({
    storyboard_id: idNum,
    prompt: z.string().max(2000, '提示词过长（上限 2000 字）').optional(),
    ratio: optStr(20),
    model: optStr(120),
    async: z.boolean().optional(),
    batch_size: z.coerce.number().int().min(1).max(8).optional(),
    skill_id: z.union([z.string(), z.number()]).optional(),
    skill_ids: z.array(z.union([z.string(), z.number()])).max(20, '技能选择数量过多（上限 20 个）').optional(),
  }).passthrough(),

  // POST /api/ai/auto-produce
  autoProduce: z.object({
    theme: themeStr,
    style: optStr(100),
    duration: z.union([z.string(), z.number()]).optional(),
    model: optStr(120),
    ratio: optStr(20),
    voice: optStr(120),
    name: z.string().trim().max(120).optional(),
    bgmVolume: z.coerce.number().min(0).max(2).optional(),
    demoStageDelayMs: z.coerce.number().int().min(0).max(15000).optional(),
    demoDelayStage: z.enum(['script', 'storyboard', 'image', 'voice', 'subtitle', 'timeline', 'export']).optional(),
    demoFailStageOnce: z.enum(['script', 'storyboard', 'image', 'voice', 'subtitle', 'timeline', 'export']).optional(),
    scriptSkillIds: z.array(z.union([z.string(), z.number()])).max(20, '文案技能选择数量过多（上限 20 个）').optional(),
    imageSkillIds: z.array(z.union([z.string(), z.number()])).max(20, '画面技能选择数量过多（上限 20 个）').optional(),
  }).passthrough(),
};

/**
 * 校验中间件工厂。
 * @param {import('zod').ZodTypeAny} schema
 */
function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      // 取第一条错误，翻译成友好中文
      const issue = result.error.issues[0];
      const field = issue.path.join('.');
      const msg = issue.message || '参数校验失败';
      return res.status(400).json({
        code: 400,
        data: null,
        message: field ? `参数「${field}」：${msg}` : msg,
      });
    }
    // 用校验/规范化后的数据回写 body（coerce 后的数字类型等）
    req.body = { ...req.body, ...result.data };
    next();
  };
}

module.exports = { validateBody, schemas, z };
