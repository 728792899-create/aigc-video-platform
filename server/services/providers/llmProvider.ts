/**
 * 统一 LLM 适配器（升级方案 v3 第一期）
 *
 * 所有 OpenAI 兼容的 LLM（DeepSeek / GPT / Claude 中转 / 通义 / Kimi / 智谱）
 * 共用这一份 chat 实现，只换 baseUrl / apiKey / model / chatPath。
 *
 * 用法：
 *   const llm = require('./llmProvider');
 *   const text = await llm.chat({ provider:'deepseek', model:'deepseek-chat', messages, jsonMode:true });
 */
import { assertSelection } from '../modelCatalog'
import { getProvider, resolveCredentials } from './index'

type MessageRole = 'system' | 'user' | 'assistant' | 'tool'
interface ChatMessage {
  role: MessageRole | string
  content: unknown
  [key: string]: unknown
}
export interface ChatOptions {
  provider: string
  model?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  timeout?: number
}
interface ChatRequestBody {
  model: string
  messages: ChatMessage[]
  temperature: number
  max_tokens: number
  stream: boolean
  response_format?: { type: 'json_object' }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

const DEFAULT_TIMEOUT = 60000;
const MAX_RETRIES = 3; // LLM 调用重试上限（网络抖动/超时/5xx 重试，4xx 不重试）
const BASE_RETRY_DELAY = 1500; // 基础退避 1.5s（比图片稍快，文案生成优先级高）
const MAX_RETRY_DELAY = 10000; // 退避上限 10s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断错误是否值得重试（网络/超时/5xx 重试，4xx 不重试）
 */
function isRetryableError(err: unknown): boolean {
  const msg = errorMessage(err);
  // 超时
  if (msg.includes('请求超时') || msg.includes('AbortError')) return true;
  // 网络故障（fetch 原生错误）
  if (msg.includes('网络请求失败') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) return true;
  // 5xx 服务端错误（中转站临时故障）
  if (/API 错误 \(5\d\d\)/.test(msg)) return true;
  // 4xx 客户端错误（认证/quota/格式）不重试
  return false;
}

/**
 * 调用一次 chat completion，返回 message.content 字符串。
 * @param {object} p
 * @param {string} p.provider  provider key（如 'deepseek'/'openai'/'claude'）
 * @param {string} [p.model]   模型名，不传用 provider 第一个默认模型
 * @param {Array}  p.messages  [{role, content}]
 * @param {number} [p.temperature]
 * @param {number} [p.maxTokens]
 * @param {boolean}[p.jsonMode] 是否要求返回 JSON object
 * @param {number} [p.timeout]
 * @returns {Promise<string>} 模型回复文本
 */
async function chatOnce({ provider, model, messages, temperature = 0.8, maxTokens = 4096, jsonMode = false, timeout = DEFAULT_TIMEOUT }: ChatOptions): Promise<string> {
  const selection = assertSelection({
    provider,
    model,
    modality: 'text',
    requires: jsonMode ? ['structured_output'] : [],
  });
  const def = getProvider(provider);
  if (!def) throw new Error(`未知的 LLM provider：${provider}`);
  if (def.kind !== 'llm') throw new Error(`provider ${provider} 不是 LLM 类型`);

  const cred = resolveCredentials(provider);
  if (!cred?.apiKey) {
    throw new Error(`${def.label} 未配置 API Key，请在「系统设置 → 模型路由」中填写`);
  }

  const useModel = selection.model;
  const url = `${cred.baseUrl.replace(/\/$/, '')}${cred.chatPath}`;

  const body: ChatRequestBody = {
    model: useModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    // 默认走流式：部分中转渠道（如 codex 分组的 gpt-5.5）只在 stream:true 时返回内容，
    // 非流式会吐空 choices。流式是 OpenAI 兼容协议通用能力，最兼容。
    // parseChatContent 会把流式 delta 拼回完整字符串，上层无感知。
    stream: true,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cred.apiKey}`,
    'Accept': 'text/event-stream',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (asRecord(e).name === 'AbortError') throw new Error(`${def.label} 请求超时（>${timeout / 1000}s）`);
    throw new Error(`${def.label} 网络请求失败：${errorMessage(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`${def.label} API 错误 (${response.status}): ${errText.slice(0, 300)}`);
  }

  const raw = await response.text();
  const content = parseChatContent(raw);
  if (content == null) throw new Error(`${def.label} 返回为空或格式异常`);
  return content;
}

/**
 * 带重试退避的 chat 封装（对外入口）。
 * 仅对瞬时错误（超时/网络抖动/5xx）重试，4xx（认证/配额/格式）立即抛出不浪费时间。
 * 指数退避 + ±25% 抖动，避免多任务并发重试形成请求尖峰。
 * 失败语义与原 chatOnce 完全一致，调用方无感知。
 */
export async function chat(opts: ChatOptions): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await chatOnce(opts);
    } catch (err) {
      lastErr = err;
      // 不可重试错误（4xx 等）或已是最后一次，直接抛出
      if (attempt >= MAX_RETRIES || !isRetryableError(err)) throw err;
      const exponentialDelay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
      const jitter = 0.75 + Math.random() * 0.5; // [0.75, 1.25]
      const delay = Math.min(exponentialDelay * jitter, MAX_RETRY_DELAY);
      console.warn(`[llmProvider] ${opts.provider} 第 ${attempt}/${MAX_RETRIES} 次失败（${errorMessage(err)}），${Math.round(delay)}ms 后重试…`);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('LLM 请求失败');
}

/**
 * 解析 chat completion 响应体。
 * 兼容两种格式：
 *  1) 标准 JSON：{choices:[{message:{content}}]}
 *  2) SSE 流式：多行 "data: {delta...}"（部分中转站忽略 stream:false 仍返回流）
 */
export function parseChatContent(raw: unknown): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  // 非 SSE：直接 JSON
  if (!text.startsWith('data:')) {
    try {
      const data = asRecord(JSON.parse(text));
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const message = asRecord(asRecord(choices[0]).message);
      return typeof message.content === 'string' ? message.content : null;
    } catch (e) {
      throw new Error(`返回解析失败：${text.slice(0, 200)}`);
    }
  }
  // SSE：逐行拼接 delta.content
  let buf = '';
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const chunk = asRecord(JSON.parse(payload));
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      const choice = asRecord(choices[0]);
      const delta = asRecord(choice.delta);
      const message = asRecord(choice.message);
      const piece = typeof delta.content === 'string'
        ? delta.content
        : typeof message.content === 'string' ? message.content : '';
      if (piece) buf += piece;
    } catch (_) { /* 跳过非 JSON 行 */ }
  }
  return buf || null;
}
