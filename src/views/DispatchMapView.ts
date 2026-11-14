import homeNurseImg from '../assets/images/home_nurse_care_1794657235941.jpg';
import { SupplyNurseDispatchMap } from '../components/SupplyNurseDispatchMap';
import type { NearbyPlaceItem } from '../lib/maps';
import { store } from '../lib/state';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface GroundedPlace {
  title: string;
  uri: string;
  placeId: string;
}

export class DispatchMapView {
  private nearbyPlaces: NearbyPlaceItem[] = [];
  private groundedText = '';
  private groundedPlaces: GroundedPlace[] = [];
  private groundingBusy = false;
  private mapComponent: SupplyNurseDispatchMap;
  private activeContainer: HTMLElement | null = null;

  constructor() {
    this.mapComponent = new SupplyNurseDispatchMap({
      onNearbyPlaces: (places) => {
        this.nearbyPlaces = places;
        if (this.activeContainer) {
          this.renderNearbyList(this.activeContainer);
        }
      },
    });
  }

  render(container: HTMLElement): void {
    this.activeContainer = container;
    const state = store.getState();

    container.innerHTML = `
      <div class="space-y-6">
        <!-- Header Row + Booking Form + Supply/Nurse Map Component -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <!-- Home Nurse Booking Form -->
          <div class="lg:col-span-5 cg-card p-5 space-y-4">
            <div class="flex items-center gap-3">
              <img src="${homeNurseImg}" alt="Registered home care nurse" class="w-16 h-16 rounded-lg object-cover border border-slate-200" referrerpolicy="no-referrer" />
              <div>
                <h2 class="text-base font-bold text-slate-900">Book a Registered Home Nurse</h2>
                <p class="text-xs text-slate-500">Immediate clinical home dispatch synced to live GPS &amp; SQL tracking</p>
              </div>
            </div>

            <form id="dm-nurse-form" class="space-y-2.5">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Assign Nurse Specialist</label>
                <select id="dm-nurse-name" class="cg-input text-xs">
                  <option value="RN Priya Menon">RN Priya Menon · Respiratory &amp; IV Care</option>
                  <option value="RN Arjun Nair">RN Arjun Nair · Post-Op Wound Care</option>
                  <option value="RN Elena Cruz">RN Elena Cruz · Geriatric Vitals &amp; Insulin</option>
                </select>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Care Procedure</label>
                  <input id="dm-service-type" type="text" value="IV Hydration &amp; Vitals Check" class="cg-input text-xs" required />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Preferred Window</label>
                  <input id="dm-slot" type="text" value="16:30 Today" class="cg-input text-xs" required />
                </div>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Delivery / Care Address</label>
                <input id="dm-address" type="text" value="14 Residency Lane, Indiranagar" class="cg-input text-xs" required />
              </div>
              <button type="submit" class="cg-btn-primary w-full py-2 text-xs">
                Dispatch Home Nurse &amp; Start Live GPS
              </button>
            </form>
          </div>

          <!-- Dedicated Google Maps Supply Delivery Routes & Nurse Dispatch Component -->
          <div id="dm-map-component-host" class="lg:col-span-7"></div>
        </section>

        <!-- Active Nurse Visits & Supply Orders + Gemini Maps Grounding -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900">Active Dispatches &amp; Order Tracking</h3>
              <button id="dm-tick-btn" class="cg-btn-secondary px-3 py-1 text-xs">Advance Live ETA</button>
            </div>

            <div class="space-y-2.5">
              ${state.nurseBookings
                .map(
                  (b) => `
                  <div class="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <div>
                      <div class="text-xs font-bold text-teal-800 tabular-nums">${esc(b.bookingCode)} · HOME NURSE</div>
                      <div class="text-sm font-bold text-slate-900">${esc(b.nurseName)}</div>
                      <div class="text-xs text-slate-600">${esc(b.serviceType)} · ${esc(b.address)}</div>
                    </div>
                    <div class="text-right tabular-nums">
                      <div class="text-base font-bold text-slate-900">${b.etaMinutes} min</div>
                      <div class="text-[11px] text-emerald-700 font-semibold uppercase">${esc(b.status)}</div>
                    </div>
                  </div>
                `
                )
                .join('')}

              ${state.orders
                .map(
                  (o) => `
                  <div class="p-3.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between gap-3">
                    <div>
                      <div class="text-xs font-bold text-sky-700 tabular-nums">${esc(o.orderCode)} · SUPPLY ORDER</div>
                      <div class="text-sm font-bold text-slate-900">${esc(o.itemSummary)}</div>
                      <div class="text-xs text-slate-600">${esc(o.destAddress)} · $${(o.totalCents / 100).toFixed(0)}</div>
                    </div>
                    <div class="text-right tabular-nums">
                      <div class="text-base font-bold text-slate-900">${o.etaMinutes} min</div>
                      <div class="text-[11px] text-sky-700 font-semibold uppercase">${esc(o.status)}</div>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>
          </div>

          <!-- Gemini Google Maps Grounding + Nearby Places -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div>
              <h3 class="text-base font-bold text-slate-900">Verified Nearby Pharmacies &amp; Clinics</h3>
              <p class="text-xs text-slate-500">Live Google Places discovery &amp; Gemini Google Maps Grounding (no patient PII sent)</p>
            </div>

            <form id="dm-grounding-form" class="flex gap-2">
              <input id="dm-grounding-query" type="text" value="24 hour pharmacies and diagnostic clinics near Indiranagar" class="cg-input text-xs flex-1" />
              <button type="submit" class="cg-btn-primary px-4 py-2 text-xs whitespace-nowrap" ${this.groundingBusy ? 'disabled' : ''}>
                ${this.groundingBusy ? 'Searching...' : 'Ask Maps AI'}
              </button>
            </form>

            ${
              this.groundedText
                ? `<div class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 space-y-2">
                    <p>${esc(this.groundedText)}</p>
                    ${
                      this.groundedPlaces.length > 0
                        ? `<div class="flex flex-wrap gap-2 pt-1">
                            ${this.groundedPlaces
                              .map(
                                (pl) => `<a href="${esc(pl.uri)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-teal-700 underline">${esc(pl.title)}</a>`
                              )
                              .join('')}
                           </div>`
                        : ''
                    }
                    <div class="text-[10px] text-slate-500">Source: Google Maps Grounding</div>
                   </div>`
                : ''
            }

            <div id="dm-nearby-list" class="space-y-2 max-h-48 overflow-y-auto"></div>
          </div>
        </section>
      </div>
    `;

    this.renderNearbyList(container);
    this.bindEvents(container);

    const mapHost = container.querySelector('#dm-map-component-host') as HTMLElement | null;
    if (mapHost) {
      this.mapComponent.render(mapHost);
    }
  }

  private renderNearbyList(container: HTMLElement): void {
    const listEl = container.querySelector('#dm-nearby-list');
    if (!listEl) return;
    listEl.innerHTML =
      this.nearbyPlaces.length > 0
        ? this.nearbyPlaces
            .map(
              (pl) => `
              <div class="p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2 text-xs">
                <div>
                  <div class="font-semibold text-slate-900">${esc(pl.name)}</div>
                  <div class="text-[11px] text-slate-500">${esc(pl.address)}</div>
                </div>
                ${pl.rating ? `<span class="tabular-nums font-semibold text-amber-700">${pl.rating.toFixed(1)}</span>` : ''}
              </div>
            `
            )
            .join('')
        : `<div class="text-xs text-slate-500">Loading nearby medical facilities from Google Places API...</div>`;
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelector('#dm-nurse-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const nurseName = (container.querySelector('#dm-nurse-name') as HTMLSelectElement).value;
      const serviceType = (container.querySelector('#dm-service-type') as HTMLInputElement).value;
      const scheduledSlot = (container.querySelector('#dm-slot') as HTMLInputElement).value;
      const address = (container.querySelector('#dm-address') as HTMLInputElement).value;
      store.bookHomeNurse({ nurseName, serviceType, scheduledSlot, address });
    });

    container.querySelector('#dm-tick-btn')?.addEventListener('click', () => {
      const mapHost = container.querySelector('#dm-map-component-host') as HTMLElement | null;
      if (mapHost) {
        void this.mapComponent.syncFromSqlAndStep(mapHost, true);
      } else {
        store.tickLiveTelemetry();
      }
    });

    container.querySelector('#dm-grounding-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = (container.querySelector('#dm-grounding-query') as HTMLInputElement).value;
      this.groundingBusy = true;
      this.render(container);
      try {
        const res = await fetch('/api/ai/maps-grounding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, latitude: 12.9716, longitude: 77.5946 }),
        });
        const data = (await res.json()) as {
          text?: string;
          places?: GroundedPlace[];
          error?: string;
        };
        if (res.ok) {
          this.groundedText = data.text || 'Verified facilities returned.';
          this.groundedPlaces = data.places || [];
        } else {
          this.groundedText = data.error || 'Maps grounding unavailable.';
        }
      } catch {
        this.groundedText = 'Could not reach Maps grounding endpoint.';
      } finally {
        this.groundingBusy = false;
        this.render(container);
      }
    });
  }
}
