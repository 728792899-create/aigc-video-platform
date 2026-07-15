import assert from 'node:assert/strict'
import test from 'node:test'

import { TaskManager } from '../services/taskManager'
import { bindTaskRealtime } from '../services/taskRealtime'

test('TaskManager 变化只通过稳定实时事件发布，并可解除监听', () => {
  const manager = new TaskManager()
  const emitted: Array<{ event: string; payload: unknown }> = []
  const stop = bindTaskRealtime({
    emit(event: string, payload: unknown) { emitted.push({ event, payload }) },
  }, manager)

  const task = manager.create('image-batch', { project_id: 12 })
  manager.progress(task.id, 45, '生成候选')
  assert.equal(emitted.length, 2)
  assert.equal(emitted[0]?.event, 'task:changed')
  assert.deepEqual((emitted[1]?.payload as { type: string }).type, 'task.changed')

  stop()
  manager.succeed(task.id, { ok: true })
  assert.equal(emitted.length, 2, '解除绑定后不应继续发布')
})
