import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateSmartQueueSlot,
  canAccessPatientProfile,
  computeInventorySummary,
  computeUpdatedRating,
  generateUniqueProfileId,
  getStockHealth,
} from './queueSupplyRules.ts';

test('generateUniqueProfileId and access isolation enforce owner boundaries', () => {
  const id = generateUniqueProfileId('ananya', '48210');
  assert.match(id, /^HC-[A-Z0-9]{8}$/);
  assert.equal(canAccessPatientProfile('uid-1', 'uid-1'), true);
  assert.equal(canAccessPatientProfile('uid-2', 'uid-1'), false);
});

test('allocateSmartQueueSlot requires uploaded photo verification and forbids QR', () => {
  assert.throws(
    () =>
      allocateSmartQueueSlot({
        profileId: 'HC-ANA48210',
        clinicName: 'CareGrid Hub',
        urgency: 'priority',
        verificationMethod: 'photo_match',
        photoUploaded: false,
        existingQueueCount: 2,
      }),
    /Upload a check-in/
  );

  const ticket = allocateSmartQueueSlot(
    {
      profileId: 'HC-ANA48210',
      clinicName: 'CareGrid Hub',
      urgency: 'priority',
      verificationMethod: 'photo_match',
      photoUploaded: true,
      photoLabel: 'patient-face.jpg',
      existingQueueCount: 2,
    },
    new Date('2026-11-14T10:00:00Z')
  );
  assert.match(ticket.roomLocation, /Room 204/);
  assert.match(ticket.photoTag, /Photo Verified/);
  assert.equal(ticket.waitMinutes, 16);
});

test('inventory summary and review rating math stay accurate', () => {
  const summary = computeInventorySummary([
    {
      sku: 'OX-101',
      name: 'Pulse Oximeter',
      category: 'diagnostics',
      priceCents: 4500,
      stockQty: 8,
      reorderThreshold: 25,
      supplierName: 'MedCore',
      businessTier: 'small',
      ratingAvg: 4.5,
      reviewCount: 4,
    },
    {
      sku: 'CC-202',
      name: 'Cold-Chain Box',
      category: 'cold_chain',
      priceCents: 18000,
      stockQty: 60,
      reorderThreshold: 20,
      supplierName: 'CryoBio',
      businessTier: 'enterprise',
      ratingAvg: 4.8,
      reviewCount: 10,
    },
  ]);

  assert.equal(getStockHealth({ stockQty: 8, reorderThreshold: 25 }), 'critical');
  assert.equal(summary.criticalCount, 1);
  assert.equal(summary.totalUnits, 68);
  assert.equal(summary.totalValuationCents, 8 * 4500 + 60 * 18000);

  const rating = computeUpdatedRating(4.5, 4, 5);
  assert.equal(rating.reviewCount, 5);
  assert.equal(rating.ratingAvg, 4.6);
});
