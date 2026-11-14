import triageHeroImg from '../assets/images/clinical_triage_hub_1794657235089.jpg';
import homeNurseImg from '../assets/images/home_nurse_care_1794657235941.jpg';
import infusionKitImg from '../assets/images/smart_infusion_kit_1794657235862.jpg';
import coldChainImg from '../assets/images/supply_cold_chain_1794657236085.jpg';
import { computeInventorySummary, getStockHealth } from '../core/queueSupplyRules';
import { signInWithGoogleWorkspace, signOutAccount } from '../lib/firebase';
import { store } from '../lib/state';
import {
  createCareSummaryDoc,
  fetchChatSpaces,
  fetchContacts,
  fetchDriveFiles,
  fetchRecentEmails,
  postChatMessage,
  sendCareEmail,
} from '../lib/workspace';

export interface WorkspaceConfirmRequest {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function productImageForSku(sku: string): string {
  if (sku.includes('INF')) return infusionKitImg;
  if (sku.includes('CLD')) return coldChainImg;
  if (sku.includes('HMC')) return homeNurseImg;
  return triageHeroImg;
}

export class OverviewView {
  private tierFilter: 'all' | 'small' | 'enterprise' = 'all';
  private workspaceOutput = 'Sign in with Google Workspace to inspect Drive files, Gmail threads, Contacts, or push a Clinical Care Summary Doc.';
  private workspaceLoading = false;
  private onConfirmWorkspace: (req: WorkspaceConfirmRequest) => void;

  constructor(onConfirmWorkspace: (req: WorkspaceConfirmRequest) => void) {
    this.onConfirmWorkspace = onConfirmWorkspace;
  }

