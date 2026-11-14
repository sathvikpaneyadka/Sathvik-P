export interface LatLngPoint {
  lat: number;
  lng: number;
}

export type DispatchLayerFilter = 'all' | 'nurses' | 'supplies';

export interface SupplyRouteInput {
  orderCode: string;
  itemSummary: string;
  status: string;
  courierLat: number;
  courierLng: number;
  etaMinutes: number;
}

export interface NurseDispatchInput {
  bookingCode: string;
  nurseName: string;
  serviceType: string;
  scheduledSlot: string;
  status: string;
  nurseLat: number;
  nurseLng: number;
  etaMinutes: number;
}

export interface DispatchMapMarker {
  id: string;
  label: string;
  subtitle: string;
  lat: number;
  lng: number;
  kind: 'clinic' | 'nurse' | 'courier';
  etaMinutes: number;
  status: string;
}

export interface ActiveDispatchRouteSpec {
  id: string;
  kind: 'nurse' | 'courier';
  label: string;
  subtitle: string;
  origin: LatLngPoint;
  destination: LatLngPoint;
  etaMinutes: number;
  strokeColor: string;
}

export interface DispatchTelemetrySnapshot {
  filter: DispatchLayerFilter;
  hub: LatLngPoint;
  markers: DispatchMapMarker[];
  routes: ActiveDispatchRouteSpec[];
  selectedRoute: ActiveDispatchRouteSpec | null;
  summary: {
    activeNursesCount: number;
    activeSuppliesCount: number;
    avgEtaMinutes: number;
    nearestUnitLabel: string;
  };
}

export const DEFAULT_HUB_COORDS: LatLngPoint = { lat: 12.9716, lng: 77.5946 };

export function sanitizeDispatchFilter(raw: string): DispatchLayerFilter {
  if (raw === 'nurses' || raw === 'supplies') return raw;
  return 'all';
}

/**
 * Maps SQL / store medical supply orders and nurse dispatches into PII-safe
 * Google Maps markers, selectable route vectors, and fleet summary metrics.
 */
export function buildDispatchTelemetrySnapshot(input: {
  orders: SupplyRouteInput[];
  nurseBookings: NurseDispatchInput[];
  filter?: DispatchLayerFilter;
  selectedId?: string | null;
  hub?: LatLngPoint;
}): DispatchTelemetrySnapshot {
  const filter = input.filter ?? 'all';
  const hub = input.hub ?? DEFAULT_HUB_COORDS;

  const markers: DispatchMapMarker[] = [
    {
      id: 'hub',
      label: 'CareGrid Hub',
      subtitle: 'Central Clinic & Cold-Chain Depot',
      lat: hub.lat,
      lng: hub.lng,
      kind: 'clinic',
      etaMinutes: 0,
      status: 'active',
    },
  ];

  const routes: ActiveDispatchRouteSpec[] = [];

  if (filter === 'all' || filter === 'nurses') {
    for (const nurse of input.nurseBookings) {
      markers.push({
        id: nurse.bookingCode,
        label: `${nurse.bookingCode} (${nurse.etaMinutes}m)`,
        subtitle: `${nurse.nurseName} · ${nurse.serviceType} (${nurse.status})`,
        lat: nurse.nurseLat,
        lng: nurse.nurseLng,
        kind: 'nurse',
        etaMinutes: nurse.etaMinutes,
        status: nurse.status,
      });
      routes.push({
        id: nurse.bookingCode,
        kind: 'nurse',
        label: `${nurse.bookingCode} · ${nurse.nurseName}`,
        subtitle: `${nurse.serviceType} · ETA ${nurse.etaMinutes} min`,
        origin: { lat: nurse.nurseLat, lng: nurse.nurseLng },
        destination: hub,
        etaMinutes: nurse.etaMinutes,
        strokeColor: '#0f766e',
      });
    }
  }

  if (filter === 'all' || filter === 'supplies') {
    for (const order of input.orders) {
      markers.push({
        id: order.orderCode,
        label: `${order.orderCode} (${order.etaMinutes}m)`,
        subtitle: `Cold-Chain Supply · ${order.itemSummary} (${order.status})`,
        lat: order.courierLat,
        lng: order.courierLng,
        kind: 'courier',
        etaMinutes: order.etaMinutes,
        status: order.status,
      });
      routes.push({
        id: order.orderCode,
        kind: 'courier',
        label: `${order.orderCode} · Supply Route`,
        subtitle: `${order.itemSummary} · ETA ${order.etaMinutes} min`,
        origin: hub,
        destination: { lat: order.courierLat, lng: order.courierLng },
        etaMinutes: order.etaMinutes,
        strokeColor: '#0369a1',
      });
    }
  }

  const selectedRoute =
    (input.selectedId ? routes.find((r) => r.id === input.selectedId) : null) ?? routes[0] ?? null;

  const activeEtas = [
    ...input.nurseBookings.map((n) => n.etaMinutes),
    ...input.orders.map((o) => o.etaMinutes),
  ];
  const avgEtaMinutes =
    activeEtas.length > 0
      ? Math.round(activeEtas.reduce((sum, v) => sum + v, 0) / activeEtas.length)
      : 0;

  let nearestUnitLabel = 'Standby';
  let bestEta = Number.POSITIVE_INFINITY;
  for (const n of input.nurseBookings) {
    if (n.etaMinutes < bestEta) {
      bestEta = n.etaMinutes;
      nearestUnitLabel = `${n.nurseName} (${n.etaMinutes}m)`;
    }
  }
  for (const o of input.orders) {
    if (o.etaMinutes < bestEta) {
      bestEta = o.etaMinutes;
      nearestUnitLabel = `${o.orderCode} (${o.etaMinutes}m)`;
    }
  }

  return {
    filter,
    hub,
    markers,
    routes,
    selectedRoute,
    summary: {
      activeNursesCount: input.nurseBookings.length,
      activeSuppliesCount: input.orders.length,
      avgEtaMinutes,
      nearestUnitLabel,
    },
  };
}
