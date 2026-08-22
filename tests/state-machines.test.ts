import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allowedNextStatuses,
  isCaseTransitionAllowed,
  isReopen,
  validateCaseTransitionBody,
} from '../lib/cases/state-machine';
import {
  allowedNextPlanStatuses,
  isPlanTransitionAllowed,
  isTerminal,
} from '../lib/plans/state-machine';

describe('case state machine', () => {
  it('allows documented transitions and rejects no-op/terminal shortcuts', () => {
    assert.equal(isCaseTransitionAllowed('open', 'in_progress'), true);
    assert.equal(isCaseTransitionAllowed('resolved', 'open'), true);
    assert.equal(isCaseTransitionAllowed('resolved', 'closed'), false);
    assert.equal(isCaseTransitionAllowed('open', 'open'), false);
    assert.deepEqual(allowedNextStatuses('closed'), ['open']);
    assert.equal(isReopen('closed', 'open'), true);
  });

  it('enforces reasons after trimming whitespace', () => {
    assert.equal(validateCaseTransitionBody('open', 'resolved', { resolution: 'قصير' })?.field, 'resolution');
    assert.equal(validateCaseTransitionBody('open', 'resolved', { resolution: 'تم التواصل ووضع خطة علاجية مناسبة' }), null);
    assert.equal(validateCaseTransitionBody('open', 'closed', { close_reason: '    ' })?.field, 'close_reason');
    assert.equal(validateCaseTransitionBody('closed', 'open', { reopen_reason: 'سبب قصير' })?.field, 'reopen_reason');
    assert.equal(validateCaseTransitionBody('in_progress', 'open', {}), null);
  });
});

describe('plan state machine', () => {
  it('locks terminal plans and exposes valid next statuses', () => {
    assert.equal(isPlanTransitionAllowed('active', 'on_hold'), true);
    assert.equal(isPlanTransitionAllowed('completed', 'active'), false);
    assert.deepEqual(allowedNextPlanStatuses('on_hold'), ['active', 'completed', 'cancelled']);
    assert.deepEqual(allowedNextPlanStatuses('cancelled'), []);
    assert.equal(isTerminal('completed'), true);
    assert.equal(isTerminal('active'), false);
  });
});