  render(container: HTMLElement): void {
    const state = store.getState();
    const invSummary = computeInventorySummary(state.products);
    const weeklyTotal = state.salesWeekly.reduce((acc, d) => acc + d.clinicSalesUsd + d.homeCareUsd, 0);
    const filteredProducts =
      this.tierFilter === 'all'
        ? state.products
        : state.products.filter((p) => p.businessTier === this.tierFilter || p.businessTier === 'all');

    const activeTicket = state.queueTickets[0];
    const openEscalations = state.complaints.filter((c) => c.status !== 'resolved').length;

    const maxBarVal = Math.max(
      1000,
      ...state.salesWeekly.map((d) => d.clinicSalesUsd + d.homeCareUsd)
    );

    const chartBarsHtml = state.salesWeekly
      .map((d, i) => {
        const total = d.clinicSalesUsd + d.homeCareUsd;
        const barH = Math.round((total / maxBarVal) * 124);
        const homeH = Math.round((d.homeCareUsd / maxBarVal) * 124);
        const x = 18 + i * 64;
        return `
          <g transform="translate(${x}, 0)">
            <rect x="0" y="${138 - barH}" width="26" height="${barH}" rx="4" fill="#0f766e" />
            <rect x="28" y="${138 - homeH}" width="14" height="${homeH}" rx="3" fill="#0284c7" />
            <text x="21" y="156" text-anchor="middle" font-size="11" fill="#64748b">${esc(d.day)}</text>
          </g>
        `;
      })
      .join('');

    container.innerHTML = `
      <div class="space-y-6">
        <!-- Hero Banner -->
        <section class="cg-card overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          <div class="lg:col-span-7 p-6 lg:p-8 flex flex-col justify-between gap-5">
            <div class="space-y-2.5">
              <div class="text-xs font-semibold uppercase tracking-wider text-teal-700">
                CareGrid Unified Operations · HIPAA-Aligned Workspace
              </div>
              <h2 class="text-2xl lg:text-3xl font-bold text-slate-900 leading-tight">
                Clinical Communication, Smart Queue &amp; Medical Supply Chain
              </h2>
              <p class="text-sm text-slate-600 max-w-2xl leading-relaxed">
                Software-only healthcare platform connecting doctors, patients, home nurses, medical suppliers, and non-smartphone keypad users with synchronized real-time dispatch.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2.5">
              <button id="ov-go-clinical" class="cg-btn-primary px-4 py-2 text-xs sm:text-sm whitespace-nowrap">
                Start Clinical Triage
              </button>
              <button id="ov-go-map" class="cg-btn-secondary px-4 py-2 text-xs sm:text-sm whitespace-nowrap">
                Track Dispatch Map
              </button>
              <button id="ov-go-keypad" class="cg-btn-secondary px-4 py-2 text-xs sm:text-sm whitespace-nowrap">
                SMS &amp; Keypad IVR
              </button>
            </div>
          </div>
          <div class="lg:col-span-5 relative min-h-[220px] bg-slate-900">
            <img
              src="${triageHeroImg}"
              alt="CareGrid digital healthcare command workstation"
              class="w-full h-full object-cover"
              referrerpolicy="no-referrer"
            />
          </div>
        </section>

        <!-- 4-Column KPI Strip -->
        <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="cg-card p-5">
            <div class="text-xs font-medium text-slate-500">Inventory Valuation</div>
            <div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
              $${(invSummary.totalValuationCents / 100).toLocaleString()}
            </div>
            <div class="mt-1 text-xs text-slate-600 tabular-nums">
              ${invSummary.totalUnits} units across ${invSummary.skuCount} SKUs · ${invSummary.lowStockCount + invSummary.criticalCount} alerts
            </div>
          </div>

          <div class="cg-card p-5">
            <div class="text-xs font-medium text-slate-500">7-Day Supply &amp; Care Revenue</div>
            <div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
              $${weeklyTotal.toLocaleString()}
            </div>
            <div class="mt-1 text-xs text-emerald-700 font-medium">
              Small clinics &amp; enterprise cold-chain synchronized
            </div>
          </div>

          <div class="cg-card p-5">
            <div class="text-xs font-medium text-slate-500">Active Smart Queue Slot</div>
            <div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
              ${activeTicket ? esc(activeTicket.slotTime) : '--:--'}
            </div>
            <div class="mt-1 text-xs text-slate-600 truncate">
              ${activeTicket ? `${esc(activeTicket.roomLocation)} · ${esc(activeTicket.photoTag)}` : 'No active slot booked'}
            </div>
          </div>

          <div class="cg-card p-5">
            <div class="text-xs font-medium text-slate-500">Supervisor Escalations</div>
            <div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
              ${openEscalations} Open
            </div>
            <div class="mt-1 text-xs text-slate-600">
              Auto-routed from SMS / IVR button 9
            </div>
          </div>
        </section>

        <!-- Sales Analytics + Inventory Management -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Sales Analytics Chart -->
          <div class="lg:col-span-5 cg-card p-5 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between gap-2">
                <div>
                  <h3 class="text-base font-bold text-slate-900">Real-Time Sales Analytics</h3>
                  <p class="text-xs text-slate-500">Clinic B2B orders vs. home nurse care revenue</p>
                </div>
                <span class="text-xs font-semibold text-teal-700 tabular-nums">Live Sync</span>
              </div>
              <div class="mt-4">
                <svg viewBox="0 0 470 166" class="w-full h-44" role="img" aria-label="Weekly healthcare sales analytics chart">
                  <line x1="10" y1="138" x2="460" y2="138" stroke="#e2e8f0" stroke-width="1" />
                  <line x1="10" y1="74" x2="460" y2="74" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4 4" />
                  ${chartBarsHtml}
                </svg>
              </div>
            </div>
            <div class="flex items-center gap-5 text-xs text-slate-600 pt-2 border-t border-slate-100">
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block"></span>
                Clinic Supply Orders
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-sm bg-sky-600 inline-block"></span>
                Home Nurse Care
              </span>
            </div>
          </div>

          <!-- Inventory Tracking Table -->
          <div class="lg:col-span-7 cg-card p-5">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 class="text-base font-bold text-slate-900">Inventory &amp; Supply-Chain Stock</h3>
                <p class="text-xs text-slate-500">Filter by clinic tier, dispatch supply orders, or trigger restock</p>
              </div>
              <div class="flex items-center gap-1.5">
                <button data-tier="all" class="ov-tier-btn px-2.5 py-1 text-xs font-medium rounded-md border ${this.tierFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}">All</button>
                <button data-tier="small" class="ov-tier-btn px-2.5 py-1 text-xs font-medium rounded-md border ${this.tierFilter === 'small' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}">Small Business</button>
                <button data-tier="enterprise" class="ov-tier-btn px-2.5 py-1 text-xs font-medium rounded-md border ${this.tierFilter === 'enterprise' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}">Enterprise</button>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead>
                  <tr class="border-b border-slate-200 text-slate-500 font-semibold">
                    <th class="pb-2.5 pr-3">Product &amp; SKU</th>
                    <th class="pb-2.5 pr-3">Stock</th>
                    <th class="pb-2.5 pr-3">Threshold</th>
                    <th class="pb-2.5 pr-3">Unit Price</th>
                    <th class="pb-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${filteredProducts
                    .map((p) => {
                      const health = getStockHealth(p);
                      const healthText =
                        health === 'critical'
                          ? 'text-rose-700 font-semibold'
                          : health === 'low'
                            ? 'text-amber-700 font-semibold'
                            : 'text-emerald-700 font-medium';
                      const healthBadge =
                        health === 'critical'
                          ? ' · CRITICAL'
                          : health === 'low'
                            ? ' · LOW'
                            : '';
                      return `
                        <tr>
                          <td class="py-3 pr-3">
                            <div class="font-semibold text-slate-900">${esc(p.name)}</div>
                            <div class="text-[11px] text-slate-500">${esc(p.sku)} · ${esc(p.supplierName)} · ${p.ratingAvg.toFixed(1)}/5</div>
                          </td>
                          <td class="py-3 pr-3 tabular-nums">
                            <span class="${healthText}">${p.stockQty} units${healthBadge}</span>
                          </td>
                          <td class="py-3 pr-3 tabular-nums">
                            <div class="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="999"
                                value="${p.reorderThreshold}"
                                aria-label="Reorder threshold for ${esc(p.sku)}"
                                data-threshold-sku="${esc(p.sku)}"
                                class="ov-threshold-input w-14 border border-slate-300 rounded px-1.5 py-0.5 text-xs text-slate-800 bg-white tabular-nums"
                              />
                              <button
                                type="button"
                                data-apply-threshold-sku="${esc(p.sku)}"
                                aria-label="Save threshold for ${esc(p.sku)}"
                                class="ov-apply-threshold-btn px-2 py-0.5 text-[11px] font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                              >Set</button>
                            </div>
                          </td>
                          <td class="py-3 pr-3 tabular-nums font-medium text-slate-800">
                            $${(p.priceCents / 100).toFixed(0)}
                          </td>
                          <td class="py-3 text-right space-x-1 whitespace-nowrap">
                            <button data-consume-sku="${esc(p.sku)}" aria-label="Consume 10 units of ${esc(p.sku)}" class="ov-consume-btn px-2 py-1 text-xs font-medium rounded border border-rose-200 text-rose-700 hover:bg-rose-50">
                              Use -10
                            </button>
                            <button data-order-sku="${esc(p.sku)}" aria-label="Order 2 units of ${esc(p.sku)}" class="ov-order-btn px-2.5 py-1 text-xs font-semibold rounded bg-teal-700 text-white hover:bg-teal-800">
                              Order 2
                            </button>
                            <button data-restock-sku="${esc(p.sku)}" aria-label="Restock 40 units of ${esc(p.sku)}" class="ov-restock-btn px-2.5 py-1 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-100">
                              Restock +40
                            </button>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Product Showcase Cards + Verified Customer Reviews -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-7 cg-card p-5 space-y-4">
            <div>
              <h3 class="text-base font-bold text-slate-900">Medical Supply Solutions &amp; Reviews</h3>
              <p class="text-xs text-slate-500">Hardware-free software oversight for cold-chain carriers, infusion kits, and home nursing bundles</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              ${state.products
                .slice(0, 4)
                .map(
                  (p) => `
                  <div class="border border-slate-200 rounded-lg overflow-hidden bg-white flex flex-col">
                    <div class="h-32 bg-slate-100 overflow-hidden">
                      <img src="${productImageForSku(p.sku)}" alt="${esc(p.name)}" class="w-full h-full object-cover" referrerpolicy="no-referrer" />
                    </div>
                    <div class="p-3.5 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <div class="text-xs font-semibold text-teal-700 tabular-nums">${esc(p.sku)} · $${(p.priceCents / 100).toFixed(0)}</div>
                        <div class="text-sm font-bold text-slate-900 mt-0.5">${esc(p.name)}</div>
                      </div>
                      <div class="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
                        <span class="tabular-nums font-semibold">${p.ratingAvg.toFixed(1)} / 5.0</span>
                        <span>${p.reviewCount} reviews</span>
                      </div>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>
          </div>

          <!-- Verified Reviews Feed & Submit Form -->
          <div class="lg:col-span-5 cg-card p-5 space-y-4">
            <h3 class="text-base font-bold text-slate-900">Verified Clinical &amp; Business Reviews</h3>
            <div class="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              ${state.reviews
                .slice(0, 5)
                .map(
                  (rev) => `
                  <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div class="flex items-center justify-between text-xs">
                      <span class="font-semibold text-slate-900">${esc(rev.authorName)} · ${esc(rev.businessType)}</span>
                      <span class="tabular-nums font-bold text-amber-700">${rev.rating}/5</span>
                    </div>
                    <p class="mt-1 text-xs text-slate-700">${esc(rev.comment)}</p>
                    <div class="mt-1 text-[11px] text-slate-500">SKU ${esc(rev.productSku)} · ${esc(rev.createdAt)}</div>
                  </div>
                `
                )
                .join('')}
            </div>

            <form id="ov-review-form" class="pt-3 border-t border-slate-200 space-y-2.5">
              <div class="text-xs font-semibold text-slate-800">Add Verified Supply Review</div>
              <div class="grid grid-cols-2 gap-2">
                <select id="ov-rev-sku" class="cg-input text-xs">
                  ${state.products.map((p) => `<option value="${esc(p.sku)}">${esc(p.sku)} · ${esc(p.name)}</option>`).join('')}
                </select>
                <select id="ov-rev-rating" class="cg-input text-xs">
                  <option value="5">5 / 5 Excellent</option>
                  <option value="4">4 / 5 Reliable</option>
                  <option value="3">3 / 5 Satisfactory</option>
                </select>
              </div>
              <input id="ov-rev-comment" type="text" placeholder="Share delivery speed or clinical quality feedback..." class="cg-input text-xs" required />
              <button type="submit" class="cg-btn-primary w-full py-2 text-xs">Publish Review</button>
            </form>
          </div>
        </section>

        <!-- Supplier Communication & Google Workspace Collaboration -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Integrated Supplier Communication -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div>
              <h3 class="text-base font-bold text-slate-900">Integrated Supplier Communication</h3>
              <p class="text-xs text-slate-500">Direct procurement dispatch for small clinics and enterprise cold-chain hubs</p>
            </div>
            <div class="space-y-2.5 max-h-52 overflow-y-auto pr-1">
              ${state.supplierMessages
                .map(
                  (msg) => `
                  <div class="p-3 rounded-lg border ${msg.direction === 'outbound' ? 'bg-teal-50/60 border-teal-200' : 'bg-slate-50 border-slate-200'}">
                    <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                      <span>${esc(msg.supplierName)} (${esc(msg.businessTier)})</span>
                      <span class="tabular-nums text-slate-500">${esc(msg.createdAt)}</span>
                    </div>
                    <p class="mt-1 text-xs text-slate-800">${esc(msg.body)}</p>
                  </div>
                `
                )
                .join('')}
            </div>
            <form id="ov-supplier-form" class="space-y-2 pt-2 border-t border-slate-200">
              <div class="grid grid-cols-2 gap-2">
                <select id="ov-sup-name" class="cg-input text-xs">
                  <option value="MedVantage Cold-Chain">MedVantage Cold-Chain</option>
                  <option value="BioFrost Logistics">BioFrost Logistics</option>
                  <option value="CareSource Direct">CareSource Direct</option>
                </select>
                <select id="ov-sup-tier" class="cg-input text-xs">
                  <option value="small">Small Medical Business</option>
                  <option value="enterprise">Large Enterprise Hub</option>
                </select>
              </div>
              <div class="flex gap-2">
                <input id="ov-sup-msg" type="text" placeholder="Message supplier about batch ETA or stock allocation..." class="cg-input text-xs flex-1" required />
                <button type="submit" class="cg-btn-primary px-4 py-2 text-xs whitespace-nowrap">Send Note</button>
              </div>
            </form>
          </div>

          <!-- Google Workspace Integration -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-base font-bold text-slate-900">Google Workspace Clinical Sync</h3>
                <p class="text-xs text-slate-500">Authorize Drive, Gmail, Docs, Chat &amp; Contacts via client-side OAuth</p>
              </div>
              ${
                state.currentUser
                  ? `<div class="flex items-center gap-2">
                      <span class="text-xs font-medium text-emerald-700">${esc(state.currentUser.email || state.currentUser.displayName || 'Connected')}</span>
                      <button id="ov-g-signout" class="cg-btn-secondary px-2.5 py-1 text-xs">Sign Out</button>
                    </div>`
                  : `<button id="ov-g-signin" class="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 shadow-xs">
                      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/>
                        <path fill="#34A853" d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.1.74-2.51 1.18-4.22 1.18-3.24 0-5.99-2.19-6.97-5.13H1.03v3.14C3.04 21.18 7.21 24 12 24Z"/>
                        <path fill="#FBBC05" d="M5.03 14.04c-.25-.74-.39-1.54-.39-2.36 0-.82.14-1.62.39-2.36V6.18H1.03C.37 7.5 0 9.01 0 11.68s.37 4.18 1.03 5.5l4-3.14Z"/>
                        <path fill="#EA4335" d="M12 4.75c1.79 0 3.4.62 4.67 1.83l3.5-3.5C18.07 1.19 15.3 0 12 0 7.21 0 3.04 2.82 1.03 6.18l4 3.14c.98-2.94 3.73-5.13 6.97-5.13Z"/>
                      </svg>
                      <span>Sign in with Google</span>
                    </button>`
              }
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button id="ws-drive-btn" class="cg-btn-secondary py-2 px-3 text-xs">Read Drive Files</button>
              <button id="ws-gmail-btn" class="cg-btn-secondary py-2 px-3 text-xs">Read Gmail Inbox</button>
              <button id="ws-contacts-btn" class="cg-btn-secondary py-2 px-3 text-xs">Read Contacts</button>
              <button id="ws-chat-btn" class="cg-btn-secondary py-2 px-3 text-xs">List Chat Spaces</button>
              <button id="ws-doc-create-btn" class="cg-btn-primary py-2 px-3 text-xs">Create Summary Doc</button>
              <button id="ws-email-send-btn" class="cg-btn-primary py-2 px-3 text-xs">Email Care Summary</button>
            </div>

            <div class="p-3 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono whitespace-pre-wrap min-h-[108px] max-h-40 overflow-y-auto">
${this.workspaceLoading ? 'Contacting Google Workspace API...' : esc(this.workspaceOutput)}
            </div>
          </div>
        </section>
      </div>
    `;

    this.bindEvents(container);
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelector('#ov-go-clinical')?.addEventListener('click', () => store.setTab('clinical'));
    container.querySelector('#ov-go-map')?.addEventListener('click', () => store.setTab('map'));
    container.querySelector('#ov-go-keypad')?.addEventListener('click', () => store.setTab('keypad'));

    container.querySelectorAll<HTMLButtonElement>('.ov-tier-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tier = btn.dataset.tier as 'all' | 'small' | 'enterprise';
        this.tierFilter = tier || 'all';
        this.render(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.ov-consume-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.consumeSku;
        if (sku) store.consumeSupplyUnits(sku, 10);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.ov-apply-threshold-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.applyThresholdSku;
        if (!sku) return;
        const input = container.querySelector<HTMLInputElement>(
          `.ov-threshold-input[data-threshold-sku="${sku}"]`
        );
        const val = Number(input?.value || '25');
        if (Number.isFinite(val) && val > 0) {
          store.updateSupplyThreshold(sku, val);
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.ov-order-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.orderSku;
        if (sku) store.placeSupplyOrder(sku, 2, 'CareGrid Partner Clinic #12');
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.ov-restock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.restockSku;
        if (sku) store.restockProduct(sku, 40);
      });
    });

    container.querySelector('#ov-review-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const sku = (container.querySelector('#ov-rev-sku') as HTMLSelectElement)?.value;
      const rating = Number((container.querySelector('#ov-rev-rating') as HTMLSelectElement)?.value || '5');
      const comment = (container.querySelector('#ov-rev-comment') as HTMLInputElement)?.value || '';
      if (sku && comment.trim()) {
        const state = store.getState();
        store.submitProductReview(sku, state.profile.fullName, 'Partner Healthcare Facility', rating, comment);
      }
    });

    container.querySelector('#ov-supplier-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (container.querySelector('#ov-sup-name') as HTMLSelectElement)?.value;
      const tier = (container.querySelector('#ov-sup-tier') as HTMLSelectElement)?.value as 'small' | 'enterprise';
      const body = (container.querySelector('#ov-sup-msg') as HTMLInputElement)?.value || '';
      if (name && body.trim()) {
        store.sendSupplierMessage(name, tier, body);
      }
    });

