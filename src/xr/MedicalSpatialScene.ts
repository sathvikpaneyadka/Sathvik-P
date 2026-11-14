import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';
import { getLocaleStrings } from '../core/i18n';
import { speakMultilingual } from '../lib/audio';
import { store } from '../lib/state';

export class MedicalSpatialScene extends xb.Script {
  private vehicleGroup = new THREE.Group();
  private vanGroup = new THREE.Group();
  private beaconMesh!: THREE.Mesh;
  private orbitAngle = 0;
  private lastTick = 0;
  private spatialStatusText!: xb.UIText;
  private spatialBodyText!: xb.UIText;
  private spatialCard!: xb.UICard;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private disposables: Array<{ dispose: () => void }> = [];
  private unsubscribeStore: (() => void) | null = null;

  init(): void {
    // Rich realistic PBR lighting + RoomEnvironment IBL
    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 2.2);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(2.5, 4.5, 2.5);
    this.add(hemi, keyLight);

    const renderer = xb.core?.renderer;
    if (renderer && 'toneMapping' in renderer) {
      const webgl = renderer as THREE.WebGLRenderer;
      webgl.toneMapping = THREE.ACESFilmicToneMapping;
      webgl.toneMappingExposure = 1.05;
      try {
        const pmrem = new THREE.PMREMGenerator(webgl);
        const envScene = new RoomEnvironment();
        this.envRT = pmrem.fromScene(envScene, 0.04);
        if (xb.core?.scene) {
          xb.core.scene.environment = this.envRT.texture;
        }
        envScene.dispose();
        pmrem.dispose();
      } catch {
        // Fallback smoothly if software GL restricts PMREM
      }
    }

