import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HUB_COORDS,
  buildDispatchTelemetrySnapshot,
  sanitizeDispatchFilter,
} from './dispatchMapModel.ts';

const sampleOrders = [
  {
    orderCode: 'ORD-9024',
    itemSummary: '2x Infusion Kit',
    status: 'in_transit',
    courierLat: 12.979,
    courierLng: 77.624,
    etaMinutes: 14,
  },
];

const sampleNurses = [
  {
    bookingCode: 'NR-418',
    nurseName: 'RN Priya Menon',
    serviceType: 'Vitals & IV Hydration',
    scheduledSlot: '15:00 Today',
    status: 'en_route',
    nurseLat: 12.969,
    nurseLng: 77.611,
    etaMinutes: 10,
  },
];

test('sanitizeDispatchFilter validates allowed layer filters', () => {
  assert.equal(sanitizeDispatchFilter('nurses'), 'nurses');
  assert.equal(sanitizeDispatchFilter('supplies'), 'supplies');
  assert.equal(sanitizeDispatchFilter('unknown'), 'all');
});

test('buildDispatchTelemetrySnapshot builds PII-safe markers, selectable routes, and summary', () => {
  const allSnapshot = buildDispatchTelemetrySnapshot({
    orders: sampleOrders,
    nurseBookings: sampleNurses,
    filter: 'all',
    selectedId: 'ORD-9024',
  });

  assert.equal(allSnapshot.hub.lat, DEFAULT_HUB_COORDS.lat);
  assert.equal(allSnapshot.markers.length, 3);
  assert.equal(allSnapshot.routes.length, 2);
  assert.equal(allSnapshot.selectedRoute?.id, 'ORD-9024');
  assert.equal(allSnapshot.selectedRoute?.kind, 'courier');
  assert.equal(allSnapshot.summary.activeNursesCount, 1);
  assert.equal(allSnapshot.summary.activeSuppliesCount, 1);
  assert.equal(allSnapshot.summary.avgEtaMinutes, 12);
  assert.equal(allSnapshot.summary.nearestUnitLabel, 'RN Priya Menon (10m)');

  const nursesOnly = buildDispatchTelemetrySnapshot({
    orders: sampleOrders,
    nurseBookings: sampleNurses,
    filter: 'nurses',
  });
  assert.equal(nursesOnly.markers.length, 2);
  assert.equal(nursesOnly.routes.length, 1);
  assert.equal(nursesOnly.selectedRoute?.id, 'NR-418');
});