    container.querySelector('#ov-g-signin')?.addEventListener('click', async () => {
      try {
        const { user } = await signInWithGoogleWorkspace();
        store.setAuthUser(user);
        this.workspaceOutput = `Signed in as ${user.email}. Google Workspace OAuth scopes active in memory.`;
        this.render(container);
      } catch (err) {
        this.workspaceOutput = err instanceof Error ? err.message : 'Google sign-in cancelled.';
        this.render(container);
      }
    });

    container.querySelector('#ov-g-signout')?.addEventListener('click', async () => {
      await signOutAccount();
      store.setAuthUser(null);
      this.workspaceOutput = 'Signed out of Google Workspace.';
      this.render(container);
    });

    container.querySelector('#ws-drive-btn')?.addEventListener('click', async () => {
      this.workspaceLoading = true;
      this.render(container);
      try {
        const files = await fetchDriveFiles();
        this.workspaceOutput = files.length
          ? files.map((f) => `• ${f.name} (${f.mimeType})`).join('\n')
          : 'No Drive files returned.';
      } catch (err) {
        this.workspaceOutput = err instanceof Error ? err.message : 'Drive error';
      } finally {
        this.workspaceLoading = false;
        this.render(container);
      }
    });

    container.querySelector('#ws-gmail-btn')?.addEventListener('click', async () => {
      this.workspaceLoading = true;
      this.render(container);
      try {
        const emails = await fetchRecentEmails();
        this.workspaceOutput = emails.length
          ? emails.map((m) => `• ${m.subject}\n  From: ${m.from}`).join('\n')
          : 'Inbox is empty.';
      } catch (err) {
        this.workspaceOutput = err instanceof Error ? err.message : 'Gmail error';
      } finally {
        this.workspaceLoading = false;
        this.render(container);
      }
    });

