import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { stageCounts, stageOf } from '../src/viewers/web/work/pins.ts'
import type { WorkPin } from '../src/work/pins.ts'

const pin = (taskId: string, status: string, extra: Partial<WorkPin> = {}): WorkPin => ({
  key: `task ${taskId}`, assignee: null, taskId, title: taskId, status, draft: status === 'To Do', terminal: status === 'Done',
  done: 0, total: 0, elementId: 'api', colour: '', ...extra,
})

test.concurrent('a status reads as to do, in progress, blocked or done', () => {
  assert.equal(stageOf(pin('1', 'To Do')), 'todo')
  assert.equal(stageOf(pin('2', 'Approved')), 'progress')
  assert.equal(stageOf(pin('3', 'Blocked')), 'blocked')
  assert.equal(stageOf(pin('4', 'Done')), 'done')
})

test.concurrent('an element counts each task once, whatever its assignees', () => {
  assert.deepEqual(stageCounts([
    pin('1', 'To Do'), pin('2', 'In Progress', { key: '@a 2', assignee: '@a' }), pin('2', 'In Progress', { key: '@b 2', assignee: '@b' }),
    pin('3', 'Blocked'), pin('4', 'Done'), pin('5', 'Done'),
  ]), { todo: 1, progress: 1, blocked: 1, done: 2 })
})
