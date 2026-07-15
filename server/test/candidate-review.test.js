'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCandidateReviewService,
  shouldAutoSelectCandidate,
  resolveSelectedCandidateId,
} = require('../services/candidateReview');

function candidateRepository() {
  const images = [
    { id: 21, storyboard_id: 11, archived_at: null, favorite: 0 },
    { id: 22, storyboard_id: 11, archived_at: null, favorite: 0 },
  ];
  const storyboard = { id: 11, selected_image_id: 21 };
  return {
    images,
    storyboard,
    getCandidate(id) { return images.find((row) => row.id === Number(id)) || null; },
    getStoryboard(id) { return storyboard.id === Number(id) ? storyboard : null; },
    selectCandidate(storyboardId, candidateId, selectedAt) {
      storyboard.selected_image_id = candidateId;
      const row = this.getCandidate(candidateId);
      row.selected_at = selectedAt;
      return { ...row };
    },
    updateReview(id, patch) { Object.assign(this.getCandidate(id), patch); return { ...this.getCandidate(id) }; },
    transaction(fn) { return fn(); },
  };
}

test('候选切换使用稳定 ID，不删除或覆盖旧候选，并保护当前选中项', () => {
  const repository = candidateRepository();
  const service = createCandidateReviewService({ repository, now: () => 1234 });
  service.select({ storyboardId: 11, candidateId: 22 });
  assert.equal(repository.storyboard.selected_image_id, 22);
  assert.equal(repository.images.length, 2);
  assert.equal(repository.getCandidate(21).archived_at, null);
  assert.throws(() => service.review(22, { archived: true }), (error) => error.code === 'CANDIDATE_IN_USE');
  assert.equal(service.review(21, { favorite: true }).favorite, 1);
});

test('新候选不得静默覆盖用户已选结果，只有空选择或明确修复才自动选用', () => {
  assert.equal(shouldAutoSelectCandidate({ currentSelectedId: 42 }), false);
  assert.equal(shouldAutoSelectCandidate({ currentSelectedId: null }), true);
  assert.equal(shouldAutoSelectCandidate({ currentSelectedId: 42, explicitRepair: true }), true);
  assert.equal(resolveSelectedCandidateId({ currentSelectedId: 42, candidateId: 99, canReplace: false }), 42);
  assert.equal(resolveSelectedCandidateId({ currentSelectedId: 42, candidateId: 99, canReplace: true }), 99);
});