    container.querySelector('#ws-contacts-btn')?.addEventListener('click', async () => {
      this.workspaceLoading = true;
      this.render(container);
      try {
        const contacts = await fetchContacts();
        this.workspaceOutput = contacts.length
          ? contacts.map((c) => `• ${c.name} ${c.email || c.phone}`).join('\n')
          : 'No Google Contacts found.';
      } catch (err) {
        this.workspaceOutput = err instanceof Error ? err.message : 'Contacts error';
      } finally {
        this.workspaceLoading = false;
        this.render(container);
      }
    });

    container.querySelector('#ws-chat-btn')?.addEventListener('click', async () => {
      this.workspaceLoading = true;
      this.render(container);
      try {
        const { spaces, setupNotice } = await fetchChatSpaces();
        if (setupNotice) {
          this.workspaceOutput = `${setupNotice}\nConfigure Chat App in Google Cloud Console: https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=gen-lang-client-0776912993`;
        } else {
          this.workspaceOutput = spaces.length
            ? spaces.map((s) => `• ${s.displayName || s.name} (${s.type})`).join('\n')
            : 'No Chat spaces returned.';
        }
      } catch (err) {
        this.workspaceOutput = err instanceof Error ? err.message : 'Chat error';
      } finally {
        this.workspaceLoading = false;
        this.render(container);
      }
    });

