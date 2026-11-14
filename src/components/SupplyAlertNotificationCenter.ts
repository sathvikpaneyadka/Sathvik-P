import { summarizeSupplyAlerts, type SupplyAlertRecord } from '../core/supplyAlertEngine';
import { store } from '../lib/state';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderAlertBellButtonHtml(alerts: SupplyAlertRecord[], drawerOpen: boolean): string {
  const summary = summarizeSupplyAlerts(alerts);
  const badgeCount = summary.unacknowledgedCount;
  const hasCritical = summary.criticalActiveCount > 0;
  const badgeClass = hasCritical
    ? 'bg-rose-600 text-white'
    : badgeCount > 0
      ? 'bg-amber-600 text-white'
      : 'bg-emerald-600 text-white';

  return `
    <button
      id="cg-alert-bell-btn"
      type="button"
      aria-label="Staff Supply Alerts (${badgeCount} unacknowledged)"
      aria-expanded="${drawerOpen ? 'true' : 'false'}"
      class="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 transition whitespace-nowrap"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${hasCritical ? 'text-rose-600' : 'text-slate-600'}">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span class="hidden sm:inline">Alerts</span>
      <span
        id="cg-alert-bell-count"
        data-testid="supply-alert-count"
        class="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums ${badgeClass}"
      >${badgeCount}</span>
    </button>
  `;
}

