import './index.css';
import {
  renderAlertBellButtonHtml,
  renderCriticalSupplyBannerHtml,
  renderSupplyAlertDrawer,
} from './components/SupplyAlertNotificationCenter';
import { getLocaleStrings, type SupportedLang } from './core/i18n';
import { subscribeAuthChanges, testFirestoreConnection } from './lib/firebase';
import { installMapsQuotaErrorHandler } from './lib/maps';
import { store, type ActiveTab } from './lib/state';
import { ClinicalQueueView } from './views/ClinicalQueueView';
import { DispatchMapView } from './views/DispatchMapView';
import { KeypadAdminView } from './views/KeypadAdminView';
import { OverviewView, type WorkspaceConfirmRequest } from './views/OverviewView';
import { SpatialXrView } from './views/SpatialXrView';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class CareGridAppShell {
  private root: HTMLElement;
  private pendingConfirm: WorkspaceConfirmRequest | null = null;
  private overviewView: OverviewView;
  private clinicalView = new ClinicalQueueView();
  private mapView = new DispatchMapView();
  private keypadView = new KeypadAdminView();
  private spatialView = new SpatialXrView();

  constructor(root: HTMLElement) {
    this.root = root;
    this.overviewView = new OverviewView((req) => {
      this.pendingConfirm = req;
      this.renderConfirmModal();
    });
  }

  init(): void {
    installMapsQuotaErrorHandler();
    window.addEventListener('gmp-quota-exceeded', () => {
      store.setQuotaExceeded(true);
    });

    subscribeAuthChanges((user) => {
      store.setAuthUser(user);
    });
    void testFirestoreConnection();
    store.initSupplyAlertMonitor();

    store.subscribe(() => this.render());
    window.setInterval(() => store.tickLiveTelemetry(), 20000);

    this.render();
  }

  private render(): void {
    const state = store.getState();
    const strings = getLocaleStrings(state.lang);

    const tabs: Array<{ id: ActiveTab; label: string }> = [
      { id: 'overview', label: strings.navOverview },
      { id: 'clinical', label: strings.navClinical },
      { id: 'map', label: strings.navMap },
      { id: 'keypad', label: strings.navKeypad },
      { id: 'spatial', label: strings.navSpatial },
    ];

    this.root.innerHTML = `
      <div class="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        ${
          state.quotaExceeded
            ? `<div id="gmp-quota-banner" class="sticky top-0 z-50 w-full bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-2.5 text-xs flex flex-wrap items-center justify-center gap-2 text-center">
                <span class="font-semibold">This app has reached its demo Maps quota.</span>
                <span>Add your own Google Maps Platform API key in project settings to continue using interactive Maps features.</span>
                <a
                  href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-bold underline text-amber-900"
                >Setup Guide</a>
              </div>`
            : ''
        }

        <!-- Sticky 3-Zone Top Navigation Bar -->
        <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <!-- Zone 1: Brand -->
            <div class="flex items-center gap-2.5 shrink-0">
              <div class="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-sm">
                CG
              </div>
              <div>
                <div class="text-sm font-bold text-slate-900 leading-none">CareGrid</div>
                <div class="text-[11px] text-slate-500 hidden sm:block mt-0.5">${esc(strings.brandSubtitle)}</div>
              </div>
            </div>

            <!-- Zone 2: Single-line Nav Links (Desktop) -->
            <nav class="hidden md:flex items-center gap-1" aria-label="Primary navigation">
              ${tabs
                .map((t) => {
                  const active = state.activeTab === t.id;
                  return `<button
                    data-tab="${t.id}"
                    class="nav-tab-btn whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }"
                  >${esc(t.label)}</button>`;
                })
                .join('')}
            </nav>

            <!-- Zone 3: Alert Notification Bell + Primary CTA -->
            <div class="shrink-0 flex items-center gap-2">
              ${renderAlertBellButtonHtml(state.supplyAlerts, state.alertDrawerOpen)}
              <button id="top-book-nurse-cta" class="cg-btn-primary px-3.5 py-2 text-xs whitespace-nowrap">
                ${esc(strings.primaryCta)}
              </button>
            </div>
          </div>

          <!-- Responsive Mobile Navigation Strip (Visible < md) -->
          <nav class="md:hidden border-t border-slate-100 px-3 py-2 flex flex-wrap items-center gap-1.5 bg-slate-50/70" aria-label="Mobile navigation">
            ${tabs
              .map((t) => {
                const active = state.activeTab === t.id;
                return `<button
                  data-tab="${t.id}"
                  class="nav-tab-btn whitespace-nowrap px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-700 border border-slate-200'
                  }"
                >${esc(t.label)}</button>`;
              })
              .join('')}
          </nav>
        </header>

        <!-- Sub-Toolbar: Isolated Profile ID + Global Multilingual Switcher -->
        <div class="bg-white border-b border-slate-200/80">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex flex-wrap items-center gap-3 text-slate-600">
              <span>Patient ID: <strong class="tabular-nums text-slate-900">${esc(state.profile.profileId)}</strong></span>
              <span class="text-slate-300">|</span>
              <span>${esc(state.profile.fullName)}</span>
              <span class="text-slate-300">|</span>
              <span class="${state.profile.otpVerified || state.profile.keypadPinVerified ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}">
                ${state.profile.otpVerified ? 'OTP Verified' : 'OTP Pending'} · ${state.profile.keypadPinVerified ? 'Keypad Verified' : 'Keypad Pending'}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <label for="global-lang-select" class="text-slate-500 font-medium">Language:</label>
              <select id="global-lang-select" class="border border-slate-300 rounded-md px-2 py-1 text-xs font-semibold bg-white text-slate-800">
                <option value="en" ${state.lang === 'en' ? 'selected' : ''}>English</option>
                <option value="hi" ${state.lang === 'hi' ? 'selected' : ''}>हिन्दी</option>
                <option value="es" ${state.lang === 'es' ? 'selected' : ''}>Español</option>
                <option value="ta" ${state.lang === 'ta' ? 'selected' : ''}>தமிழ்</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Real-Time Critical Supply Alert Banner -->
        ${renderCriticalSupplyBannerHtml(state.supplyAlerts)}

        <!-- Main Workspace Content -->
        <main id="caregrid-main-view" class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6"></main>

        ${
          state.toastMessage
            ? `<div id="cg-toast" class="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-medium shadow-lg border border-slate-700">
                ${esc(state.toastMessage)}
              </div>`
            : ''
        }

        <div id="cg-alert-drawer-host"></div>
        <div id="cg-modal-host"></div>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('.nav-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as ActiveTab;
        if (tab) store.setTab(tab);
      });
    });

    this.root.querySelector('#top-book-nurse-cta')?.addEventListener('click', () => {
      store.setTab('map');
    });

    this.root.querySelector('#cg-alert-bell-btn')?.addEventListener('click', () => {
      store.toggleAlertDrawer();
    });

    this.root.querySelector('#cg-banner-open-drawer')?.addEventListener('click', () => {
      store.toggleAlertDrawer(true);
    });

    this.root.querySelector('#cg-banner-ack-btn')?.addEventListener('click', (e) => {
      const code = (e.currentTarget as HTMLButtonElement).dataset.ackCode;
      if (code) store.acknowledgeSupplyAlert(code);
    });

    this.root.querySelector('#cg-banner-restock-btn')?.addEventListener('click', (e) => {
      const sku = (e.currentTarget as HTMLButtonElement).dataset.restockSku;
      if (sku) store.restockProduct(sku, 40);
    });

    this.root.querySelector('#global-lang-select')?.addEventListener('change', (e) => {
      const lang = (e.target as HTMLSelectElement).value as SupportedLang;
      store.setLanguage(lang);
    });

    const viewHost = this.root.querySelector('#caregrid-main-view') as HTMLElement | null;
    if (viewHost) {
      if (state.activeTab === 'overview') this.overviewView.render(viewHost);
      else if (state.activeTab === 'clinical') this.clinicalView.render(viewHost);
      else if (state.activeTab === 'map') this.mapView.render(viewHost);
      else if (state.activeTab === 'keypad') this.keypadView.render(viewHost);
      else if (state.activeTab === 'spatial') this.spatialView.render(viewHost);
    }

    const drawerHost = this.root.querySelector('#cg-alert-drawer-host') as HTMLElement | null;
    if (drawerHost) {
      renderSupplyAlertDrawer(drawerHost);
    }

    this.renderConfirmModal();
  }

  private renderConfirmModal(): void {
    const host = this.root.querySelector('#cg-modal-host') as HTMLElement | null;
    if (!host) return;
    if (!this.pendingConfirm) {
      host.innerHTML = '';
      return;
    }

    const req = this.pendingConfirm;
    host.innerHTML = `
      <div class="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
        <div class="cg-card max-w-md w-full p-5 space-y-4 shadow-xl">
          <div class="space-y-1">
            <h3 class="text-base font-bold text-slate-900">${esc(req.title)}</h3>
            <p class="text-xs text-slate-600 leading-relaxed">${esc(req.description)}</p>
          </div>
          <div class="flex items-center justify-end gap-2 pt-2">
            <button id="cg-modal-cancel" class="cg-btn-secondary px-3.5 py-2 text-xs">Cancel</button>
            <button id="cg-modal-confirm" class="cg-btn-primary px-4 py-2 text-xs">${esc(req.actionLabel)}</button>
          </div>
        </div>
      </div>
    `;

    host.querySelector('#cg-modal-cancel')?.addEventListener('click', () => {
      this.pendingConfirm = null;
      this.renderConfirmModal();
    });

    host.querySelector('#cg-modal-confirm')?.addEventListener('click', async () => {
      const fn = req.onConfirm;
      this.pendingConfirm = null;
      this.renderConfirmModal();
      await fn();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root') || document.body;
  const app = new CareGridAppShell(root);
  app.init();
});
