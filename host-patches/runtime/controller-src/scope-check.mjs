import assert from 'node:assert/strict'
import { createHandleScope, restoreIfCurrent } from './scope.mjs'

const scope = createHandleScope()
const owner = { name: 'controller' }
const other = { name: 'other' }

let delayed
await scope.run(owner, async () => {
  setTimeout(() => { delayed = scope.owns(owner) }, 5)
  return 'done'
})
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(delayed, false, 'background work after settle must not inherit an active token')

let innerDuringOuter
await scope.run(owner, async () => {
  assert.equal(scope.owns(owner), true)
  await scope.run(owner, async () => { assert.equal(scope.owns(owner), true) })
  innerDuringOuter = scope.owns(owner)
})
assert.equal(innerDuringOuter, true, 'inner settle must not deactivate the outer token')
assert.equal(scope.owns(owner), false, 'outer token deactivates after settle')
assert.equal(scope.owns(other), false)

const target = { create: 'original' }
const wrapper = () => 'wrapper'
target.create = wrapper
const later = () => 'later'
target.create = later
restoreIfCurrent(target, 'create', wrapper, 'original')
assert.equal(target.create, later, 'restore must not overwrite a later replacement')
restoreIfCurrent(target, 'create', wrapper, 'original')
assert.equal(target.create, later)
console.log('scope-check ok')
