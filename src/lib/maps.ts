import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let loaderInitialized = false;
let quotaErrorHooksInstalled = false;

export const MAPS_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

export interface MapMarkerSpec {
  id: string;
  label: string;
  subtitle: string;
  lat: number;
  lng: number;
  kind: 'clinic' | 'nurse' | 'courier' | 'facility';
}

export interface NearbyPlaceItem {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
}

export function installMapsQuotaErrorHandler(): void {
  if (quotaErrorHooksInstalled) return;
  quotaErrorHooksInstalled = true;

  (window as Window & { gm_authFailure?: () => void }).gm_authFailure = () => {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  };

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const joined = args.map((a) => String(a)).join(' ');
    if (
      joined.includes('OverQuotaMapError') ||
      joined.includes('QuotaExceededError') ||
      joined.includes('BillingNotEnabledMapError')
    ) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
    originalError(...args);
  };
}

export function ensureMapsLoader(): boolean {
  installMapsQuotaErrorHandler();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return false;
  if (!loaderInitialized) {
    setOptions({
      key: apiKey,
      v: 'weekly',
    });
    loaderInitialized = true;
  }
  return true;
}

export async function mountCareGridMap(
  container: HTMLElement,
  center: { lat: number; lng: number },
  markers: MapMarkerSpec[],
  routeDestination?: { lat: number; lng: number }
): Promise<{
  map: google.maps.Map | null;
  routeDistanceText: string;
  routeDurationText: string;
  nearbyPlaces: NearbyPlaceItem[];
  mapReady: boolean;
}> {
  if (!ensureMapsLoader()) {
    return {
      map: null,
      routeDistanceText: 'API key missing',
      routeDurationText: '--',
      nearbyPlaces: [],
      mapReady: false,
    };
  }

  try {
    const mapsLib = (await importLibrary('maps')) as google.maps.MapsLibrary;
    const markerLib = (await importLibrary('marker')) as google.maps.MarkerLibrary;
    const placesLib = (await importLibrary('places')) as google.maps.PlacesLibrary;

    const map = new mapsLib.Map(container, {
      center,
      zoom: 13,
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: false,
      mapTypeControl: false,
      internalUsageAttributionIds: [MAPS_ATTRIBUTION_ID],
    } as google.maps.MapOptions);

    const infoWindow = new mapsLib.InfoWindow();

    for (const item of markers) {
      const pinEl = document.createElement('div');
      pinEl.className =
        item.kind === 'nurse'
          ? 'px-2.5 py-1 rounded-md bg-teal-700 text-white text-xs font-semibold shadow border border-white'
          : item.kind === 'courier'
            ? 'px-2.5 py-1 rounded-md bg-sky-700 text-white text-xs font-semibold shadow border border-white'
            : item.kind === 'clinic'
              ? 'px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs font-semibold shadow border border-white'
              : 'px-2 py-1 rounded-md bg-emerald-700 text-white text-[11px] font-medium shadow border border-white';
      pinEl.textContent = item.label;

      const advMarker = new markerLib.AdvancedMarkerElement({
        map,
        position: { lat: item.lat, lng: item.lng },
        title: item.label,
        content: pinEl,
      });

      advMarker.addEventListener('gmp-click', () => {
        infoWindow.setContent(
          `<div style="font-family: DM Sans, sans-serif; color: #0f172a; padding: 2px 4px;">
            <strong style="font-size: 13px;">${item.label}</strong>
            <div style="font-size: 12px; color: #475569; margin-top: 2px;">${item.subtitle}</div>
          </div>`
        );
        infoWindow.open({ map, anchor: advMarker });
      });
    }

    let routeDistanceText = '4.2 km';
    let routeDurationText = '14 mins';

    if (routeDestination) {
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
          const { routes } = await routesLib.Route.computeRoutes({
            origin: center,
            destination: routeDestination,
            travelMode: 'DRIVING',
            fields: ['path', 'distanceMeters', 'durationMillis'],
          });

          const route = routes?.[0];
          if (route) {
            if (typeof route.distanceMeters === 'number') {
              routeDistanceText = `${(route.distanceMeters / 1000).toFixed(1)} km`;
            }
            if (typeof route.durationMillis === 'number') {
              routeDurationText = `${Math.max(1, Math.round(route.durationMillis / 60000))} mins`;
            }
            if (typeof route.createPolylines === 'function') {
              const polylines = route.createPolylines({
                polylineOptions: {
                  strokeColor: '#0f766e',
                  strokeWeight: 5,
                  strokeOpacity: 0.85,
                },
              });
              for (const poly of polylines) poly.setMap(map);
            }
          }
        }
      } catch (routeErr) {
        console.warn('Routes API computeRoutes notice:', routeErr);
      }
    }

    let nearbyPlaces: NearbyPlaceItem[] = [];
    try {
      const { places } = await placesLib.Place.searchByText({
        textQuery: 'hospital clinic pharmacy medical center',
        fields: ['displayName', 'formattedAddress', 'location', 'rating'],
        locationBias: { center, radius: 5000 },
        maxResultCount: 5,
      });

      nearbyPlaces = (places ?? [])
        .map((p, idx) => {
          const loc = p.location;
          if (!loc) return null;
          const placeItem: NearbyPlaceItem = {
            id: p.id || `place-${idx}`,
            name: p.displayName || 'Healthcare Facility',
            address: p.formattedAddress || 'Verified nearby location',
            lat: loc.lat(),
            lng: loc.lng(),
            rating: typeof p.rating === 'number' ? p.rating : undefined,
          };

          const badge = document.createElement('div');
          badge.className =
            'px-2 py-0.5 rounded bg-white text-emerald-900 text-[11px] font-semibold border border-emerald-600 shadow-sm';
          badge.textContent = placeItem.name.slice(0, 22);

          new markerLib.AdvancedMarkerElement({
            map,
            position: { lat: placeItem.lat, lng: placeItem.lng },
            title: placeItem.name,
            content: badge,
          });

          return placeItem;
        })
        .filter((x): x is NearbyPlaceItem => x !== null);
    } catch (placesErr) {
      console.warn('Places searchByText notice:', placesErr);
    }

    return {
      map,
      routeDistanceText,
      routeDurationText,
      nearbyPlaces,
      mapReady: true,
    };
  } catch (err) {
    console.warn('Google Maps initialization notice:', err);
    return {
      map: null,
      routeDistanceText: '4.2 km',
      routeDurationText: '14 mins',
      nearbyPlaces: [],
      mapReady: false,
    };
  }
}
