import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProductItem } from './queueSupplyRules';
import {
  buildSupplyAlertSmsBroadcast,
  computeCriticalThreshold,
  evaluateInventoryThresholdTrigger,
  evaluateProductThreshold,
} from './supplyAlertEngine';

const sampleProducts: ProductItem[] = [
  {
    sku: 'CG-INF-104',
    name: 'Smart Micro-Infusion Care Kit',
    category: 'infusion',
    priceCents: 14800,
    stockQty: 64,
    reorderThreshold: 25,
    supplierName: 'MedVantage Cold-Chain',
    businessTier: 'all',
    ratingAvg: 4.9,
    reviewCount: 42,
  },
  {
    sku: 'CG-HMC-422',
    name: 'Home Nurse Sterile Wound Dressing Bundle',
    category: 'home_care',
    priceCents: 5400,
    stockQty: 9,
    reorderThreshold: 25,
    supplierName: 'CareSource Direct',
    businessTier: 'small',
    ratingAvg: 4.9,
    reviewCount: 67,
  },
  {
    sku: 'CG-CLD-209',
    name: 'CryoTemp Vaccine & Insulin Carrier (8L)',
    category: 'cold_chain',
    priceCents: 21500,
    stockQty: 18,
    reorderThreshold: 24,
    supplierName: 'BioFrost Logistics',
    businessTier: 'enterprise',
    ratingAvg: 4.8,
    reviewCount: 31,
  },
];

test('evaluateProductThreshold classifies healthy, low, and critical levels accurately', () => {
  assert.equal(computeCriticalThreshold(25), 10);

  const healthy = evaluateProductThreshold(sampleProducts[0]);
  assert.equal(healthy.breached, false);
  assert.equal(healthy.severity, null);

  const critical = evaluateProductThreshold(sampleProducts[1]);
  assert.equal(critical.breached, true);
  assert.equal(critical.severity, 'critical');
  assert.equal(critical.criticalThreshold, 10);
  assert.equal(critical.deficitUnits, 16);

  const low = evaluateProductThreshold(sampleProducts[2]);
  assert.equal(low.breached, true);
  assert.equal(low.severity, 'low');
  assert.equal(low.criticalThreshold, 9);
});

test('evaluateInventoryThresholdTrigger creates alerts, escalates acknowledged low -> critical, and auto-resolves on restock', () => {
  const t1 = evaluateInventoryThresholdTrigger(
    sampleProducts,
    [],
    'db_threshold_sweep',
    '2026-11-14T05:00:00.000Z'
  );
  assert.equal(t1.newlyTriggered.length, 2);
  assert.equal(t1.summary.criticalActiveCount, 1);
  assert.equal(t1.summary.lowActiveCount, 1);
  assert.equal(t1.alerts[0].sku, 'CG-HMC-422');
  assert.equal(t1.alerts[0].status, 'active');

  // Acknowledge CG-CLD-209 while stock is still low (18)
  const acknowledged = t1.alerts.map((a) =>
    a.sku === 'CG-CLD-209' ? { ...a, status: 'acknowledged' as const } : a
  );

  // Drop CG-CLD-209 to 6 units (critical): must re-activate and escalate alert
  const droppedProducts = sampleProducts.map((p) =>
    p.sku === 'CG-CLD-209' ? { ...p, stockQty: 6 } : p
  );
  const t2 = evaluateInventoryThresholdTrigger(
    droppedProducts,
    acknowledged,
    'clinical_consumption',
    '2026-11-14T05:05:00.000Z'
  );
  assert.equal(t2.escalatedToCritical.length, 1);
  assert.equal(t2.escalatedToCritical[0].sku, 'CG-CLD-209');
  assert.equal(t2.escalatedToCritical[0].status, 'active');
  assert.equal(t2.summary.criticalActiveCount, 2);

  // Restock CG-HMC-422 above threshold (49 > 25): must auto-resolve
  const restockedProducts = droppedProducts.map((p) =>
    p.sku === 'CG-HMC-422' ? { ...p, stockQty: 49 } : p
  );
  const t3 = evaluateInventoryThresholdTrigger(
    restockedProducts,
    t2.alerts,
    'restock_replenishment',
    '2026-11-14T05:10:00.000Z'
  );
  assert.equal(t3.autoResolved.length, 1);
  assert.equal(t3.autoResolved[0].sku, 'CG-HMC-422');
  assert.equal(t3.autoResolved[0].status, 'resolved');
});

test('buildSupplyAlertSmsBroadcast formats concise staff pager message without patient PII', () => {
  const msg = buildSupplyAlertSmsBroadcast({
    alertCode: 'SUPALT-CGHMC422',
    sku: 'CG-HMC-422',
    productName: 'Home Nurse Sterile Wound Dressing Bundle',
    stockQty: 9,
    reorderThreshold: 25,
    severity: 'critical',
    supplierName: 'CareSource Direct',
  });
  assert.match(msg, /CAREGRID CRITICAL STOCK/);
  assert.match(msg, /CG-HMC-422/);
  assert.match(msg, /9 units/);
  assert.match(msg, /SUPALT-CGHMC422/);
});
