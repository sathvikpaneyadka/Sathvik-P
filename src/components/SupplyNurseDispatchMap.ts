import { importLibrary } from '@googlemaps/js-api-loader';
import {
  DEFAULT_HUB_COORDS,
  buildDispatchTelemetrySnapshot,
  sanitizeDispatchFilter,
  type ActiveDispatchRouteSpec,
  type DispatchLayerFilter,
  type DispatchTelemetrySnapshot,
  type NurseDispatchInput,
  type SupplyRouteInput,
} from '../core/dispatchMapModel';
import { auth } from '../lib/firebase';
import {
  MAPS_ATTRIBUTION_ID,
  ensureMapsLoader,
  type NearbyPlaceItem,
} from '../lib/maps';
import { store } from '../lib/state';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SqlTelemetryPayload {
  ok: boolean;
  source?: string;
  syncedAt?: string;
  orders?: SupplyRouteInput[];
  nurseBookings?: NurseDispatchInput[];
}

export class SupplyNurseDispatchMap {
  private filter: DispatchLayerFilter = 'all';
  private selectedRouteId: string | null = null;
  private liveStreamEnabled = true;
  private streamTimer: number | null = null;

  private syncSourceLabel = 'Store Mirror (Sign in for SQL)';
  private lastSyncedText = 'Live';
  private sqlOrders: SupplyRouteInput[] | null = null;
  private sqlNurses: NurseDispatchInput[] | null = null;

  private routeDistanceText = '4.2 km';
  private routeDurationText = '14 mins';
  private nearbyPlaces: NearbyPlaceItem[] = [];

  private mapHostEl: HTMLElement | null = null;
  private map: google.maps.Map | null = null;
  private markerLib: google.maps.MarkerLibrary | null = null;
  private mapsLib: google.maps.MapsLibrary | null = null;
  private infoWindow: google.maps.InfoWindow | null = null;
  private unitMarkers = new Map<string, google.maps.marker.AdvancedMarkerElement>();
  private placeMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
  private activePolylines: google.maps.Polyline[] = [];
  private mapInitInFlight = false;

  private onNearbyPlaces?: (places: NearbyPlaceItem[]) => void;

  constructor(options?: { onNearbyPlaces?: (places: NearbyPlaceItem[]) => void }) {
    this.onNearbyPlaces = options?.onNearbyPlaces;
  }

  private getEffectiveSources(): {
    orders: SupplyRouteInput[];
    nurseBookings: NurseDispatchInput[];
  } {
    const state = store.getState();
    return {
      orders:
        this.sqlOrders && this.sqlOrders.length > 0 ? this.sqlOrders : state.orders,
      nurseBookings:
        this.sqlNurses && this.sqlNurses.length > 0
          ? this.sqlNurses
          : state.nurseBookings,
    };
  }

  private getSnapshot(): DispatchTelemetrySnapshot {
    const { orders, nurseBookings } = this.getEffectiveSources();
    return buildDispatchTelemetrySnapshot({
      orders,
      nurseBookings,
      filter: this.filter,
      selectedId: this.selectedRouteId,
      hub: DEFAULT_HUB_COORDS,
    });
  }

