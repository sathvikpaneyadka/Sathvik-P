import { getLocaleStrings, type SupportedLang } from '../core/i18n';
import {
  GeminiLiveVoiceClient,
  speakMultilingual,
  startBrowserDictation,
  stopActiveSpeech,
} from '../lib/audio';
import { store } from '../lib/state';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ClinicalQueueView {
  private activeShortcut: 'rx' | 'explain' = 'rx';
  private triageBusy = false;
  private triageStatus = 'Ready for multimodal input (text, photo, camera, voice).';
  private verificationStatus = '';
  private cameraStream: MediaStream | null = null;
  private cameraActive = false;
  private queuePhotoDataUrl: string | null = null;
  private queuePhotoLabel = '';
  private stopDictation: (() => void) | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isRecordingAudio = false;
  private liveClient = new GeminiLiveVoiceClient();
  private liveModeActive: 'off' | 'live' | 'translate' = 'off';
  private liveTranscriptLines: string[] = [];
  private showRegisterForm = false;

  render(container: HTMLElement): void {
    const state = store.getState();
    const strings = getLocaleStrings(state.lang);
    const hasAccess = store.checkProfileAccess();
    const p = state.profile;
    const t = state.triage;

    container.innerHTML = `
      <div class="space-y-6">
        <!-- Top Row: Unique Isolated Profile + Dual Verification -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Isolated Patient Profile Card -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-wider text-teal-700">
                  Private Medical Identity · Strictly Owner Isolated
                </div>
                <h2 class="text-lg font-bold text-slate-900 mt-0.5">
                  Profile ID: <span class="tabular-nums text-teal-800">${esc(p.profileId)}</span>
                </h2>
              </div>
              <button id="cq-toggle-reg" class="cg-btn-secondary px-3 py-1.5 text-xs">
                ${this.showRegisterForm ? 'Close Form' : 'New Profile ID'}
              </button>
            </div>

            ${
              !hasAccess
                ? `<div class="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
                    Access denied: Only the verified owner UID can view medical history for ${esc(p.profileId)}.
                  </div>`
                : this.showRegisterForm
                  ? `
                    <form id="cq-reg-form" class="space-y-2.5 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                      <div class="text-xs font-bold text-slate-900">Register Isolated Patient Profile</div>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input id="cq-reg-name" type="text" placeholder="Full Name" class="cg-input text-xs" required />
                        <input id="cq-reg-phone" type="text" placeholder="Phone (+91 ...)" class="cg-input text-xs" required />
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input id="cq-reg-pin" type="text" maxlength="4" placeholder="4-digit Keypad PIN (e.g. 4821)" class="cg-input text-xs tabular-nums" required />
                        <input id="cq-reg-word" type="text" placeholder="Keypad Security Word (e.g. lotus)" class="cg-input text-xs" required />
                      </div>
                      <input id="cq-reg-allergies" type="text" placeholder="Known Allergies" class="cg-input text-xs" />
                      <input id="cq-reg-history" type="text" placeholder="Medical History Summary" class="cg-input text-xs" />
                      <button type="submit" class="cg-btn-primary w-full py-2 text-xs">Generate Unique Profile ID</button>
                    </form>
                  `
                  : `
                    <div class="grid grid-cols-2 gap-3 text-xs">
                      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div class="text-slate-500">Patient Name</div>
                        <div class="font-semibold text-slate-900 mt-0.5">${esc(p.fullName)}</div>
                      </div>
                      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div class="text-slate-500">Registered Phone</div>
                        <div class="font-semibold text-slate-900 tabular-nums mt-0.5">${esc(p.phone)}</div>
                      </div>
                      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div class="text-slate-500">Allergies</div>
                        <div class="font-medium text-slate-800 mt-0.5">${esc(p.allergies)}</div>
                      </div>
                      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div class="text-slate-500">OTP / Keypad PIN</div>
                        <div class="font-semibold mt-0.5 ${p.otpVerified || p.keypadPinVerified ? 'text-emerald-700' : 'text-amber-700'}">
                          ${p.otpVerified ? 'OTP Verified' : 'OTP Pending'} · ${p.keypadPinVerified ? 'Keypad Verified' : 'Keypad Pending'}
                        </div>
                      </div>
                    </div>
                    <div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <span class="font-semibold text-slate-800">Medical History:</span> ${esc(p.medicalHistory)}
                    </div>
                  `
            }
          </div>

          <!-- Dual Verification: Smartphone OTP + Non-Smartphone Keypad PIN -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div>
              <h3 class="text-base font-bold text-slate-900">Dual Channel Verification</h3>
              <p class="text-xs text-slate-500">6-digit OTP for smartphone users OR 4-digit Keypad PIN + security word for feature phones</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- Smartphone OTP -->
              <div class="p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-slate-900">Smartphone OTP</span>
                  <span class="tabular-nums text-slate-500">Demo: ${esc(p.expectedOtp)}</span>
                </div>
                <input id="cq-otp-input" type="text" maxlength="6" value="${esc(p.expectedOtp)}" placeholder="6-digit OTP" class="cg-input text-xs tabular-nums" />
                <button id="cq-verify-otp-btn" class="cg-btn-secondary w-full py-1.5 text-xs">Verify 6-Digit OTP</button>
              </div>

              <!-- Keypad PIN + Security Word -->
              <div class="p-3.5 rounded-lg border border-slate-200 space-y-2">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-slate-900">Keypad Verification</span>
                  <span class="tabular-nums text-slate-500">PIN: ${esc(p.keypadPinCode)}</span>
                </div>
                <input id="cq-pin-input" type="text" maxlength="4" value="${esc(p.keypadPinCode)}" placeholder="4-digit PIN" class="cg-input text-xs tabular-nums" />
                <input id="cq-word-input" type="text" value="${esc(p.securityAnswer)}" placeholder="Security word" class="cg-input text-xs" />
                <button id="cq-verify-pin-btn" class="cg-btn-primary w-full py-1.5 text-xs">Verify Keypad Access</button>
              </div>
            </div>

            ${
              this.verificationStatus
                ? `<div class="text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">${esc(this.verificationStatus)}</div>`
                : ''
            }
          </div>
        </section>

        <!-- Multimodal Clinical Bridge + 1-Button Prescription / 2-Button Explanation -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Left: Multimodal Inputs (Text, Photo, Camera, Speech-to-Text, Live Voice) -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-base font-bold text-slate-900">Multimodal Doctor-Patient Bridge</h3>
                <p class="text-xs text-slate-500">Explain symptoms via text, photo upload, live camera, voice dictation, or live translator</p>
              </div>
              <select id="cq-lang-select" class="cg-input w-auto text-xs font-semibold">
                <option value="en" ${state.lang === 'en' ? 'selected' : ''}>English</option>
                <option value="hi" ${state.lang === 'hi' ? 'selected' : ''}>हिन्दी (Hindi)</option>
                <option value="es" ${state.lang === 'es' ? 'selected' : ''}>Español</option>
                <option value="ta" ${state.lang === 'ta' ? 'selected' : ''}>தமிழ் (Tamil)</option>
              </select>
            </div>

            <textarea id="cq-symptom-input" rows="3" class="cg-input text-sm" placeholder="Describe symptoms, fever temperature, or upload a prescription/rash photo...">${esc(t.symptomText)}</textarea>

            <!-- Photo, Camera & Voice Controls -->
            <div class="flex flex-wrap gap-2">
              <label class="cg-btn-secondary px-3 py-1.5 text-xs cursor-pointer inline-flex items-center gap-1.5">
                <span>Upload Photo</span>
                <input id="cq-photo-file" type="file" accept="image/*" class="hidden" />
              </label>
              <button id="cq-camera-toggle" class="cg-btn-secondary px-3 py-1.5 text-xs">
                ${this.cameraActive ? 'Snap &amp; Close Camera' : 'Open Live Camera'}
              </button>
              <button id="cq-dictate-btn" class="cg-btn-secondary px-3 py-1.5 text-xs">
                Speech-to-Text
              </button>
              <button id="cq-record-transcribe-btn" class="cg-btn-secondary px-3 py-1.5 text-xs ${this.isRecordingAudio ? 'bg-rose-50 border-rose-300 text-rose-700' : ''}">
                ${this.isRecordingAudio ? 'Stop &amp; Transcribe Clip' : 'Record Voice Clip'}
              </button>
            </div>

            ${
              this.cameraActive
                ? `<div class="rounded-lg overflow-hidden border border-slate-300 bg-slate-900">
                    <video id="cq-camera-video" autoplay playsinline muted class="w-full max-h-52 object-cover"></video>
                   </div>`
                : ''
            }

            ${
              t.photoDataUrl
                ? `<div class="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <img src="${t.photoDataUrl}" alt="Clinical upload preview" class="w-16 h-16 object-cover rounded border border-slate-300" />
                    <div class="flex-1 min-w-0">
                      <div class="text-xs font-semibold text-slate-900 truncate">${esc(t.photoLabel || 'Attached clinical photo')}</div>
                      <div class="text-[11px] text-slate-500">Included in multimodal analysis</div>
                    </div>
                    <button id="cq-clear-photo" class="text-xs font-medium text-rose-700 hover:underline">Remove</button>
                  </div>`
                : ''
            }

            <div class="flex flex-wrap items-center gap-2 pt-1">
              <button id="cq-analyze-btn" class="cg-btn-primary px-4 py-2 text-xs ${this.triageBusy ? 'opacity-60' : ''}" ${this.triageBusy ? 'disabled' : ''}>
                ${this.triageBusy ? 'Analyzing Multimodal Input...' : 'Run Clinical AI Analysis'}
              </button>
              <button id="cq-live-voice-btn" class="cg-btn-secondary px-3 py-2 text-xs">
                ${this.liveModeActive === 'live' ? 'Disconnect Voice Assistant' : 'Live Voice Assistant'}
              </button>
              <button id="cq-live-translate-btn" class="cg-btn-secondary px-3 py-2 text-xs">
                ${this.liveModeActive === 'translate' ? 'Stop Live Translation' : 'Live Translator'}
              </button>
            </div>

            <div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              ${esc(this.triageStatus)}
            </div>

            ${
              this.liveTranscriptLines.length > 0
                ? `<div class="p-3 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono max-h-28 overflow-y-auto space-y-1">
                    ${this.liveTranscriptLines.map((line) => `<div>${esc(line)}</div>`).join('')}
                   </div>`
                : ''
            }
          </div>

          <!-- Right: Dedicated Button [1] Prescription & Button [2] Explanation + TTS -->
          <div class="lg:col-span-6 cg-card p-5 space-y-4 flex flex-col justify-between">
            <div class="space-y-4">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <h3 class="text-base font-bold text-slate-900">Instant Patient Guidance Buttons</h3>
                  <p class="text-xs text-slate-500">Press Button 1 for Prescription or Button 2 for Explanation (Reads aloud via TTS)</p>
                </div>
                <span class="text-xs font-semibold uppercase text-amber-700">${esc(t.severity)}</span>
              </div>

              <!-- Dedicated Large Accessibility Buttons -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button id="cq-btn-rx" class="p-3.5 rounded-xl border text-left transition ${this.activeShortcut === 'rx' ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-50'}">
                  <div class="text-sm font-bold">${esc(strings.prescriptionBtn)}</div>
                  <div class="text-[11px] mt-1 ${this.activeShortcut === 'rx' ? 'text-teal-100' : 'text-slate-500'}">Dosage, schedule &amp; audio readout</div>
                </button>
                <button id="cq-btn-explain" class="p-3.5 rounded-xl border text-left transition ${this.activeShortcut === 'explain' ? 'bg-sky-700 text-white border-sky-700' : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-50'}">
                  <div class="text-sm font-bold">${esc(strings.explanationBtn)}</div>
                  <div class="text-[11px] mt-1 ${this.activeShortcut === 'explain' ? 'text-sky-100' : 'text-slate-500'}">Plain-language care explanation &amp; TTS</div>
                </button>
              </div>

              <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div class="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span>${this.activeShortcut === 'rx' ? 'Active Prescription Guidance' : 'Condition &amp; Recovery Explanation'}</span>
                  <button id="cq-stop-tts" class="text-xs font-medium text-slate-500 hover:text-slate-900">Stop Audio</button>
                </div>
                <p id="cq-guidance-output" class="text-sm text-slate-800 leading-relaxed">
                  ${esc(this.activeShortcut === 'rx' ? t.prescriptionText : t.explanationText)}
                </p>
                <div class="pt-2 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap justify-between gap-2">
                  <span>Recommended Care: <strong class="text-slate-900">${esc(t.recommendedSpecialty)}</strong></span>
                  <span>SMS Digest: <span class="font-mono">${esc(t.smsSummary)}</span></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Smart Queue System (Photo Verification Only — Strictly NO QR Codes) -->
        <section class="cg-card p-5 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="text-base font-bold text-slate-900">Photo-Verified Smart Queue System</h3>
              <p class="text-xs text-slate-500">
                Verify arrival by uploading a check-in photo or capturing a frame (zero QR scanning required) to receive your exact clinic room &amp; time slot.
              </p>
            </div>
            <span class="text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-md">
              Photo Match Check-In · Zero QR Code
            </span>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <form id="cq-queue-form" class="lg:col-span-5 space-y-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Clinic Location</label>
                <select id="cq-q-clinic" class="cg-input text-xs">
                  <option value="CareGrid Metro Hub">CareGrid Metro Hub</option>
                  <option value="Northside Diagnostics Wing">Northside Diagnostics Wing</option>
                  <option value="East Care Specialty Clinic">East Care Specialty Clinic</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Visit Priority</label>
                <select id="cq-q-urgency" class="cg-input text-xs">
                  <option value="priority">Priority Consultation</option>
                  <option value="routine">Routine Follow-up</option>
                  <option value="urgent">Urgent Triage</option>
                </select>
              </div>
              <div class="space-y-1.5">
                <label class="block text-xs font-semibold text-slate-700">Arrival Photo Verification (Required for Photo Match)</label>
                <div class="flex flex-wrap gap-2">
                  <label class="cg-btn-secondary px-3 py-1.5 text-xs cursor-pointer">
                    <span>Upload Check-In Photo</span>
                    <input id="cq-q-photo-input" type="file" accept="image/*" class="hidden" />
                  </label>
                  <button type="button" id="cq-q-use-clinical-photo" class="cg-btn-secondary px-3 py-1.5 text-xs">
                    Use Attached Photo
                  </button>
                </div>
                <div class="text-[11px] text-slate-600">
                  ${this.queuePhotoLabel ? `Verified file: ${esc(this.queuePhotoLabel)}` : 'Upload a check-in or ID photo (no QR code needed).'}
                </div>
              </div>
              <button type="submit" class="cg-btn-primary w-full py-2 text-xs">
                Assign Exact Room &amp; Time Slot
              </button>
            </form>

            <!-- Active Queue Tickets -->
            <div class="lg:col-span-7 space-y-3">
              ${state.queueTickets
                .map(
                  (q) => `
                  <div class="p-4 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-4">
                    <div class="space-y-1">
                      <div class="flex items-center gap-2 text-xs">
                        <span class="font-bold text-teal-800 tabular-nums">${esc(q.ticketCode)}</span>
                        <span class="text-slate-400">·</span>
                        <span class="font-semibold text-slate-900">${esc(q.clinicName)}</span>
                      </div>
                      <div class="text-sm font-bold text-slate-900">${esc(q.roomLocation)}</div>
                      <div class="text-xs text-slate-600">${esc(q.photoTag)} · Profile ${esc(q.profileId)}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-xl font-bold text-slate-900 tabular-nums">${esc(q.slotTime)}</div>
                      <div class="text-xs font-semibold text-emerald-700 tabular-nums">Est. wait ${q.waitMinutes} min</div>
                    </div>
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
    container.querySelector('#cq-toggle-reg')?.addEventListener('click', () => {
      this.showRegisterForm = !this.showRegisterForm;
      this.render(container);
    });

    container.querySelector('#cq-reg-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fullName = (container.querySelector('#cq-reg-name') as HTMLInputElement).value;
      const phone = (container.querySelector('#cq-reg-phone') as HTMLInputElement).value;
      const keypadPinCode = (container.querySelector('#cq-reg-pin') as HTMLInputElement).value;
      const securityAnswer = (container.querySelector('#cq-reg-word') as HTMLInputElement).value;
      const allergies = (container.querySelector('#cq-reg-allergies') as HTMLInputElement).value;
      const medicalHistory = (container.querySelector('#cq-reg-history') as HTMLInputElement).value;
      store.registerPatientProfile({ fullName, phone, keypadPinCode, securityAnswer, allergies, medicalHistory });
      this.showRegisterForm = false;
      this.render(container);
    });

    container.querySelector('#cq-verify-otp-btn')?.addEventListener('click', async () => {
      const code = (container.querySelector('#cq-otp-input') as HTMLInputElement)?.value || '';
      const p = store.getState().profile;
      const res = await fetch('/api/engine/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'otp',
          code,
          expectedOtp: p.expectedOtp,
          expectedKeypadPin: p.keypadPinCode,
        }),
      });
      const data = (await res.json()) as { verified: boolean; reason: string };
      store.markVerification('otp', data.verified);
      this.verificationStatus = data.reason;
      this.render(container);
    });

    container.querySelector('#cq-verify-pin-btn')?.addEventListener('click', async () => {
      const code = (container.querySelector('#cq-pin-input') as HTMLInputElement)?.value || '';
      const word = (container.querySelector('#cq-word-input') as HTMLInputElement)?.value || '';
      const p = store.getState().profile;
      const res = await fetch('/api/engine/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'keypad',
          code,
          expectedOtp: p.expectedOtp,
          expectedKeypadPin: p.keypadPinCode,
          securityAnswer: word,
          expectedSecurityAnswer: p.securityAnswer,
        }),
      });
      const data = (await res.json()) as { verified: boolean; reason: string };
      store.markVerification('keypad', data.verified);
      this.verificationStatus = data.reason;
      this.render(container);
    });

    container.querySelector('#cq-lang-select')?.addEventListener('change', (e) => {
      const nextLang = (e.target as HTMLSelectElement).value as SupportedLang;
      store.setLanguage(nextLang);
    });

    container.querySelector('#cq-symptom-input')?.addEventListener('input', (e) => {
      store.updateTriage({ symptomText: (e.target as HTMLTextAreaElement).value });
    });

    container.querySelector('#cq-photo-file')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        store.updateTriage({ photoDataUrl: dataUrl, photoLabel: file.name });
        this.queuePhotoDataUrl = dataUrl;
        this.queuePhotoLabel = file.name;
        this.triageStatus = `Photo attached (${file.name}). Click Run Clinical AI Analysis.`;
        this.render(container);
      };
      reader.readAsDataURL(file);
    });

    container.querySelector('#cq-clear-photo')?.addEventListener('click', () => {
      store.updateTriage({ photoDataUrl: null, photoLabel: '' });
      this.render(container);
    });

    container.querySelector('#cq-camera-toggle')?.addEventListener('click', async () => {
      if (this.cameraActive) {
        const video = container.querySelector('#cq-camera-video') as HTMLVideoElement | null;
        if (video && video.videoWidth > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(video, 0, 0);
          const snapUrl = canvas.toDataURL('image/jpeg', 0.85);
          store.updateTriage({ photoDataUrl: snapUrl, photoLabel: 'live-camera-capture.jpg' });
          this.queuePhotoDataUrl = snapUrl;
          this.queuePhotoLabel = 'live-camera-capture.jpg';
          this.triageStatus = 'Captured live camera frame for multimodal triage and queue check-in.';
        }
        this.stopCamera();
        this.render(container);
      } else {
        try {
          this.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
          this.cameraActive = true;
          this.render(container);
          const video = container.querySelector('#cq-camera-video') as HTMLVideoElement | null;
          if (video && this.cameraStream) {
            video.srcObject = this.cameraStream;
          }
        } catch {
          this.triageStatus = 'Camera permission unavailable here; use Upload Photo instead.';
          this.render(container);
        }
      }
    });

    container.querySelector('#cq-dictate-btn')?.addEventListener('click', () => {
      if (this.stopDictation) {
        this.stopDictation();
        this.stopDictation = null;
        return;
      }
      this.triageStatus = 'Listening for speech-to-text symptom dictation...';
      this.render(container);
      this.stopDictation = startBrowserDictation(
        store.getState().lang,
        (interim) => {
          this.triageStatus = `Hearing: "${interim}"`;
        },
        (finalText) => {
          const prev = store.getState().triage.symptomText;
          const next = prev ? `${prev} ${finalText}`.trim() : finalText;
          store.updateTriage({ symptomText: next });
          this.triageStatus = `Dictation captured: "${finalText}"`;
          this.stopDictation = null;
          this.render(container);
        },
        (err) => {
          this.triageStatus = err;
          this.stopDictation = null;
          this.render(container);
        }
      );
    });

    container.querySelector('#cq-record-transcribe-btn')?.addEventListener('click', async () => {
      if (this.isRecordingAudio && this.mediaRecorder) {
        this.mediaRecorder.stop();
        this.isRecordingAudio = false;
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream);
        this.mediaRecorder = recorder;
        this.isRecordingAudio = true;
        this.triageStatus = 'Recording audio clip... Click again to stop & transcribe.';
        this.render(container);

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const reader = new FileReader();
          reader.onload = async () => {
            this.triageStatus = 'Transcribing voice clip with Gemini...';
            this.render(container);
            try {
              const res = await fetch('/api/ai/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audioDataUrl: String(reader.result || ''),
                  language: store.getState().lang,
                }),
              });
              const data = (await res.json()) as { transcript?: string; error?: string };
              if (data.transcript) {
                const prev = store.getState().triage.symptomText;
                store.updateTriage({
                  symptomText: prev ? `${prev}\n${data.transcript}` : data.transcript,
                  voiceTranscript: data.transcript,
                });
                this.triageStatus = 'Audio transcribed into symptom description.';
              } else {
                this.triageStatus = data.error || 'No speech detected.';
              }
            } catch {
              this.triageStatus = 'Transcription request failed.';
            }
            this.render(container);
          };
          reader.readAsDataURL(blob);
        };
        recorder.start();
      } catch {
        this.triageStatus = 'Microphone access unavailable in this browser session.';
        this.render(container);
      }
    });

    container.querySelector('#cq-analyze-btn')?.addEventListener('click', async () => {
      const s = store.getState();
      const inputEl = container.querySelector('#cq-symptom-input') as HTMLTextAreaElement | null;
      const symptoms = inputEl?.value?.trim() || s.triage.symptomText;
      this.triageBusy = true;
      this.triageStatus = 'Running multimodal clinical analysis...';
      this.render(container);

      try {
        const res = await fetch('/api/ai/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symptoms,
            language: s.lang,
            imageDataUrl: s.triage.photoDataUrl,
            channel: 'web',
          }),
        });
        const data = (await res.json()) as {
          prescription?: string;
          explanation?: string;
          severity?: 'routine' | 'priority' | 'urgent';
          recommendedSpecialty?: string;
          smsSummary?: string;
          error?: string;
        };
        if (res.ok && data.prescription && data.explanation) {
          store.updateTriage({
            symptomText: symptoms,
            prescriptionText: data.prescription,
            explanationText: data.explanation,
            severity: data.severity || 'priority',
            recommendedSpecialty: data.recommendedSpecialty || 'General Medicine',
            smsSummary: data.smsSummary || s.triage.smsSummary,
          });
          this.triageStatus = `Analysis complete (${s.lang.toUpperCase()}). Press Button 1 or Button 2 to read aloud.`;
        } else {
          this.triageStatus = data.error || 'Clinical AI service could not complete request.';
        }
      } catch {
        this.triageStatus = 'Network error reaching clinical triage server.';
      } finally {
        this.triageBusy = false;
        this.render(container);
      }
    });

    const toggleLiveMode = async (mode: 'live' | 'translate') => {
      if (this.liveModeActive === mode) {
        this.liveClient.disconnect();
        this.liveModeActive = 'off';
        this.triageStatus = 'Live voice channel closed.';
        this.render(container);
        return;
      }
      this.liveModeActive = mode;
      this.liveTranscriptLines = [];
      await this.liveClient.connect(mode, store.getState().lang, {
        onStatus: (msg) => {
          this.triageStatus = msg;
          this.render(container);
        },
        onTranscript: (speaker, text) => {
          this.liveTranscriptLines = [...this.liveTranscriptLines.slice(-8), `${speaker}: ${text}`];
          this.render(container);
        },
        onClose: () => {
          this.liveModeActive = 'off';
          this.render(container);
        },
      });
    };

    container.querySelector('#cq-live-voice-btn')?.addEventListener('click', () => void toggleLiveMode('live'));
    container.querySelector('#cq-live-translate-btn')?.addEventListener('click', () => void toggleLiveMode('translate'));

    container.querySelector('#cq-btn-rx')?.addEventListener('click', async () => {
      this.activeShortcut = 'rx';
      this.render(container);
      const s = store.getState();
      await speakMultilingual(s.triage.prescriptionText, s.lang);
    });

    container.querySelector('#cq-btn-explain')?.addEventListener('click', async () => {
      this.activeShortcut = 'explain';
      this.render(container);
      const s = store.getState();
      await speakMultilingual(s.triage.explanationText, s.lang);
    });

    container.querySelector('#cq-stop-tts')?.addEventListener('click', () => stopActiveSpeech());

    container.querySelector('#cq-q-photo-input')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.queuePhotoDataUrl = String(reader.result || '');
        this.queuePhotoLabel = file.name;
        this.render(container);
      };
      reader.readAsDataURL(file);
    });

    container.querySelector('#cq-q-use-clinical-photo')?.addEventListener('click', () => {
      const s = store.getState();
      if (s.triage.photoDataUrl) {
        this.queuePhotoDataUrl = s.triage.photoDataUrl;
        this.queuePhotoLabel = s.triage.photoLabel || 'clinical-upload.jpg';
      } else {
        this.queuePhotoDataUrl = 'photo-checkin-verified';
        this.queuePhotoLabel = 'patient-id-photo.jpg';
      }
      this.render(container);
    });

    container.querySelector('#cq-queue-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const clinicName = (container.querySelector('#cq-q-clinic') as HTMLSelectElement).value;
      const urgency = (container.querySelector('#cq-q-urgency') as HTMLSelectElement).value as
        | 'routine'
        | 'priority'
        | 'urgent';
      try {
        store.bookSmartQueue({
          clinicName,
          urgency,
          verificationMethod: 'photo_match',
          photoUploaded: Boolean(this.queuePhotoDataUrl || this.queuePhotoLabel),
          photoLabel: this.queuePhotoLabel || 'arrival-photo.jpg',
        });
      } catch (err) {
        store.showToast(err instanceof Error ? err.message : 'Upload an arrival photo first');
      }
    });
  }

  private stopCamera(): void {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) track.stop();
      this.cameraStream = null;
    }
    this.cameraActive = false;
  }

  dispose(): void {
    this.stopCamera();
    this.liveClient.disconnect();
    if (this.stopDictation) this.stopDictation();
  }
}
