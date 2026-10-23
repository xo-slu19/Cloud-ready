import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeReadinessChange, filterReview, getDomainName, safeExternalUrl } from '../src/helpers.js';

test('review filters use the complete result list', () => {
  const review = [
    { correct: false, luckyGuess: false },
    { correct: true, luckyGuess: true },
    { correct: true, luckyGuess: false },
  ];
  assert.equal(filterReview(review, 'all').length, 3);
  assert.equal(filterReview(review, 'wrong').length, 1);
  assert.equal(filterReview(review, 'lucky').length, 1);
});

test('domain names use API data and safely fall back for unknown IDs', () => {
  assert.equal(getDomainName('cloud-concepts', [{ domain: 'cloud-concepts', name: 'Cloud concepts' }]), 'Cloud concepts');
  assert.equal(getDomainName('management-governance', [], [{ id: 'management-governance', name: 'Management and governance' }]), 'Management and governance');
  assert.equal(getDomainName('unknown-domain'), 'unknown-domain');
});

test('external learning URLs must use HTTPS', () => {
  assert.equal(safeExternalUrl('https://learn.microsoft.com/azure'), 'https://learn.microsoft.com/azure');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('not a URL'), null);
});

test('readiness changes are described as points without inventing a missing value', () => {
  assert.equal(describeReadinessChange(12), '+12 readiness points since your previous quiz');
  assert.equal(describeReadinessChange(-5), '-5 readiness points since your previous quiz');
  assert.equal(describeReadinessChange(0), 'No readiness change since your previous quiz');
  assert.equal(describeReadinessChange(null), null);
});