  render(container: HTMLElement): void {
    const snapshot = this.getSnapshot();
    if (!this.selectedRouteId && snapshot.selectedRoute) {
      this.selectedRouteId = snapshot.selectedRoute.id;
    }

    container.innerHTML = `
      <div class="cg-card p-5 space-y-4">
        <!-- Header & Layer Filter Controls -->
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-bold text-slate-900">Real-Time Supply Routes &amp; Nurse Dispatch Map</h3>
              <span id="sndm-sync-badge" class="text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                this.syncSourceLabel === 'SQL Live Sync'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }">${esc(this.syncSourceLabel)} · ${esc(this.lastSyncedText)}</span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">
              Google Maps Platform · Active Route:
              <strong class="text-teal-700">${esc(snapshot.selectedRoute?.label || 'Hub Standby')}</strong>
              (<span id="sndm-route-metrics" class="tabular-nums font-semibold text-slate-800">${esc(this.routeDurationText)} · ${esc(this.routeDistanceText)}</span>)
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button type="button" data-filter="all" class="sndm-filter-btn px-2.5 py-1.5 rounded-md text-xs font-semibold border transition ${
              this.filter === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }">All Units</button>
            <button type="button" data-filter="nurses" class="sndm-filter-btn px-2.5 py-1.5 rounded-md text-xs font-semibold border transition ${
              this.filter === 'nurses'
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }">Home Nurses</button>
            <button type="button" data-filter="supplies" class="sndm-filter-btn px-2.5 py-1.5 rounded-md text-xs font-semibold border transition ${
              this.filter === 'supplies'
                ? 'bg-sky-700 text-white border-sky-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }">Supply Routes</button>
          </div>
        </div>

        <!-- Fleet KPIs + Live Stream Actions -->
        <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div class="sm:col-span-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div class="text-[11px] font-semibold text-slate-500 uppercase">Nurse Dispatches</div>
            <div class="text-base font-bold text-teal-800 tabular-nums mt-0.5">${snapshot.summary.activeNursesCount} Active</div>
          </div>
          <div class="sm:col-span-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div class="text-[11px] font-semibold text-slate-500 uppercase">Supply Vans</div>
            <div class="text-base font-bold text-sky-800 tabular-nums mt-0.5">${snapshot.summary.activeSuppliesCount} In Transit</div>
          </div>
          <div class="sm:col-span-6 p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[11px] font-semibold text-slate-500 uppercase">Nearest ETA</div>
              <div class="text-xs font-bold text-slate-900 tabular-nums mt-0.5 truncate">${esc(snapshot.summary.nearestUnitLabel)}</div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" id="sndm-stream-toggle" class="whitespace-nowrap px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                this.liveStreamEnabled
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-white text-slate-600 border-slate-300'
              }">${this.liveStreamEnabled ? 'Auto-Sync ON' : 'Auto-Sync OFF'}</button>
              <button type="button" id="sndm-sync-btn" class="cg-btn-secondary whitespace-nowrap px-2.5 py-1 text-[11px]">Sync Now</button>
            </div>
          </div>
        </div>

        <!-- Real Google Maps Viewport -->
        <div id="caregrid-google-map" data-testid="caregrid-google-map" class="w-full h-80 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden"></div>

        <!-- Legend & Selectable Live Route Strip -->
        <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
          <div class="flex flex-wrap items-center gap-3">
            <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-slate-900 inline-block"></span>Depot Hub</span>
            <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block"></span>Home Nurse</span>
            <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-sky-700 inline-block"></span>Supply Route</span>
            <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-emerald-700 inline-block"></span>Verified Clinic</span>
          </div>
          <span>Click any pin or route card below to focus live navigation</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          ${snapshot.routes
            .map((route) => {
              const isSelected = snapshot.selectedRoute?.id === route.id;
              return `
                <button
                  type="button"
                  data-route-id="${esc(route.id)}"
                  class="sndm-route-card text-left p-3 rounded-lg border transition flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-teal-600 bg-teal-50/70 shadow-sm'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }"
                >
                  <div class="min-w-0">
                    <div class="text-xs font-bold ${route.kind === 'nurse' ? 'text-teal-800' : 'text-sky-800'} truncate">
                      ${esc(route.label)}
                    </div>
                    <div class="text-[11px] text-slate-600 truncate mt-0.5">${esc(route.subtitle)}</div>
                    <div class="text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                      GPS: ${route.kind === 'nurse' ? `${route.origin.lat.toFixed(4)}, ${route.origin.lng.toFixed(4)}` : `${route.destination.lat.toFixed(4)}, ${route.destination.lng.toFixed(4)}`}
                    </div>
                  </div>
                  <span class="shrink-0 text-xs font-bold tabular-nums px-2 py-1 rounded bg-white border border-slate-200 text-slate-900">
                    ${route.etaMinutes}m
                  </span>
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    `;

    this.bindEvents(container);
    void this.ensureMapAndSync(container);
    this.ensurePollingLoop(container);
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>('.sndm-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filter = sanitizeDispatchFilter(btn.dataset.filter || 'all');
        this.render(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.sndm-route-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.routeId || null;
        if (id) {
          this.selectedRouteId = id;
          this.render(container);
        }
      });
    });

    container.querySelector('#sndm-stream-toggle')?.addEventListener('click', () => {
      this.liveStreamEnabled = !this.liveStreamEnabled;
      this.ensurePollingLoop(container);
      this.render(container);
    });

    container.querySelector('#sndm-sync-btn')?.addEventListener('click', () => {
      void this.syncFromSqlAndStep(container, true);
    });
  }

  private ensurePollingLoop(container: HTMLElement): void {
    if (this.streamTimer !== null) {
      window.clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
    if (!this.liveStreamEnabled) return;

    this.streamTimer = window.setInterval(() => {
      if (!document.body.contains(container)) {
        if (this.streamTimer !== null) {
          window.clearInterval(this.streamTimer);
          this.streamTimer = null;
        }
        return;
      }
      void this.syncFromSqlAndStep(container, true);
    }, 12000);
  }

  async syncFromSqlAndStep(container: HTMLElement, advanceStep = false): Promise<void> {
    const user = auth.currentUser;
    if (user) {
      try {
        const token = await user.getIdToken();
        const endpoint = advanceStep
          ? '/api/db/dispatch-telemetry/tick'
          : '/api/db/dispatch-telemetry';
        const res = await fetch(endpoint, {
          method: advanceStep ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          ...(advanceStep
            ? {
                body: JSON.stringify({
                  targetLat: DEFAULT_HUB_COORDS.lat,
                  targetLng: DEFAULT_HUB_COORDS.lng,
                }),
              }
            : {}),
        });

        if (res.ok) {
          const data = (await res.json()) as SqlTelemetryPayload;
          if (data.ok) {
            if (Array.isArray(data.orders) && data.orders.length > 0) {
              this.sqlOrders = data.orders;
            }
            if (Array.isArray(data.nurseBookings) && data.nurseBookings.length > 0) {
              this.sqlNurses = data.nurseBookings;
            }
            this.syncSourceLabel = 'SQL Live Sync';
            this.lastSyncedText = new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            await this.updateMapEntities();
            this.updateBadgeAndCards(container);
            return;
          }
        } else if (res.status === 503) {
          this.syncSourceLabel = 'SQL Standby (Local Mirror)';
        }
      } catch {
        this.syncSourceLabel = 'SQL Standby (Local Mirror)';
      }
    } else {
      this.syncSourceLabel = 'Store Mirror (Sign in for SQL)';
    }

    if (advanceStep) {
      store.tickLiveTelemetry();
    }
    this.lastSyncedText = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    await this.updateMapEntities();
    this.updateBadgeAndCards(container);
  }

  private updateBadgeAndCards(container: HTMLElement): void {
    const badge = container.querySelector('#sndm-sync-badge');
    if (badge) {
      badge.textContent = `${this.syncSourceLabel} · ${this.lastSyncedText}`;
    }
    const metrics = container.querySelector('#sndm-route-metrics');
    if (metrics) {
      metrics.textContent = `${this.routeDurationText} · ${this.routeDistanceText}`;
    }
  }

  private async ensureMapAndSync(container: HTMLElement): Promise<void> {
    const mapHost = container.querySelector('#caregrid-google-map') as HTMLElement | null;
    if (!mapHost) return;

    if (!ensureMapsLoader()) {
      if (mapHost.childElementCount === 0) {
        mapHost.innerHTML = `
          <div class="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-600">
            <div class="font-semibold text-slate-900">Google Maps Viewport Ready</div>
            <p class="mt-1 max-w-md">Configure VITE_GOOGLE_MAPS_API_KEY to render live interactive supply routes and nurse dispatch locations.</p>
          </div>
        `;
      }
      return;
    }

    if (this.mapHostEl !== mapHost) {
      this.mapHostEl = mapHost;
      this.map = null;
      this.unitMarkers.clear();
      this.placeMarkers = [];
      this.activePolylines = [];
    }

    if (!this.map && !this.mapInitInFlight) {
      this.mapInitInFlight = true;
      try {
        this.mapsLib = (await importLibrary('maps')) as google.maps.MapsLibrary;
        this.markerLib = (await importLibrary('marker')) as google.maps.MarkerLibrary;
        this.infoWindow = new this.mapsLib.InfoWindow();

        this.map = new this.mapsLib.Map(mapHost, {
          center: DEFAULT_HUB_COORDS,
          zoom: 13,
          mapId: 'DEMO_MAP_ID',
          disableDefaultUI: false,
          mapTypeControl: false,
          internalUsageAttributionIds: [MAPS_ATTRIBUTION_ID],
        } as google.maps.MapOptions);

        void this.loadNearbyFacilities();
      } catch (err) {
        console.warn('Google Maps initialization notice:', err);
      } finally {
        this.mapInitInFlight = false;
      }
    }

    await this.updateMapEntities();
    this.updateBadgeAndCards(container);
  }

  private async loadNearbyFacilities(): Promise<void> {
    if (!this.map || !this.markerLib) return;
    try {
      const placesLib = (await importLibrary('places')) as google.maps.PlacesLibrary;
      const { places } = await placesLib.Place.searchByText({
        textQuery: 'hospital clinic pharmacy medical center',
        fields: ['displayName', 'formattedAddress', 'location', 'rating'],
        locationBias: { center: DEFAULT_HUB_COORDS, radius: 5000 },
        maxResultCount: 5,
      });

      for (const pm of this.placeMarkers) {
        pm.map = null;
      }
      this.placeMarkers = [];

      const items: NearbyPlaceItem[] = [];
      for (const [idx, p] of (places ?? []).entries()) {
        const loc = p.location;
        if (!loc || !this.map || !this.markerLib) continue;

        const item: NearbyPlaceItem = {
          id: p.id || `place-${idx}`,
          name: p.displayName || 'Healthcare Facility',
          address: p.formattedAddress || 'Verified nearby location',
          lat: loc.lat(),
          lng: loc.lng(),
          rating: typeof p.rating === 'number' ? p.rating : undefined,
        };
        items.push(item);

        const badge = document.createElement('div');
        badge.className =
          'px-2 py-0.5 rounded bg-white text-emerald-900 text-[11px] font-semibold border border-emerald-600 shadow-sm';
        badge.textContent = item.name.slice(0, 22);

        const marker = new this.markerLib.AdvancedMarkerElement({
          map: this.map,
          position: { lat: item.lat, lng: item.lng },
          title: item.name,
          content: badge,
        });
        this.placeMarkers.push(marker);
      }

      if (items.length > 0) {
        this.nearbyPlaces = items;
        this.onNearbyPlaces?.(items);
      }
    } catch (err) {
      console.warn('Places searchByText notice:', err);
    }
  }

  private async updateMapEntities(): Promise<void> {
    if (!this.map || !this.markerLib || !this.mapsLib) return;

    const snapshot = this.getSnapshot();
    const visibleIds = new Set(snapshot.markers.map((m) => m.id));

    for (const [id, marker] of this.unitMarkers.entries()) {
      if (!visibleIds.has(id)) {
        marker.map = null;
        this.unitMarkers.delete(id);
      }
    }

    for (const item of snapshot.markers) {
      const existing = this.unitMarkers.get(item.id);
      const isSelected = snapshot.selectedRoute?.id === item.id;
      const badgeClass =
        item.kind === 'nurse'
          ? `px-2.5 py-1 rounded-md bg-teal-700 text-white text-xs font-semibold shadow border ${isSelected ? 'border-amber-300 ring-2 ring-amber-300' : 'border-white'}`
          : item.kind === 'courier'
            ? `px-2.5 py-1 rounded-md bg-sky-700 text-white text-xs font-semibold shadow border ${isSelected ? 'border-amber-300 ring-2 ring-amber-300' : 'border-white'}`
            : 'px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs font-semibold shadow border border-white';

      if (existing) {
        existing.position = { lat: item.lat, lng: item.lng };
        const el = existing.content as HTMLElement | null;
        if (el) {
          el.className = badgeClass;
          el.textContent = item.label;
        }
      } else {
        const pinEl = document.createElement('div');
        pinEl.className = badgeClass;
        pinEl.textContent = item.label;

        const advMarker = new this.markerLib.AdvancedMarkerElement({
          map: this.map,
          position: { lat: item.lat, lng: item.lng },
          title: item.label,
          content: pinEl,
        });

        advMarker.addEventListener('gmp-click', () => {
          if (item.id !== 'hub') {
            this.selectedRouteId = item.id;
          }
          this.infoWindow?.setContent(
            `<div style="font-family: DM Sans, sans-serif; color: #0f172a; padding: 2px 4px;">
              <strong style="font-size: 13px;">${esc(item.label)}</strong>
              <div style="font-size: 12px; color: #475569; margin-top: 2px;">${esc(item.subtitle)}</div>
            </div>`
          );
          if (this.map) {
            this.infoWindow?.open({ map: this.map, anchor: advMarker });
          }
        });

        this.unitMarkers.set(item.id, advMarker);
      }
    }

    await this.renderRoutesOnMap(snapshot.routes, snapshot.selectedRoute);
  }

  private async renderRoutesOnMap(
    routes: ActiveDispatchRouteSpec[],
    selectedRoute: ActiveDispatchRouteSpec | null
  ): Promise<void> {
    if (!this.map || !this.mapsLib) return;

    for (const poly of this.activePolylines) {
      poly.setMap(null);
    }
    this.activePolylines = [];

    if (routes.length === 0) return;

    // Draw background path vectors for secondary active units so all delivery routes & nurse vectors remain visible simultaneously
    for (const route of routes) {
      if (selectedRoute && route.id === selectedRoute.id) continue;
      const secondaryPoly = new this.mapsLib.Polyline({
        path: [route.origin, route.destination],
        strokeColor: route.strokeColor,
        strokeOpacity: 0.45,
        strokeWeight: 3,
        map: this.map,
      });
      this.activePolylines.push(secondaryPoly);
    }

    if (!selectedRoute) return;

    // Compute exact road-snapped polyline for the focused route via Routes API (Route.computeRoutes)
    try {
      const routesLib = (await importLibrary('routes')) as unknown as {
        Route?: {
          computeRoutes: (req: unknown) => Promise<{
            routes?: Array<{
              distanceMeters?: number;
              durationMillis?: number;
              createPolylines?: (opts?: unknown) => google.maps.Polyline[];
            }>;
          }>;
        };
      };

      if (routesLib.Route?.computeRoutes) {
        const { routes: computed } = await routesLib.Route.computeRoutes({
          origin: selectedRoute.origin,
          destination: selectedRoute.destination,
          travelMode: 'DRIVING',
          fields: ['path', 'distanceMeters', 'durationMillis'],
        });

        const first = computed?.[0];
        if (first) {
          if (typeof first.distanceMeters === 'number') {
            this.routeDistanceText = `${(first.distanceMeters / 1000).toFixed(1)} km`;
          }
          if (typeof first.durationMillis === 'number') {
            this.routeDurationText = `${Math.max(1, Math.round(first.durationMillis / 60000))} mins`;
          }
          if (typeof first.createPolylines === 'function') {
            const polylines = first.createPolylines({
              polylineOptions: {
                strokeColor: selectedRoute.strokeColor,
                strokeWeight: 5,
                strokeOpacity: 0.9,
              },
            });
            for (const poly of polylines) {
              poly.setMap(this.map);
              this.activePolylines.push(poly);
            }
            return;
          }
        }
      }
    } catch (err) {
      console.warn('Routes API computeRoutes notice:', err);
    }

    // Fallback direct vector if Routes API throttled
    const directPoly = new this.mapsLib.Polyline({
      path: [selectedRoute.origin, selectedRoute.destination],
      strokeColor: selectedRoute.strokeColor,
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map: this.map,
    });
    this.activePolylines.push(directPoly);
  }
}
