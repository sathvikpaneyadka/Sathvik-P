import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Static & structural verification suite for CareGrid's Dirty Dozen payloads
 * and security invariants against firestore.rules.
 */
const rulesText = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('Global safety net default-deny catch-all is first match inside database', () => {
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test('Dirty Dozen #1 & #2: PII and patientProfiles forbid unauthenticated or cross-user reads', () => {
  assert.match(rulesText, /match \/users\/\{userId\}\/private\/\{docId\}[\s\S]*?allow get: if isValidId\(userId\) && isValidId\(docId\) && docId == 'info' && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
  assert.match(rulesText, /match \/patientProfiles\/\{profileId\}[\s\S]*?existing\(\)\.ownerUid == request\.auth\.uid/);
});

test('Dirty Dozen #3: allow list enforces resource.data ownership without get()', () => {
  const listMatches = [...rulesText.matchAll(/allow list:[^;]+;/g)].map((m) => m[0]);
  assert.ok(listMatches.length >= 4);
  for (const rule of listMatches) {
    assert.ok(!rule.includes('get('), `allow list must not use get(): ${rule}`);
  }
});

test('Dirty Dozen #4-#6: Identity spoofing, shadow fields, and admin self-escalation blocked', () => {
  assert.match(rulesText, /match \/admins\/\{uid\}[\s\S]*?allow list, create, update, delete: if false;/);
  assert.match(rulesText, /data\.keys\(\)\.hasAll/);
  assert.match(rulesText, /data\.keys\(\)\.hasOnly/);
  assert.match(rulesText, /data\.ownerUid == request\.auth\.uid/);
});

test('Dirty Dozen #7: Email spoofing blocked via email_verified check', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
});

test('Dirty Dozen #8-#12: ID poisoning, timestamp forgery, immutability, terminal lock, and size bounds', () => {
  assert.match(rulesText, /function isValidId\(id\)/);
  assert.match(rulesText, /== request\.time/);
  assert.match(rulesText, /incoming\(\)\.ownerUid == existing\(\)\.ownerUid/);
  assert.match(rulesText, /!\(existing\(\)\.status in \['completed', 'cancelled'\]\)/);
  assert.match(rulesText, /affectedKeys\(\)\.hasOnly/);
});

test('Supply Alerts collection enforces threshold integer bounds, SKU immutability, and terminal lock', () => {
  assert.match(rulesText, /function isValidSupplyAlert\(data\)/);
  assert.match(rulesText, /match \/supplyAlerts\/\{alertId\}/);
  assert.match(rulesText, /incoming\(\)\.sku == existing\(\)\.sku/);
  assert.match(rulesText, /existing\(\)\.status != 'resolved'/);
  assert.match(rulesText, /data\.stockQty is int && data\.stockQty >= 0 && data\.stockQty <= 1000000/);
});

