import express from 'express'
import {
  PromptKindSchema,
  PromptRevisionCreateSchema,
  SceneRegenerationSchema,
} from '@aigc-video/contracts'

import { getDb } from '../db'
import idempotency = require('../services/idempotency')
import { promptRevisions } from '../services/promptRevisions'
import { runSceneRegeneration } from '../services/sceneRegeneration'
import type { TaskManager } from '../services/taskManager'
import { errorDetails, errorMessage } from './routeSupport'

const router = express.Router()
const taskManager = require('../services/taskManager') as TaskManager

function status(error: unknown): number {
  const code = errorDetails(error).code
  if (code === 'PROMPT_REVISION_NOT_FOUND') return 404
  if (code?.startsWith('PROMPT_')) return 400
  return 500
}

router.get('/projects/:projectId/prompts', (req, res) => {
  try {
    const projectId = Number(req.params.projectId)
    const storyboardId = req.query.storyboard_id == null ? null : Number(req.query.storyboard_id)
    const kind = req.query.kind == null ? undefined : PromptKindSchema.parse(req.query.kind)
    res.json({ code: 200, data: promptRevisions.list(projectId, storyboardId, kind), message: 'success' })
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: errorMessage(error) })
  }
})

router.post('/projects/:projectId/prompts', (req, res) => {
  try {
    const projectId = Number(req.params.projectId)
    const project = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' })
    const body = PromptRevisionCreateSchema.parse(req.body)
    if (body.storyboard_id != null) {
      const storyboard = getDb().prepare('SELECT id, project_id FROM storyboards WHERE id = ?').get(body.storyboard_id)
      if (!storyboard || Number(storyboard.project_id) !== projectId) {
        return res.status(400).json({ code: 400, data: null, message: '分镜不属于当前项目' })
      }
    }
    const created = promptRevisions.create({ ...body, project_id: projectId })
    res.status(201).json({ code: 201, data: created, message: 'Prompt revision 已创建' })
  } catch (error) {
    const code = status(error); res.status(code).json({ code, data: null, message: errorMessage(error) })
  }
})

router.get('/prompts/:id/diff', (req, res) => {
  try {
    const data = promptRevisions.diff(req.params.id, typeof req.query.against === 'string' ? req.query.against : undefined)
    res.json({ code: 200, data, message: 'success' })
  } catch (error) {
    const code = status(error); res.status(code).json({ code, data: null, message: errorMessage(error) })
  }
})

router.post('/prompts/:id/restore', (req, res) => {
  try {
    res.status(201).json({ code: 201, data: promptRevisions.restore(req.params.id), message: '已从历史版本创建新 revision' })
  } catch (error) {
    const code = status(error); res.status(code).json({ code, data: null, message: errorMessage(error) })
  }
})

router.post('/storyboards/:id/regenerate', idempotency({ scope: 'storyboards.regenerate' }), (req, res) => {
  try {
    const storyboardId = Number(req.params.id)
    const storyboard = getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(storyboardId)
    if (!storyboard) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' })
    const body = SceneRegenerationSchema.parse(req.body)
    const demo = ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase())
    if (!demo && !body.confirm_cost) {
      return res.status(409).json({ code: 409, data: { error_code: 'COST_CONFIRMATION_REQUIRED' }, message: '真实 Provider 重生成需要明确费用确认' })
    }
    const revision = body.prompt_revision_id ? promptRevisions.get(body.prompt_revision_id) : null
    if (body.prompt_revision_id && (!revision || revision.storyboard_id !== storyboardId)) {
      return res.status(400).json({ code: 400, data: null, message: 'Prompt revision 不属于当前分镜' })
    }
    const bindings = getDb().prepare('SELECT snapshot FROM storyboard_asset_bindings WHERE storyboard_id = ? ORDER BY id')
      .all(storyboardId).map((row) => { try { return JSON.parse(String(row.snapshot || '{}')) } catch { return {} } })
    const task = taskManager.create('scene-regenerate', {
      project_id: storyboard.project_id, storyboard_id: storyboardId, stages: body.stages,
      provider: body.provider || (demo ? 'demo' : null), model: body.model || null,
      idempotency_key: req.idempotency?.key || body.idempotencyKey || null,
      retryable: true, input_snapshot: {
        storyboard_id: storyboardId, prompt_revision_id: revision?.id || null,
        prompt_hash: revision?.content_hash || null, stages: body.stages,
      },
      media_snapshot: bindings.flatMap((binding) => binding.media_reference ? [binding.media_reference] : []),
      recovery: { kind: 'scene-regenerate', mode: demo ? 'safe-auto' : 'manual-reconcile', attempts: 0, max_attempts: 3 },
    })
    res.status(202).json({ code: 202, data: { task_id: task.id, storyboard_id: storyboardId, stages: body.stages }, message: '逐场景重生成任务已创建' })
    void runSceneRegeneration(task.id, storyboardId, {
      stages: body.stages, prompt: revision?.content || String(storyboard.prompt || storyboard.description || ''),
      promptRevisionId: revision?.id, provider: body.provider, model: body.model, confirmCost: body.confirm_cost,
    }).catch((error) => taskManager.fail(task.id, error))
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: errorMessage(error) })
  }
})

export = router
