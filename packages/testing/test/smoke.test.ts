import { it } from 'vitest'
import { runSmoke } from '../src/smoke.js'

it('完成 16 环节、人工批准、有效 MP4 与重启恢复的零付费 Smoke', async () => {
  await runSmoke()
}, 60_000)