    this.buildDiorama();
    this.buildSpatialUiCard();
    this.syncFromStore();
    this.unsubscribeStore = store.subscribe(() => this.syncFromStore());
    if (xb.core?.camera) {
      xb.core.camera.position.set(0, 0.25, 0.35);
      xb.core.camera.lookAt(0, 0.05, -1.65);
    }
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildDiorama(): void {
    const diorama = new THREE.Group();
    diorama.position.set(0, -0.32, -1.65);
    diorama.rotation.x = 0.18;

    // 1. Stepped Base Platform & Dispatch Track
    const plinthGeo = this.track(new THREE.CylinderGeometry(0.92, 0.98, 0.06, 40));
    const plinthMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.72, metalness: 0.08 }));
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -0.03;
    diorama.add(plinth);

    const trackGeo = this.track(new THREE.RingGeometry(0.62, 0.72, 48));
    const trackMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85, side: THREE.DoubleSide })
    );
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.y = 0.002;
    diorama.add(track);

    // 2. Central Clinical Wing & Smart Queue Pavilion (Multi-part assembly)
    const hubGroup = new THREE.Group();
    const baseWallGeo = this.track(new THREE.BoxGeometry(0.52, 0.24, 0.34));
    const wallMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.06 }));
    const hubBody = new THREE.Mesh(baseWallGeo, wallMat);
    hubBody.position.y = 0.12;
    hubGroup.add(hubBody);

    const roofGeo = this.track(new THREE.BoxGeometry(0.56, 0.035, 0.38));
    const tealMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.35, metalness: 0.18 }));
    const roof = new THREE.Mesh(roofGeo, tealMat);
    roof.position.y = 0.255;
    hubGroup.add(roof);

    const glassBandGeo = this.track(new THREE.BoxGeometry(0.46, 0.08, 0.35));
    const glassMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.7 })
    );
    const glassBand = new THREE.Mesh(glassBandGeo, glassMat);
    glassBand.position.y = 0.14;
    hubGroup.add(glassBand);

    const beaconGeo = this.track(new THREE.SphereGeometry(0.042, 20, 16));
    const beaconMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.7, roughness: 0.2 })
    );
    this.beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    this.beaconMesh.position.y = 0.32;
    hubGroup.add(this.beaconMesh);
    diorama.add(hubGroup);

    // 3. Cold-Chain Supply Vault Module (Right rear)
    const vaultGroup = new THREE.Group();
    vaultGroup.position.set(0.38, 0, -0.22);
    const vaultBody = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.24, 0.18, 0.22)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4, metalness: 0.45 }))
    );
    vaultBody.position.y = 0.09;
    vaultGroup.add(vaultBody);
    const cryoTankGeo = this.track(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 16));
    const cryoMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.25, metalness: 0.6 }));
    for (let i = -1; i <= 1; i += 2) {
      const tank = new THREE.Mesh(cryoTankGeo, cryoMat);
      tank.position.set(i * 0.055, 0.22, 0);
      vaultGroup.add(tank);
    }
    diorama.add(vaultGroup);

    // 4. Home Nurse Rapid Dispatch Unit (Moving along track)
    this.buildDispatchVehicle(this.vehicleGroup, 0x0f766e, 0x34d399);
    diorama.add(this.vehicleGroup);

    // 5. Cold-Chain Medical Courier Van (Opposite side of track)
    this.buildDispatchVehicle(this.vanGroup, 0x0284c7, 0x7dd3fc);
    diorama.add(this.vanGroup);

    this.add(diorama);
  }

  private buildDispatchVehicle(target: THREE.Group, bodyColor: number, lightColor: number): void {
    const chassis = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.11, 0.055, 0.065)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.15 }))
    );
    chassis.position.y = 0.04;

    const stripe = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.112, 0.018, 0.067)),
      this.track(new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.3 }))
    );
    stripe.position.y = 0.036;

    const roofPod = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.03, 0.016, 0.03)),
      this.track(new THREE.MeshStandardMaterial({ color: lightColor, emissive: lightColor, emissiveIntensity: 0.6 }))
    );
    roofPod.position.y = 0.075;

    const wheelGeo = this.track(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12));
    const wheelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 }));
    for (const wx of [-0.035, 0.035]) {
      for (const wz of [-0.032, 0.032]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.014, wz);
        target.add(wheel);
      }
    }

    target.add(chassis, stripe, roofPod);
  }

  private buildSpatialUiCard(): void {
    this.spatialStatusText = new xb.UIText({
      text: 'CareGrid Spatial Command - Wing B Room 204',
      style: { fontSize: 16, opacity: 0.8, textAlign: 'center' },
    });

    this.spatialBodyText = new xb.UIText({
      text: 'Select button [1] for Prescription or [2] for Condition Explanation.',
      style: {
        fontSize: 16,
        lineHeight: 1.35,
        padding: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
      },
    });

    this.spatialCard = new xb.UICard({
      size: { width: 0.84, height: 'auto' },
      manipulation: true,
      edge: true,
      style: { flexDirection: 'column', gap: 12, padding: 18 },
      children: [
        new xb.UIText({
          text: 'CareGrid Spatial Triage & Queue',
          style: { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
        }),
        this.spatialStatusText,
        this.spatialBodyText,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 10 },
          children: [
            new xb.UIButton({
              label: '1 - Prescription',
              icon: 'medication',
              style: { flexGrow: 1 },
              onClick: () => {
                const s = store.getState();
                this.spatialBodyText.text = s.triage.prescriptionText;
                void speakMultilingual(s.triage.prescriptionText, s.lang);
              },
            }),
            new xb.UIButton({
              label: '2 - Explanation',
              icon: 'info',
              style: { flexGrow: 1 },
              onClick: () => {
                const s = store.getState();
                this.spatialBodyText.text = s.triage.explanationText;
                void speakMultilingual(s.triage.explanationText, s.lang);
              },
            }),
          ],
        }),
      ],
    });

    this.spatialCard.position.set(0, 0.36, -1.45);
    this.add(this.spatialCard);
  }

  private syncFromStore(): void {
    const s = store.getState();
    const strings = getLocaleStrings(s.lang);
    const ticket = s.queueTickets[0];
    const nurse = s.nurseBookings[0];
    if (this.spatialStatusText) {
      const roomClean = (ticket ? `${ticket.roomLocation} (${ticket.slotTime})` : 'Queue Ready').replace(/·/g, '-');
      this.spatialStatusText.text = `${s.profile.profileId} - ${roomClean} - Nurse ETA ${nurse ? `${nurse.etaMinutes}m` : '--'}`;
    }
    if (this.spatialBodyText && !this.spatialBodyText.text.includes('Rx')) {
      this.spatialBodyText.text = `${strings.prescriptionBtn} / ${strings.explanationBtn}`.replace(/·/g, '-');
    }
  }

  update(): void {
    const now = performance.now();
    const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 0.016;
    this.lastTick = now;

    this.orbitAngle += dt * 0.45;
    const radius = 0.67;

    this.vehicleGroup.position.set(Math.cos(this.orbitAngle) * radius, 0, Math.sin(this.orbitAngle) * radius);
    this.vehicleGroup.rotation.y = -this.orbitAngle + Math.PI / 2;

    const vanAngle = this.orbitAngle + Math.PI;
    this.vanGroup.position.set(Math.cos(vanAngle) * radius, 0, Math.sin(vanAngle) * radius);
    this.vanGroup.rotation.y = -vanAngle + Math.PI / 2;

    if (this.beaconMesh) {
      this.beaconMesh.position.y = 0.32 + Math.sin(now * 0.003) * 0.012;
    }
  }

  dispose(): void {
    if (this.unsubscribeStore) this.unsubscribeStore();
    if (this.envRT) this.envRT.dispose();
    for (const item of this.disposables) item.dispose();
  }
}