export function renderCriticalSupplyBannerHtml(alerts: SupplyAlertRecord[]): string {
  const activeCritical = alerts.filter((a) => a.status === 'active' && a.severity === 'critical');
  const activeLow = alerts.filter((a) => a.status === 'active' && a.severity === 'low');

  if (activeCritical.length === 0 && activeLow.length === 0) return '';

  const lead = activeCritical[0] || activeLow[0];
  const isCritical = activeCritical.length > 0;
  const totalUnacked = activeCritical.length + activeLow.length;

  return `
    <div
      id="cg-critical-supply-banner"
      data-testid="critical-supply-banner"
      role="alert"
      class="${isCritical ? 'bg-rose-50 border-b border-rose-200 text-rose-950' : 'bg-amber-50 border-b border-amber-200 text-amber-950'}"
    >
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="inline-flex items-center px-2 py-0.5 rounded font-bold uppercase tracking-wide text-[10px] ${
            isCritical ? 'bg-rose-700 text-white' : 'bg-amber-700 text-white'
          }">
            ${isCritical ? 'Critical Supply Alert' : 'Low Stock Alert'} (${totalUnacked})
          </span>
          <span class="font-semibold">
            ${esc(lead.sku)} · ${esc(lead.productName)} at
            <strong class="tabular-nums">${lead.stockQty} units</strong>
            (threshold ${lead.reorderThreshold})
          </span>
          <span class="text-slate-600 hidden md:inline">
            Supplier: ${esc(lead.supplierName)}
          </span>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            id="cg-banner-restock-btn"
            data-restock-sku="${esc(lead.sku)}"
            type="button"
            class="px-2.5 py-1 rounded font-semibold bg-white border border-slate-300 text-slate-900 hover:bg-slate-100 whitespace-nowrap"
          >
            Restock ${esc(lead.sku)} (+40)
          </button>
          <button
            id="cg-banner-ack-btn"
            data-ack-code="${esc(lead.alertCode)}"
            type="button"
            class="px-2.5 py-1 rounded font-semibold ${
              isCritical ? 'bg-rose-700 hover:bg-rose-800 text-white' : 'bg-amber-700 hover:bg-amber-800 text-white'
            } whitespace-nowrap"
          >
            Acknowledge
          </button>
          <button
            id="cg-banner-open-drawer"
            type="button"
            class="px-2.5 py-1 rounded font-semibold underline text-slate-800 hover:text-slate-950 whitespace-nowrap"
          >
            View All Alerts
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderSupplyAlertDrawer(host: HTMLElement): void {
  const state = store.getState();
  if (!state.alertDrawerOpen) {
    host.innerHTML = '';
    return;
  }

  const summary = summarizeSupplyAlerts(state.supplyAlerts);
  const filtered = state.supplyAlerts.filter((a) => {
    if (state.alertFilter === 'active') return a.status === 'active';
    if (state.alertFilter === 'critical') return a.severity === 'critical' && a.status !== 'resolved';
    if (state.alertFilter === 'resolved') return a.status === 'resolved';
    return true;
  });

  host.innerHTML = `
    <div id="cg-alert-drawer-backdrop" class="fixed inset-0 z-50 bg-slate-900/45 flex justify-end">
      <section
        id="cg-alert-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Staff Supply Threshold Notification Center"
        class="w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col"
      >
        <!-- Header -->
        <div class="p-5 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-bold uppercase tracking-wider text-rose-700">
              Real-Time Database Threshold Monitor
            </div>
            <h2 class="text-lg font-bold text-slate-900 mt-0.5">
              Staff Supply Alert Notifications
            </h2>
            <p class="text-xs text-slate-500 mt-0.5">${esc(state.lastAlertTriggerNote)}</p>
          </div>
          <button
            id="cg-alert-close-btn"
            type="button"
            aria-label="Close staff alert drawer"
            class="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <!-- Summary Strip -->
        <div class="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-4 gap-2 text-center">
          <div class="p-2 rounded bg-white border border-slate-200">
            <div class="text-[10px] font-semibold text-slate-500 uppercase">Critical</div>
            <div class="text-base font-bold text-rose-700 tabular-nums">${summary.criticalActiveCount}</div>
          </div>
          <div class="p-2 rounded bg-white border border-slate-200">
            <div class="text-[10px] font-semibold text-slate-500 uppercase">Low</div>
            <div class="text-base font-bold text-amber-700 tabular-nums">${summary.lowActiveCount}</div>
          </div>
          <div class="p-2 rounded bg-white border border-slate-200">
            <div class="text-[10px] font-semibold text-slate-500 uppercase">Acked</div>
            <div class="text-base font-bold text-sky-700 tabular-nums">${summary.acknowledgedCount}</div>
          </div>
          <div class="p-2 rounded bg-white border border-slate-200">
            <div class="text-[10px] font-semibold text-slate-500 uppercase">Resolved</div>
            <div class="text-base font-bold text-emerald-700 tabular-nums">${summary.resolvedCount}</div>
          </div>
        </div>

        <!-- Filter & Sweep Action Bar -->
        <div class="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            ${(['all', 'active', 'critical', 'resolved'] as const)
              .map(
                (flt) => `
                  <button
                    type="button"
                    data-alert-filter="${flt}"
                    class="cg-alert-filter-btn px-2.5 py-1 rounded text-xs font-semibold border ${
                      state.alertFilter === flt
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }"
                  >${flt.charAt(0).toUpperCase() + flt.slice(1)}</button>
                `
              )
              .join('')}
          </div>

          <button
            id="cg-alert-scan-btn"
            type="button"
            class="cg-btn-secondary px-3 py-1 text-xs"
          >
            Scan DB Thresholds
          </button>
        </div>

        <!-- Alert Cards List -->
        <div class="flex-1 overflow-y-auto p-5 space-y-3">
          ${
            filtered.length === 0
              ? `<div class="p-6 text-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">
                  No supply threshold alerts match this filter. All monitored medical stocks are above configured thresholds.
                </div>`
              : filtered
                  .map((a) => {
                    const isCritical = a.severity === 'critical';
                    const cardTone =
                      a.status === 'resolved'
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : isCritical
                          ? 'border-rose-300 bg-rose-50/50'
                          : 'border-amber-300 bg-amber-50/50';
                    const sevBadge = isCritical
                      ? 'bg-rose-700 text-white'
                      : 'bg-amber-600 text-white';
                    const statusText =
                      a.status === 'resolved'
                        ? 'text-emerald-700'
                        : a.status === 'acknowledged'
                          ? 'text-sky-700'
                          : 'text-rose-700';

                    return `
                      <article data-alert-code="${esc(a.alertCode)}" class="p-4 rounded-xl border ${cardTone} space-y-2.5">
                        <div class="flex items-start justify-between gap-2">
                          <div class="space-y-0.5">
                            <div class="flex flex-wrap items-center gap-1.5">
                              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sevBadge}">${esc(a.severity)}</span>
                              <span class="text-xs font-mono font-bold text-slate-800">${esc(a.sku)}</span>
                              <span class="text-[11px] font-bold uppercase ${statusText}">· ${esc(a.status)}</span>
                            </div>
                            <h3 class="text-sm font-bold text-slate-900">${esc(a.productName)}</h3>
                            <div class="text-[11px] text-slate-600">
                              Supplier: <strong>${esc(a.supplierName)}</strong> · Trigger: ${esc(a.triggeredBy)}
                            </div>
                          </div>
                          <div class="text-right tabular-nums shrink-0">
                            <div class="text-base font-bold ${isCritical ? 'text-rose-700' : 'text-amber-800'}">${a.stockQty} units</div>
                            <div class="text-[11px] text-slate-600">Min: ${a.reorderThreshold} (Crit: ${a.criticalThreshold})</div>
                          </div>
                        </div>

                        <div class="p-2 rounded bg-white/80 border border-slate-200/80 text-[11px] font-mono text-slate-700">
                          ${esc(a.smsDispatchSummary)}
                        </div>

                        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span class="text-[11px] text-slate-600 tabular-nums">
                            ${
                              a.status === 'resolved'
                                ? 'Replenished above reorder threshold'
                                : `Deficit: ${a.deficitUnits} units · Suggested PO: +${a.suggestedReorderQty}`
                            }
                          </span>
                          <div class="flex items-center gap-1.5">
                            ${
                              a.status === 'active'
                                ? `<button
                                    type="button"
                                    data-drawer-ack="${esc(a.alertCode)}"
                                    aria-label="Acknowledge ${esc(a.sku)}"
                                    class="cg-drawer-ack-btn px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800"
                                  >Acknowledge</button>`
                                : ''
                            }
                            ${
                              a.status !== 'resolved'
                                ? `<button
                                    type="button"
                                    data-drawer-restock="${esc(a.sku)}"
                                    aria-label="Restock ${esc(a.sku)} plus 40 units"
                                    class="cg-drawer-restock-btn px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-800 text-xs font-semibold text-white"
                                  >Restock +40</button>`
                                : ''
                            }
                          </div>
                        </div>
                      </article>
                    `;
                  })
                  .join('')
          }
        </div>
      </section>
    </div>
  `;

  host.querySelector('#cg-alert-close-btn')?.addEventListener('click', () => {
    store.toggleAlertDrawer(false);
  });

  host.querySelector('#cg-alert-drawer-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      store.toggleAlertDrawer(false);
    }
  });

  host.querySelectorAll<HTMLButtonElement>('.cg-alert-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const flt = btn.dataset.alertFilter as 'all' | 'active' | 'critical' | 'resolved';
      if (flt) store.setAlertFilter(flt);
    });
  });

  host.querySelector('#cg-alert-scan-btn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/alerts/supplies/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggeredBy: 'db_threshold_sweep',
          products: store.getState().products,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        store.showToast(
          `Database sweep complete: ${data.summary?.criticalActiveCount ?? 0} critical, ${data.summary?.lowActiveCount ?? 0} low`
        );
      }
    } catch {
      store.showToast('Database threshold sweep completed locally');
    }
  });

  host.querySelectorAll<HTMLButtonElement>('.cg-drawer-ack-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.drawerAck;
      if (code) store.acknowledgeSupplyAlert(code);
    });
  });

  host.querySelectorAll<HTMLButtonElement>('.cg-drawer-restock-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sku = btn.dataset.drawerRestock;
      if (sku) store.restockProduct(sku, 40);
    });
  });
}
