import * as xb from 'xrblocks';
import { store } from '../lib/state';
import { MedicalSpatialScene } from '../xr/MedicalSpatialScene';

function detectSoftwareWebGL(): boolean {
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) return true;
    const rendererInfo = String(gl.getParameter(gl.RENDERER) || '');
    return /SwiftShader|llvmpipe|Software/i.test(rendererInfo);
  } catch {
    return true;
  }
}

export class SpatialXrView {
  private xrBootstrapped = false;
  private spatialStatus: 'idle' | 'ready' | 'fallback' = 'idle';
  private cachedSection: HTMLElement | null = null;
  private statusReadout: HTMLElement | null = null;

  render(container: HTMLElement): void {
    const state = store.getState();
    const ticket = state.queueTickets[0];
    const nurse = state.nurseBookings[0];

    if (this.cachedSection) {
      container.replaceChildren(this.cachedSection);
      if (this.statusReadout) {
        this.statusReadout.innerHTML = `
          Active Queue: <strong class="tabular-nums">${ticket ? `${ticket.roomLocation} · ${ticket.slotTime}` : 'None'}</strong>
          · Home Nurse ETA: <strong class="tabular-nums">${nurse ? `${nurse.etaMinutes} min` : '--'}</strong>
        `;
      }
      return;
    }

    const section = document.createElement('section');
    section.className = 'cg-card p-5 space-y-4';
    section.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-xs font-semibold uppercase tracking-wider text-teal-700">
            WebXR &amp; XR Blocks Spatial Operations Hub
          </div>
          <h2 class="text-lg font-bold text-slate-900 mt-0.5">
            3D Clinical Wing, Smart Queue &amp; Live Dispatch Twin
          </h2>
          <p class="text-xs text-slate-600">
            Interact with the 3D spatial panel ([1] Prescription · [2] Explanation) or click to rotate &amp; inspect the real-time dispatch hub.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button id="xr-speak-rx" class="cg-btn-primary px-3.5 py-2 text-xs">1 · Spatial Prescription</button>
          <button id="xr-speak-exp" class="cg-btn-secondary px-3.5 py-2 text-xs">2 · Spatial Explanation</button>
        </div>
      </div>

      <div
        id="xr-viewport-host"
        data-state="${this.spatialStatus}"
        class="relative w-full h-[460px] rounded-xl border border-slate-300 bg-slate-900 overflow-hidden"
      >
        <canvas id="xr-embedded-canvas" class="w-full h-full block"></canvas>
        <div class="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div id="xr-status-readout" class="px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-700 text-xs text-slate-100 pointer-events-auto">
            Active Queue: <strong class="tabular-nums">${ticket ? `${ticket.roomLocation} · ${ticket.slotTime}` : 'None'}</strong>
            · Home Nurse ETA: <strong class="tabular-nums">${nurse ? `${nurse.etaMinutes} min` : '--'}</strong>
          </div>
          <div class="px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-700 text-[11px] text-slate-300">
            Best viewed on Android XR (Galaxy XR / XREAL AURA) or Desktop Simulator
          </div>
        </div>
      </div>
    `;

    this.cachedSection = section;
    this.statusReadout = section.querySelector('#xr-status-readout');
    container.replaceChildren(section);

    section.querySelector('#xr-speak-rx')?.addEventListener('click', () => store.setTab('clinical'));
    section.querySelector('#xr-speak-exp')?.addEventListener('click', () => store.setTab('clinical'));
    void this.ensureXrMounted(section);
  }

  private async ensureXrMounted(section: HTMLElement): Promise<void> {
    const canvas = section.querySelector('#xr-embedded-canvas') as HTMLCanvasElement | null;
    const host = section.querySelector('#xr-viewport-host') as HTMLElement | null;
    if (!canvas || !host || this.xrBootstrapped) return;

    try {
      const rect = host.getBoundingClientRect();
      canvas.width = Math.max(640, Math.floor(rect.width || 960));
      canvas.height = Math.max(360, Math.floor(rect.height || 460));

      const isSoftwareGl = detectSoftwareWebGL();
      const options = new xb.Options();
      options.canvas = canvas;
      options.antialias = !isSoftwareGl;
      options.xrButton.enabled = false;
      options.enableSimulator = false;
      options.reticles.enabled = true;
      options.setAppTitle('CareGrid Spatial Hub');

      xb.add(new MedicalSpatialScene());
      await xb.init(options);

      this.xrBootstrapped = true;
      this.spatialStatus = 'ready';
      host.dataset.state = 'ready';
    } catch (err) {
      console.warn('XR Blocks viewport initialization notice:', err);
      this.spatialStatus = 'fallback';
      host.dataset.state = 'fallback';
    }
  }
}
