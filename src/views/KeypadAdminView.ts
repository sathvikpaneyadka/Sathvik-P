import { getLocaleStrings } from '../core/i18n';
import { speakMultilingual } from '../lib/audio';
import { auth } from '../lib/firebase';
import { store } from '../lib/state';
import { smsGatewayService, type SmsPipelineResult } from '../services/smsService';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class KeypadAdminView {
  private lcdHeadline = 'CAREGRID IVR & SMS READY';
  private lcdBody = 'Press 1: Prescription | 2: Explanation | 3: Queue Room | 4: Nurse ETA | 9: Escalate Complaint | 0: Language';
  private complaintText = 'Supply delivery delayed near East Clinic gate';
  private lastSmsReceipt: SmsPipelineResult | null = null;

  render(container: HTMLElement): void {
    const state = store.getState();
    const strings = getLocaleStrings(state.lang);

    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <!-- LEFT: Non-Smartphone Keypad Phone Simulator (SMS + Automated Voice IVR) -->
        <section class="lg:col-span-5 cg-card p-5 space-y-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-bold text-slate-900">Non-Smartphone Keypad Access</h2>
              <p class="text-xs text-slate-500">Multilingual SMS commands &amp; automated IVR voice menu</p>
            </div>
            <span class="text-xs font-semibold text-teal-700">${esc(strings.langName)}</span>
          </div>

          <!-- Hardware Feature-Phone Chassis -->
          <div class="keypad-shell p-4 space-y-4 max-w-sm mx-auto">
            <div class="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1">
              <span>CAREGRID GSM · ${esc(state.profile.profileId)}</span>
              <span>LANG: ${state.lang.toUpperCase()}</span>
            </div>

            <!-- Backlit Monochrome LCD -->
            <div class="keypad-lcd p-3 min-h-[124px] flex flex-col justify-between gap-2">
              <div class="text-[11px] font-bold uppercase tracking-wide border-b border-lime-800/30 pb-1">
                ${esc(this.lcdHeadline)}
              </div>
              <div id="kp-lcd-body" class="text-xs leading-snug break-words">
                ${esc(this.lcdBody)}
              </div>
              <div class="text-[10px] opacity-80 flex justify-between pt-1 border-t border-lime-800/20">
                <span>Menu</span>
                <span>Audio TTS Active</span>
              </div>
            </div>

            <!-- Escalation Detail Input (Used when pressing 9) -->
            <div class="space-y-1">
              <label class="block text-[10px] font-mono text-slate-300">Voice Call Issue Reason (for Key 9 Escalation)</label>
              <input id="kp-complaint-reason" type="text" value="${esc(this.complaintText)}" class="w-full rounded bg-slate-800 border border-slate-600 px-2.5 py-1.5 text-xs text-slate-100 outline-none" />
            </div>

            <!-- Physical Keypad 1..0 Grid -->
            <div class="grid grid-cols-3 gap-2">
              <button data-digit="1" class="kp-digit-btn keypad-key py-2.5 px-2 text-center">
                <div class="text-sm font-bold">1</div>
                <div class="text-[10px] text-slate-300">Rx Meds</div>
              </button>
              <button data-digit="2" class="kp-digit-btn keypad-key py-2.5 px-2 text-center">
                <div class="text-sm font-bold">2</div>
                <div class="text-[10px] text-slate-300">Explain</div>
              </button>
              <button data-digit="3" class="kp-digit-btn keypad-key py-2.5 px-2 text-center">
                <div class="text-sm font-bold">3</div>
                <div class="text-[10px] text-slate-300">Queue</div>
              </button>
              <button data-digit="4" class="kp-digit-btn keypad-key py-2.5 px-2 text-center">
                <div class="text-sm font-bold">4</div>
                <div class="text-[10px] text-slate-300">Nurse ETA</div>
              </button>
              <button data-digit="5" class="kp-digit-btn keypad-key py-2.5 px-2 text-center">
                <div class="text-sm font-bold">5</div>
                <div class="text-[10px] text-slate-300">IVR Menu</div>
              </button>
              <button data-digit="9" class="kp-digit-btn keypad-key py-2.5 px-2 text-center border-rose-500/60">
                <div class="text-sm font-bold text-rose-300">9</div>
                <div class="text-[10px] text-rose-200">Escalate</div>
              </button>
              <button data-digit="*" class="kp-digit-btn keypad-key py-2 px-2 text-center">
                <div class="text-sm font-bold">*</div>
                <div class="text-[10px] text-slate-300">Repeat</div>
              </button>
              <button data-digit="0" class="kp-digit-btn keypad-key py-2 px-2 text-center">
                <div class="text-sm font-bold">0</div>
                <div class="text-[10px] text-slate-300">Language</div>
              </button>
              <button data-digit="#" class="kp-digit-btn keypad-key py-2 px-2 text-center">
                <div class="text-sm font-bold">#</div>
                <div class="text-[10px] text-slate-300">Help</div>
              </button>
            </div>
          </div>

          <!-- SMS Command Input & Automated Trigger Pipeline -->
          <form id="kp-sms-form" class="space-y-2.5 pt-2 border-t border-slate-200">
            <label for="kp-sms-input" class="block text-xs font-semibold text-slate-700">
              Send SMS Command (STATUS, NURSE, REPORT &lt;text&gt;, RX, EXPLAIN, QUEUE, VERIFY 4821, LANG hi)
            </label>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" data-sms-preset="STATUS" class="kp-sms-preset cg-btn-secondary px-2 py-1 text-[11px] font-mono">STATUS</button>
              <button type="button" data-sms-preset="NURSE" class="kp-sms-preset cg-btn-secondary px-2 py-1 text-[11px] font-mono">NURSE</button>
              <button type="button" data-sms-preset="REPORT Oxygen cylinder delayed" class="kp-sms-preset cg-btn-secondary px-2 py-1 text-[11px] font-mono">REPORT</button>
              <button type="button" data-sms-preset="QUEUE" class="kp-sms-preset cg-btn-secondary px-2 py-1 text-[11px] font-mono">QUEUE</button>
              <button type="button" data-sms-preset="RX" class="kp-sms-preset cg-btn-secondary px-2 py-1 text-[11px] font-mono">RX</button>
            </div>
            <div class="flex gap-2">
              <input id="kp-sms-input" type="text" placeholder="e.g. REPORT Oxygen cylinder delayed" class="cg-input text-xs flex-1 font-mono" required />
              <button type="submit" class="cg-btn-primary px-4 py-2 text-xs whitespace-nowrap">Send SMS</button>
            </div>
          </form>

          ${
            this.lastSmsReceipt
              ? `<div id="kp-sms-receipt" class="p-3 rounded-lg border border-teal-200 bg-teal-50/60 text-xs space-y-1">
                  <div class="flex items-center justify-between font-bold text-teal-900">
                    <span>Trigger: ${esc(this.lastSmsReceipt.trigger.endpoint)}</span>
                    <span class="font-mono text-[11px]">${esc(this.lastSmsReceipt.confirmation.confirmationId)}</span>
                  </div>
                  <div class="text-[11px] text-slate-700">
                    Side Effect: ${esc(this.lastSmsReceipt.backend.sideEffects[0] || 'Processed')}
                  </div>
                  <div class="text-[11px] font-mono text-slate-800">
                    Auto-Confirm -> ${esc(this.lastSmsReceipt.confirmation.toPhone)} (${this.lastSmsReceipt.confirmation.segments} seg, ${esc(this.lastSmsReceipt.confirmation.deliveryStatus)})
                  </div>
                </div>`
              : ''
          }
        </section>

        <!-- RIGHT: Synchronized Desktop Administrative Oversight Console -->
        <section class="lg:col-span-7 space-y-6">
          <!-- Supervisor Auto-Escalation Console -->
          <div class="cg-card p-5 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-base font-bold text-slate-900">Desktop Administrative Oversight Console</h3>
                <p class="text-xs text-slate-500">Live supervisor complaint routing, periodic SMS push notifications &amp; operational exports</p>
              </div>
              <button id="kp-export-csv" class="cg-btn-secondary px-3 py-1.5 text-xs">Download Operations CSV</button>
            </div>

            <!-- Escalated Complaints List -->
            <div class="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              ${state.complaints
                .map((c) => {
                  const statusColor =
                    c.status === 'resolved'
                      ? 'text-emerald-700'
                      : c.status === 'acknowledged'
                        ? 'text-sky-700'
                        : 'text-rose-700';
                  return `
                    <div class="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                      <div class="space-y-0.5 max-w-md">
                        <div class="text-xs font-bold text-slate-900 tabular-nums">
                          ${esc(c.complaintCode)} · ${esc(c.channel.toUpperCase())} · <span class="${statusColor}">${esc(c.status.toUpperCase())}</span>
                        </div>
                        <div class="text-xs text-slate-800">${esc(c.description)}</div>
                        <div class="text-[11px] font-semibold text-teal-800">Supervisor: ${esc(c.assignedSupervisor)}</div>
                      </div>
                      <div class="flex items-center gap-1.5">
                        ${
                          c.status === 'escalated'
                            ? `<button data-ack="${esc(c.complaintCode)}" class="kp-ack-btn cg-btn-secondary px-2.5 py-1 text-xs">Acknowledge</button>`
                            : ''
                        }
                        ${
                          c.status !== 'resolved'
                            ? `<button data-resolve="${esc(c.complaintCode)}" class="kp-resolve-btn cg-btn-primary px-2.5 py-1 text-xs">Resolve</button>`
                            : '<span class="text-xs font-semibold text-emerald-700">Closed</span>'
                        }
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>

            <!-- Standard SMS Push Alert Broadcast -->
            <form id="kp-push-form" class="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
              <input id="kp-push-text" type="text" placeholder="Send immediate SMS push alert to non-smartphone patient..." class="cg-input text-xs flex-1" required />
              <button type="submit" class="cg-btn-primary px-4 py-2 text-xs whitespace-nowrap">Send SMS Push Alert</button>
            </form>
          </div>

          <!-- Synchronized SMS & IVR Audit Stream -->
          <div class="cg-card p-5 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900">Real-Time SMS &amp; IVR Notification Stream</h3>
              <span class="text-xs text-slate-500 tabular-nums">${state.smsLogs.length} events synced</span>
            </div>
            <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
              ${state.smsLogs
                .slice(0, 12)
                .map(
                  (log) => `
                  <div class="p-2.5 rounded-lg border text-xs ${
                    log.direction === 'inbound'
                      ? 'bg-slate-50 border-slate-200'
                      : log.direction === 'periodic_alert'
                        ? 'bg-amber-50/70 border-amber-200'
                        : 'bg-teal-50/60 border-teal-200'
                  }">
                    <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                      <span>${esc(log.direction.toUpperCase())} · ${esc(log.command)} (${log.language.toUpperCase()})</span>
                      <span class="tabular-nums text-slate-500">${esc(log.timestamp)}</span>
                    </div>
                    <div class="mt-1 text-slate-800 font-mono text-[11px]">${esc(log.message)}</div>
                  </div>
                `
                )
                .join('')}
            </div>
          </div>
        </section>
      </div>
    `;

    this.bindEvents(container);
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelector('#kp-complaint-reason')?.addEventListener('input', (e) => {
      this.complaintText = (e.target as HTMLInputElement).value;
    });

    container.querySelectorAll<HTMLButtonElement>('.kp-digit-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const digit = btn.dataset.digit || '5';
        const res = await fetch('/api/engine/ivr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            digit,
            context: store.getKeypadContext(),
            complaintReason: this.complaintText,
          }),
        });
        const data = (await res.json()) as {
          digit: string;
          menuAction: string;
          audioResponseText: string;
          smsConfirmationText: string;
          nextLang?: 'en' | 'hi' | 'es' | 'ta';
          complaint?: {
            complaintCode: string;
            channel: 'sms' | 'ivr' | 'web';
            category: string;
            assignedSupervisor: string;
            description: string;
            status: 'escalated';
          };
        };

        this.lcdHeadline = `IVR [${data.digit}] · ${data.menuAction}`;
        this.lcdBody = data.audioResponseText;
        store.recordIvrInteraction(data);
        void speakMultilingual(data.audioResponseText, data.nextLang || store.getState().lang);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.kp-sms-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = container.querySelector('#kp-sms-input') as HTMLInputElement | null;
        if (input && btn.dataset.smsPreset) {
          input.value = btn.dataset.smsPreset;
          input.focus();
        }
      });
    });

    container.querySelector('#kp-sms-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = container.querySelector('#kp-sms-input') as HTMLInputElement;
      const msg = input.value.trim();
      if (!msg) return;

      const state = store.getState();
      const authToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null;
      const result = await smsGatewayService.handleIncomingSms(
        {
          rawMessage: msg,
          senderPhone: state.profile.phone,
          context: store.getKeypadContext(),
        },
        { authToken }
      );

      this.lastSmsReceipt = result;
      this.lcdHeadline = `SMS TRIGGER · ${result.parsed.verb}`;
      this.lcdBody = result.confirmation.body;
      input.value = '';
      store.recordSmsExchange(
        result.backend.domainResult.command,
        msg,
        result.confirmation.body,
        result.backend.domainResult.periodicAlertPreview,
        result.complaint,
        result.backend.domainResult.nextLang
      );
      store.showToast(
        `Executed ${result.trigger.endpoint} & sent ${result.confirmation.confirmationId}`
      );
    });

    container.querySelectorAll<HTMLButtonElement>('.kp-ack-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.ack;
        if (code) store.updateComplaintStatus(code, 'acknowledged');
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.kp-resolve-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.resolve;
        if (code) store.updateComplaintStatus(code, 'resolved');
      });
    });

    container.querySelector('#kp-push-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = container.querySelector('#kp-push-text') as HTMLInputElement;
      const msg = input.value.trim();
      if (!msg) return;
      store.pushPeriodicAlert('ADMIN_PUSH', msg);
      store.showToast('SMS push alert dispatched to patient handset');
      this.lcdHeadline = 'INCOMING SMS ALERT';
      this.lcdBody = msg;
      input.value = '';
      this.render(container);
    });

    container.querySelector('#kp-export-csv')?.addEventListener('click', () => {
      const s = store.getState();
      const rows = [
        ['Type', 'Code', 'Detail', 'Status/Owner'],
        ...s.complaints.map((c) => ['Escalation', c.complaintCode, c.description, `${c.status} (${c.assignedSupervisor})`]),
        ...s.queueTickets.map((q) => ['SmartQueue', q.ticketCode, `${q.clinicName} ${q.roomLocation}`, q.slotTime]),
        ...s.nurseBookings.map((n) => ['HomeNurse', n.bookingCode, n.nurseName, `${n.status} ETA ${n.etaMinutes}m`]),
      ];
      const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `caregrid-ops-report-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}