    container.querySelector('#ws-doc-create-btn')?.addEventListener('click', () => {
      const s = store.getState();
      this.onConfirmWorkspace({
        title: 'Create Google Doc Care Summary',
        description: `Create a new Google Doc titled "CareGrid Summary - ${s.profile.profileId}" in your Google Drive containing your active prescription and care explanation?`,
        actionLabel: 'Create Google Doc',
        onConfirm: async () => {
          this.workspaceLoading = true;
          this.render(container);
          try {
            const doc = await createCareSummaryDoc(
              `CareGrid Summary - ${s.profile.profileId}`,
              `Profile ID: ${s.profile.profileId}\nPatient: ${s.profile.fullName}\n\n${s.triage.prescriptionText}\n\n${s.triage.explanationText}`
            );
            this.workspaceOutput = `Created Google Doc:\n${doc.url}`;
          } catch (err) {
            this.workspaceOutput = err instanceof Error ? err.message : 'Docs error';
          } finally {
            this.workspaceLoading = false;
            this.render(container);
          }
        },
      });
    });

    container.querySelector('#ws-email-send-btn')?.addEventListener('click', () => {
      const s = store.getState();
      const targetEmail = s.currentUser?.email || 'sathvikpaneyadka@gmail.com';
      this.onConfirmWorkspace({
        title: 'Send Clinical Care Email via Gmail',
        description: `Send an email to ${targetEmail} with your active CareGrid Prescription [1], Explanation [2], and Smart Queue room slot?`,
        actionLabel: 'Send Email',
        onConfirm: async () => {
          this.workspaceLoading = true;
          this.render(container);
          try {
            const ticket = s.queueTickets[0];
            await sendCareEmail(
              targetEmail,
              `CareGrid Summary (${s.profile.profileId})`,
              `${s.triage.prescriptionText}\n\n${s.triage.explanationText}\n\nQueue: ${ticket ? `${ticket.clinicName} ${ticket.roomLocation} at ${ticket.slotTime}` : 'None'}`
            );
            this.workspaceOutput = `Sent care summary email to ${targetEmail} via Gmail API.`;
          } catch (err) {
            const chatFallbackNote = err instanceof Error ? err.message : 'Gmail send error';
            this.workspaceOutput = chatFallbackNote;
          } finally {
            this.workspaceLoading = false;
            this.render(container);
          }
        },
      });
    });

    void postChatMessage;
  }
}
