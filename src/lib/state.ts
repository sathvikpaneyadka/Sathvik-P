import type { User } from 'firebase/auth';
import { getLocaleStrings, type SupportedLang } from '../core/i18n';
import {
  allocateSmartQueueSlot,
  canAccessPatientProfile,
  computeUpdatedRating,
  generateUniqueProfileId,
  type ProductItem,
} from '../core/queueSupplyRules';
import {
  createEscalatedComplaint,
  type KeypadPatientContext,
} from '../core/smsIvrEngine';
import {
  evaluateInventoryThresholdTrigger,
  type SupplyAlertRecord,
  type SupplyTriggerSource,
} from '../core/supplyAlertEngine';
import {
  auth,
  subscribeSupplyAlertsFirestore,
  syncFirestoreDocument,
  syncSupplyAlertFirestore,
} from './firebase';

export type ActiveTab = 'overview' | 'clinical' | 'map' | 'keypad' | 'spatial';

export interface ReviewRecord {
  id: string;
  productSku: string;
  authorName: string;
  businessType: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface SupplierMessageRecord {
  id: string;
  supplierName: string;
  businessTier: 'small' | 'enterprise';
  direction: 'outbound' | 'inbound';
  body: string;
  createdAt: string;
}

export interface OrderRecord {
  orderCode: string;
  profileId: string;
  itemSummary: string;
  totalCents: number;
  status: 'packed' | 'in_transit' | 'delivered';
  destAddress: string;
  courierLat: number;
  courierLng: number;
  etaMinutes: number;
  updatedAt: string;
}

export interface NurseBookingRecord {
  bookingCode: string;
  profileId: string;
  nurseName: string;
  serviceType: string;
  address: string;
  scheduledSlot: string;
  status: 'dispatched' | 'en_route' | 'arrived' | 'completed';
  nurseLat: number;
  nurseLng: number;
  etaMinutes: number;
}

export interface SmartQueueTicketRecord {
  ticketCode: string;
  profileId: string;
  clinicName: string;
  roomLocation: string;
  slotTime: string;
  verificationMethod: 'photo_match' | 'keypad_token';
  photoTag: string;
  status: 'waiting' | 'notified' | 'in_room' | 'completed';
  waitMinutes: number;
}

export interface SmsLogRecord {
  id: string;
  direction: 'inbound' | 'outbound' | 'periodic_alert';
  command: string;
  message: string;
  language: SupportedLang;
  timestamp: string;
}

export interface IvrEventRecord {
  id: string;
  digit: string;
  menuAction: string;
  audioResponseText: string;
  smsConfirmationText: string;
  timestamp: string;
}

export interface ComplaintRecord {
  complaintCode: string;
  profileId: string;
  channel: 'sms' | 'ivr' | 'web';
  category: string;
  description: string;
  assignedSupervisor: string;
  status: 'escalated' | 'acknowledged' | 'resolved';
  createdAt: string;
}

export interface PatientProfileState {
  profileId: string;
  ownerUid: string;
  fullName: string;
  phone: string;
  otpVerified: boolean;
  keypadPinVerified: boolean;
  expectedOtp: string;
  keypadPinCode: string;
  securityAnswer: string;
  allergies: string;
  medicalHistory: string;
}

export interface ClinicalTriageState {
  symptomText: string;
  prescriptionText: string;
  explanationText: string;
  severity: 'routine' | 'priority' | 'urgent';
  recommendedSpecialty: string;
  smsSummary: string;
  photoDataUrl: string | null;
  photoLabel: string;
  voiceTranscript: string;
  lastUpdated: string;
}

export interface AppState {
  activeTab: ActiveTab;
  lang: SupportedLang;
  currentUser: User | null;
  profile: PatientProfileState;
  triage: ClinicalTriageState;
  products: ProductItem[];
  reviews: ReviewRecord[];
  supplierMessages: SupplierMessageRecord[];
  orders: OrderRecord[];
  nurseBookings: NurseBookingRecord[];
  queueTickets: SmartQueueTicketRecord[];
  smsLogs: SmsLogRecord[];
  ivrEvents: IvrEventRecord[];
  complaints: ComplaintRecord[];
  salesWeekly: Array<{ day: string; clinicSalesUsd: number; homeCareUsd: number }>;
  supplyAlerts: SupplyAlertRecord[];
  alertDrawerOpen: boolean;
  alertFilter: 'all' | 'active' | 'critical' | 'resolved';
  lastAlertTriggerNote: string;
  toastMessage: string | null;
  quotaExceeded: boolean;
}

const STORAGE_KEY = 'caregrid_os_state_v1';

function createInitialState(): AppState {
  const defaultProfileId = 'HC-ANA48210';
  return {
    activeTab: 'overview',
    lang: 'en',
    currentUser: null,
    profile: {
      profileId: defaultProfileId,
      ownerUid: 'local-owner',
      fullName: 'Ananya Rao',
      phone: '+91 98450 22190',
      otpVerified: true,
      keypadPinVerified: true,
      expectedOtp: '739204',
      keypadPinCode: '4821',
      securityAnswer: 'lotus',
      allergies: 'Penicillin mild rash',
      medicalHistory: 'Seasonal bronchitis (2024), Vitamin D deficiency, outpatient blood pressure follow-up.',
    },
    triage: {
      symptomText: 'Persistent dry cough and 100.4F low-grade fever since yesterday evening.',
      prescriptionText:
        'Rx Plan [1]: Paracetamol 500mg every 6h after food (max 3g/day) + Ambroxol 30mg syrup 5ml twice daily for 5 days. Warm saline gargles morning/night. Seek urgent clinician review if SpO2 drops below 94%.',
      explanationText:
        'Medical Explanation [2]: Symptoms align with an acute upper-respiratory viral or mild bronchial irritation. Maintain 2.5L oral hydration, rest in an elevated posture, and avoid cold aerosol triggers for 72 hours.',
      severity: 'priority',
      recommendedSpecialty: 'General Medicine & Respiratory Nurse',
      smsSummary: 'CareGrid Rx: Paracetamol 500mg q6h + warm fluids. Queue: Wing B Rm 204 at 14:30.',
      photoDataUrl: null,
      photoLabel: '',
      voiceTranscript: '',
      lastUpdated: 'Just synced',
    },
    products: [
      {
        sku: 'CG-INF-104',
        name: 'Smart Micro-Infusion Care Kit',
        category: 'infusion',
        priceCents: 14800,
        stockQty: 64,
        reorderThreshold: 25,
        supplierName: 'MedVantage Cold-Chain',
        businessTier: 'all',
        ratingAvg: 4.9,
        reviewCount: 42,
      },
      {
        sku: 'CG-CLD-209',
        name: 'CryoTemp Vaccine & Insulin Carrier (8L)',
        category: 'cold_chain',
        priceCents: 21500,
        stockQty: 18,
        reorderThreshold: 24,
        supplierName: 'BioFrost Logistics',
        businessTier: 'enterprise',
        ratingAvg: 4.8,
        reviewCount: 31,
      },
      {
        sku: 'CG-DGN-315',
        name: 'Clinic Rapid Vitals & Pulse-Ox Pack',
        category: 'diagnostics',
        priceCents: 8900,
        stockQty: 92,
        reorderThreshold: 30,
        supplierName: 'CareSource Direct',
        businessTier: 'small',
        ratingAvg: 4.7,
        reviewCount: 58,
      },
      {
        sku: 'CG-HMC-422',
        name: 'Home Nurse Sterile Wound Dressing Bundle',
        category: 'home_care',
        priceCents: 5400,
        stockQty: 9,
        reorderThreshold: 25,
        supplierName: 'CareSource Direct',
        businessTier: 'small',
        ratingAvg: 4.9,
        reviewCount: 67,
      },
    ],
    reviews: [
      {
        id: 'REV-101',
        productSku: 'CG-INF-104',
        authorName: 'Dr. S. Kulkarni',
        businessType: 'Multi-Specialty Clinic',
        rating: 5,
        comment: 'Zero leakage valves and batch expiry tracking cut our ward prep time by 35%.',
        createdAt: '2h ago',
      },
      {
        id: 'REV-102',
        productSku: 'CG-CLD-209',
        authorName: 'Apex Pharmacy Network',
        businessType: 'Enterprise Supply Hub',
        rating: 5,
        comment: 'Maintained 3.2C stability across a 6-hour metro route with live telemetry sync.',
        createdAt: '5h ago',
      },
      {
        id: 'REV-103',
        productSku: 'CG-HMC-422',
        authorName: 'RN Kavita Nair',
        businessType: 'Independent Home Care',
        rating: 5,
        comment: 'Compact sterile packs fit right in our scooter dispatch kit for senior visits.',
        createdAt: '1d ago',
      },
    ],
    supplierMessages: [
      {
        id: 'SUP-1',
        supplierName: 'MedVantage Cold-Chain',
        businessTier: 'enterprise',
        direction: 'inbound',
        body: 'Batch #MV-8840 cleared QA inspection. 40 infusion kits staged for morning dispatch.',
        createdAt: '09:15',
      },
      {
        id: 'SUP-2',
        supplierName: 'CareSource Direct',
        businessTier: 'small',
        direction: 'outbound',
        body: 'Requesting priority restock of 30 units CG-HMC-422 for small-clinic home nurse routes.',
        createdAt: '10:02',
      },
    ],
    orders: [
      {
        orderCode: 'ORD-9024',
        profileId: defaultProfileId,
        itemSummary: '2x Smart Micro-Infusion Care Kit + Sterile Pack',
        totalCents: 35000,
        status: 'in_transit',
        destAddress: 'Indiranagar 100ft Rd, Sector 4',
        courierLat: 12.9762,
        courierLng: 77.6248,
        etaMinutes: 14,
        updatedAt: 'Live GPS',
      },
    ],
    nurseBookings: [
      {
        bookingCode: 'NR-418',
        profileId: defaultProfileId,
        nurseName: 'RN Priya Menon',
        serviceType: 'Vitals Check, IV Hydration & Nebulization',
        address: '14 Residency Lane, Indiranagar',
        scheduledSlot: '15:00 Today',
        status: 'en_route',
        nurseLat: 12.9698,
        nurseLng: 77.6112,
        etaMinutes: 12,
      },
    ],
    queueTickets: [
      {
        ticketCode: 'SQ-20418',
        profileId: defaultProfileId,
        clinicName: 'CareGrid Metro Hub',
        roomLocation: 'Wing B · Consultation Room 204',
        slotTime: '14:30',
        verificationMethod: 'photo_match',
        photoTag: 'Photo Verified (arrival-checkin.jpg)',
        status: 'waiting',
        waitMinutes: 12,
      },
    ],
    smsLogs: [
      {
        id: 'SMS-1',
        direction: 'inbound',
        command: 'QUEUE',
        message: 'QUEUE',
        language: 'en',
        timestamp: '10:14',
      },
      {
        id: 'SMS-2',
        direction: 'outbound',
        command: 'QUEUE',
        message: 'Smart Queue Confirmed [HC-ANA48210]: CareGrid Metro Hub, Wing B · Consultation Room 204 at 14:30. Est. wait: 12 min.',
        language: 'en',
        timestamp: '10:14',
      },
      {
        id: 'SMS-3',
        direction: 'periodic_alert',
        command: 'ALERT',
        message: 'Periodic Update: RN Priya Menon is 1.9 km away (ETA 12 min). Reply 9 if delayed.',
        language: 'en',
        timestamp: '10:20',
      },
    ],
    ivrEvents: [
      {
        id: 'IVR-1',
        digit: '4',
        menuAction: 'NURSE_DISPATCH_STATUS',
        audioResponseText: 'Home Nurse Dispatch: RN Priya Menon is en_route and arriving in 12 minutes.',
        smsConfirmationText: 'IVR Confirmation [4]: RN Priya Menon ETA 12 min.',
        timestamp: '10:18',
      },
    ],
    complaints: [
      {
        complaintCode: 'ESC-48219',
        profileId: 'HC-DEV90112',
        channel: 'sms',
        category: 'delivery_delay',
        description: 'Cold-chain insulin carrier delayed 25 mins at East Clinic dock.',
        assignedSupervisor: 'R. Kapoor · Logistics Lead',
        status: 'escalated',
        createdAt: '10:05',
      },
      {
        complaintCode: 'ESC-48204',
        profileId: 'HC-ANA48210',
        channel: 'ivr',
        category: 'clinical_care',
        description: 'Requested senior nurse confirmation for pediatric nebulizer dose.',
        assignedSupervisor: 'Dr. M. Alvarez · Chief Nursing Officer',
        status: 'acknowledged',
        createdAt: '09:42',
      },
    ],
    salesWeekly: [
      { day: 'Mon', clinicSalesUsd: 4200, homeCareUsd: 1650 },
      { day: 'Tue', clinicSalesUsd: 5100, homeCareUsd: 1920 },
      { day: 'Wed', clinicSalesUsd: 4850, homeCareUsd: 2140 },
      { day: 'Thu', clinicSalesUsd: 6320, homeCareUsd: 2480 },
      { day: 'Fri', clinicSalesUsd: 6940, homeCareUsd: 2810 },
      { day: 'Sat', clinicSalesUsd: 5890, homeCareUsd: 3120 },
      { day: 'Sun', clinicSalesUsd: 4720, homeCareUsd: 2940 },
    ],
    supplyAlerts: [],
    alertDrawerOpen: false,
    alertFilter: 'all',
    lastAlertTriggerNote: 'Monitoring database stock thresholds',
    toastMessage: null,
    quotaExceeded: false,
  };
}

class CareGridStore {
  private state: AppState;
  private listeners = new Set<() => void>();
  private alertEventSource: EventSource | null = null;
  private firestoreAlertsUnsub: (() => void) | null = null;

  constructor() {
    this.state = this.loadState();
    const initialEval = evaluateInventoryThresholdTrigger(
      this.state.products,
      this.state.supplyAlerts,
      'db_threshold_sweep'
    );
    this.state.supplyAlerts = initialEval.alerts;
  }

  private loadState(): AppState {
    const fallback = createInitialState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<AppState>;
      const merged: AppState = {
        ...fallback,
        ...parsed,
        currentUser: null,
        alertDrawerOpen: false,
        toastMessage: null,
        quotaExceeded: false,
      };
      const evalResult = evaluateInventoryThresholdTrigger(
        merged.products,
        merged.supplyAlerts || [],
        'db_threshold_sweep'
      );
      merged.supplyAlerts = evalResult.alerts;
      return merged;
    } catch {
      return fallback;
    }
  }

  private saveLocal(): void {
    try {
      const serializable = { ...this.state, currentUser: null, toastMessage: null, quotaExceeded: false };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch {
      // Ignore storage quota issues
    }
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.saveLocal();
    for (const listener of this.listeners) {
      listener();
    }
  }

  showToast(message: string): void {
    this.state.toastMessage = message;
    this.notify();
    window.setTimeout(() => {
      if (this.state.toastMessage === message) {
        this.state.toastMessage = null;
        this.notify();
      }
    }, 3800);
  }

  setTab(tab: ActiveTab): void {
    this.state.activeTab = tab;
    this.notify();
  }

  setLanguage(lang: SupportedLang): void {
    this.state.lang = lang;
    this.notify();
  }

  setQuotaExceeded(val: boolean): void {
    if (this.state.quotaExceeded === val) return;
    this.state.quotaExceeded = val;
    this.notify();
  }

  setAuthUser(user: User | null): void {
    this.state.currentUser = user;
    if (this.firestoreAlertsUnsub) {
      this.firestoreAlertsUnsub();
      this.firestoreAlertsUnsub = null;
    }
    if (user) {
      this.state.profile.ownerUid = user.uid;
      if (user.displayName && this.state.profile.fullName === 'Ananya Rao') {
        this.state.profile.fullName = user.displayName;
      }
      void this.syncProfileToCloud();
      this.firestoreAlertsUnsub = subscribeSupplyAlertsFirestore(user.uid, (remoteAlerts) => {
        let changed = false;
        for (const remote of remoteAlerts) {
          const local = this.state.supplyAlerts.find((a) => a.alertCode === remote.alertId);
          if (local && local.status !== remote.status) {
            local.status = remote.status;
            changed = true;
          }
        }
        if (changed) this.notify();
      });
    } else {
      this.state.profile.ownerUid = 'local-owner';
    }
    this.notify();
  }

  initSupplyAlertMonitor(): void {
    if (typeof window === 'undefined' || this.alertEventSource) return;

    // Push initial inventory snapshot to backend trigger engine so local/DB threshold state matches
    void fetch('/api/alerts/supplies/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggeredBy: 'db_threshold_sweep',
        products: this.state.products,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (payload?.alerts) {
          this.applyServerAlertEvaluation(payload, false);
        }
      })
      .catch(() => {
        // Local threshold evaluator already active
      });

    if (typeof EventSource !== 'undefined') {
      const es = new EventSource('/api/alerts/stream');
      this.alertEventSource = es;
      es.addEventListener('supply_alert_update', (evt) => {
        try {
          const payload = JSON.parse((evt as MessageEvent).data);
          this.applyServerAlertEvaluation(payload, true);
        } catch {
          // Ignore malformed stream frame
        }
      });
    }
  }

  private applyServerAlertEvaluation(
    payload: {
      triggeredBy?: string;
      products?: ProductItem[];
      alerts?: SupplyAlertRecord[];
      newlyTriggered?: SupplyAlertRecord[];
      escalatedToCritical?: SupplyAlertRecord[];
      autoResolved?: SupplyAlertRecord[];
    },
    announceChanges: boolean
  ): void {
    if (!Array.isArray(payload.alerts)) return;

    // Preserve any existing acknowledged state if newly evaluated server snapshot hasn't received it yet
    const mergedAlerts = payload.alerts.map((srv) => {
      const prev = this.state.supplyAlerts.find((a) => a.alertCode === srv.alertCode);
      if (prev && prev.status === 'acknowledged' && srv.status === 'active' && srv.severity === prev.severity) {
        return { ...srv, status: 'acknowledged' as const, acknowledgedBy: prev.acknowledgedBy };
      }
      return srv;
    });

    this.state.supplyAlerts = mergedAlerts;
    if (Array.isArray(payload.products) && payload.products.length > 0) {
      this.state.products = payload.products;
    }
    if (payload.triggeredBy) {
      this.state.lastAlertTriggerNote = `Trigger: ${payload.triggeredBy} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    const alertsToNotify = [
      ...(payload.newlyTriggered || []),
      ...(payload.escalatedToCritical || []),
    ];

    if (announceChanges && alertsToNotify.length > 0) {
      const top = alertsToNotify[0];
      this.pushPeriodicAlert('SUPPLY_THRESHOLD', top.smsDispatchSummary);
      this.showToast(
        `${top.severity === 'critical' ? 'CRITICAL' : 'LOW'} STOCK: ${top.sku} at ${top.stockQty} units (threshold ${top.reorderThreshold})`
      );
      if (auth.currentUser) {
        for (const al of alertsToNotify) {
          void syncSupplyAlertFirestore(al);
        }
      }
    }

    this.notify();
  }

  toggleAlertDrawer(force?: boolean): void {
    this.state.alertDrawerOpen = typeof force === 'boolean' ? force : !this.state.alertDrawerOpen;
    this.notify();
  }

  setAlertFilter(filter: 'all' | 'active' | 'critical' | 'resolved'): void {
    this.state.alertFilter = filter;
    this.notify();
  }

  private runLocalThresholdEvaluation(triggeredBy: SupplyTriggerSource, announce: boolean): void {
    const evaluation = evaluateInventoryThresholdTrigger(
      this.state.products,
      this.state.supplyAlerts,
      triggeredBy
    );
    this.state.supplyAlerts = evaluation.alerts;
    this.state.lastAlertTriggerNote = `Trigger: ${triggeredBy} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const urgentOnes = [...evaluation.newlyTriggered, ...evaluation.escalatedToCritical];
    if (announce && urgentOnes.length > 0) {
      const top = urgentOnes[0];
      this.pushPeriodicAlert('SUPPLY_THRESHOLD', top.smsDispatchSummary);
      this.showToast(
        `${top.severity === 'critical' ? 'CRITICAL' : 'LOW'} STOCK: ${top.sku} at ${top.stockQty} units (min ${top.reorderThreshold})`
      );
      if (auth.currentUser) {
        for (const al of urgentOnes) {
          void syncSupplyAlertFirestore(al);
        }
      }
    }
    if (auth.currentUser && evaluation.autoResolved.length > 0) {
      for (const al of evaluation.autoResolved) {
        void syncSupplyAlertFirestore(al);
      }
    }
  }

  private async postProtectedSql(path: string, body: unknown): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Silent SQL proxy resilience
    }
  }

  async syncProfileToCloud(): Promise<void> {
    const p = this.state.profile;
    if (!auth.currentUser) return;
    await syncFirestoreDocument('users', `${auth.currentUser.uid}/public/card`, {
      uid: auth.currentUser.uid,
      displayName: p.fullName,
      preferredLang: this.state.lang,
    });
    await syncFirestoreDocument('users', `${auth.currentUser.uid}/private/info`, {
      uid: auth.currentUser.uid,
      email: auth.currentUser.email || 'patient@caregrid.local',
      phone: p.phone,
      uniqueProfileId: p.profileId,
      createdAt: new Date(),
    });
    await syncFirestoreDocument('patientProfiles', p.profileId, {
      profileId: p.profileId,
      ownerUid: auth.currentUser.uid,
      language: this.state.lang,
      verificationMode: p.otpVerified ? 'otp' : p.keypadPinVerified ? 'keypad_pin' : 'unverified',
      allergies: p.allergies,
      chronicNotes: p.medicalHistory,
      createdAt: new Date(),
    });
    await this.postProtectedSql('/api/db/profile', {
      profileId: p.profileId,
      fullName: p.fullName,
      phone: p.phone,
      preferredLang: this.state.lang,
      otpVerified: p.otpVerified,
      keypadPinVerified: p.keypadPinVerified,
      keypadPinCode: p.keypadPinCode,
      securityChallenge: p.securityAnswer,
      allergies: p.allergies,
      medicalHistory: p.medicalHistory,
    });
  }

  registerPatientProfile(input: {
    fullName: string;
    phone: string;
    allergies: string;
    medicalHistory: string;
    keypadPinCode: string;
    securityAnswer: string;
  }): { ok: boolean; profileId: string } {
    const activeUid = auth.currentUser?.uid || 'local-owner';
    const nextId = generateUniqueProfileId(input.fullName);
    this.state.profile = {
      profileId: nextId,
      ownerUid: activeUid,
      fullName: input.fullName.trim() || 'CareGrid Patient',
      phone: input.phone.trim() || '+91 90000 00000',
      otpVerified: false,
      keypadPinVerified: false,
      expectedOtp: '739204',
      keypadPinCode: /^\d{4}$/.test(input.keypadPinCode.trim()) ? input.keypadPinCode.trim() : '4821',
      securityAnswer: input.securityAnswer.trim() || 'lotus',
      allergies: input.allergies.trim() || 'None reported',
      medicalHistory: input.medicalHistory.trim() || 'Initial outpatient registration',
    };
    this.notify();
    void this.syncProfileToCloud();
    this.showToast(`Registered isolated Profile ID ${nextId}`);
    return { ok: true, profileId: nextId };
  }

  checkProfileAccess(): boolean {
    const requester = auth.currentUser?.uid || 'local-owner';
    return canAccessPatientProfile(requester, this.state.profile.ownerUid);
  }

  markVerification(mode: 'otp' | 'keypad', passed: boolean): void {
    if (mode === 'otp') this.state.profile.otpVerified = passed;
    else this.state.profile.keypadPinVerified = passed;
    this.notify();
    void this.syncProfileToCloud();
  }

  updateTriage(patch: Partial<ClinicalTriageState>): void {
    this.state.triage = {
      ...this.state.triage,
      ...patch,
      lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.notify();
    void this.postProtectedSql('/api/db/triage', {
      profileId: this.state.profile.profileId,
      language: this.state.lang,
      channel: 'web',
      symptomText: this.state.triage.symptomText,
      prescriptionText: this.state.triage.prescriptionText,
      explanationText: this.state.triage.explanationText,
      severity: this.state.triage.severity,
    });
  }

  bookSmartQueue(input: {
    clinicName: string;
    urgency: 'routine' | 'priority' | 'urgent';
    verificationMethod: 'photo_match' | 'keypad_token';
    photoUploaded: boolean;
    photoLabel?: string;
  }): SmartQueueTicketRecord {
    const allocation = allocateSmartQueueSlot({
      profileId: this.state.profile.profileId,
      clinicName: input.clinicName,
      urgency: input.urgency,
      verificationMethod: input.verificationMethod,
      photoUploaded: input.photoUploaded,
      photoLabel: input.photoLabel,
      existingQueueCount: this.state.queueTickets.length,
    });

    const ticket: SmartQueueTicketRecord = {
      ticketCode: allocation.ticketCode,
      profileId: this.state.profile.profileId,
      clinicName: input.clinicName,
      roomLocation: allocation.roomLocation,
      slotTime: allocation.slotTime,
      verificationMethod: allocation.verificationMethod,
      photoTag: allocation.photoTag,
      status: 'waiting',
      waitMinutes: allocation.waitMinutes,
    };

    this.state.queueTickets = [ticket, ...this.state.queueTickets];
    this.pushPeriodicAlert(
      'QUEUE',
      `Smart Queue Ticket ${ticket.ticketCode} confirmed: ${ticket.clinicName}, ${ticket.roomLocation} at ${ticket.slotTime}. ${ticket.photoTag}.`
    );
    this.notify();

    if (auth.currentUser) {
      void syncFirestoreDocument('queueTickets', ticket.ticketCode, {
        ticketId: ticket.ticketCode,
        ownerUid: auth.currentUser.uid,
        profileId: ticket.profileId,
        clinicName: ticket.clinicName,
        roomLocation: ticket.roomLocation,
        scheduledTime: ticket.slotTime,
        verificationMethod: ticket.verificationMethod,
        status: ticket.status,
        createdAt: new Date(),
      });
      void this.postProtectedSql('/api/db/queue-tickets', ticket);
    }

    this.showToast(`Queue ticket ${ticket.ticketCode} ready for ${ticket.slotTime}`);
    return ticket;
  }

  bookHomeNurse(input: {
    nurseName: string;
    serviceType: string;
    address: string;
    scheduledSlot: string;
  }): NurseBookingRecord {
    const code = `NR-${String(Date.now()).slice(-4)}`;
    const booking: NurseBookingRecord = {
      bookingCode: code,
      profileId: this.state.profile.profileId,
      nurseName: input.nurseName,
      serviceType: input.serviceType,
      address: input.address,
      scheduledSlot: input.scheduledSlot,
      status: 'dispatched',
      nurseLat: 12.9748 + (Math.random() - 0.5) * 0.012,
      nurseLng: 77.6085 + (Math.random() - 0.5) * 0.012,
      etaMinutes: 15,
    };
    this.state.nurseBookings = [booking, ...this.state.nurseBookings];
    const lastDay = this.state.salesWeekly[this.state.salesWeekly.length - 1];
    if (lastDay) lastDay.homeCareUsd += 95;
    this.pushPeriodicAlert(
      'NURSE',
      `Home Nurse ${booking.nurseName} dispatched (${booking.bookingCode}) for ${booking.serviceType}. ETA ${booking.etaMinutes} min.`
    );
    this.notify();

    if (auth.currentUser) {
      void syncFirestoreDocument('dispatches', code, {
        dispatchId: code,
        ownerUid: auth.currentUser.uid,
        kind: 'nurse_visit',
        assigneeName: booking.nurseName,
        lat: booking.nurseLat,
        lng: booking.nurseLng,
        etaMinutes: booking.etaMinutes,
        status: 'dispatched',
        createdAt: new Date(),
      });
      void this.postProtectedSql('/api/db/nurse-bookings', booking);
    }

    this.showToast(`Dispatched ${booking.nurseName} (${code})`);
    return booking;
  }

  placeSupplyOrder(sku: string, quantity: number, destAddress: string): OrderRecord | null {
    const product = this.state.products.find((p) => p.sku === sku);
    if (!product) return null;
    const qty = Math.max(1, Math.min(quantity, product.stockQty));
    product.stockQty = Math.max(0, product.stockQty - qty);

    const orderCode = `ORD-${String(Date.now()).slice(-4)}`;
    const totalCents = product.priceCents * qty;
    const order: OrderRecord = {
      orderCode,
      profileId: this.state.profile.profileId,
      itemSummary: `${qty}x ${product.name}`,
      totalCents,
      status: 'in_transit',
      destAddress: destAddress.trim() || 'CareGrid Partner Clinic #12',
      courierLat: 12.9791,
      courierLng: 77.5994,
      etaMinutes: 19,
      updatedAt: 'Dispatched now',
    };
    this.state.orders = [order, ...this.state.orders];
    const lastDay = this.state.salesWeekly[this.state.salesWeekly.length - 1];
    if (lastDay) lastDay.clinicSalesUsd += Math.round(totalCents / 100);
    this.pushPeriodicAlert(
      'ORDER',
      `Order ${orderCode} (${qty}x ${product.name}) in transit to ${order.destAddress}. ETA 19 min.`
    );
    this.runLocalThresholdEvaluation('db_order_decrement', true);
    this.notify();
    void fetch('/api/alerts/supplies/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggeredBy: 'db_order_decrement',
        products: this.state.products,
      }),
    });
    void this.postProtectedSql('/api/db/orders', { ...order, sku, qty });
    this.showToast(`Supply order ${orderCode} dispatched`);
    return order;
  }

  consumeSupplyUnits(sku: string, qty = 10): void {
    const product = this.state.products.find((p) => p.sku === sku);
    if (!product) return;
    const dec = Math.max(1, Math.floor(qty));
    product.stockQty = Math.max(0, product.stockQty - dec);
    this.runLocalThresholdEvaluation('clinical_consumption', true);
    this.notify();

    void fetch('/api/supplies/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, qty: dec, products: this.state.products }),
    });
    void this.postProtectedSql('/api/db/supplies/trigger', {
      sku,
      deltaQty: -dec,
      triggeredBy: 'clinical_consumption',
    });
  }

  updateSupplyThreshold(sku: string, nextThreshold: number): void {
    const product = this.state.products.find((p) => p.sku === sku);
    if (!product) return;
    const safeThreshold = Math.max(1, Math.floor(nextThreshold));
    product.reorderThreshold = safeThreshold;
    this.runLocalThresholdEvaluation('threshold_policy_update', true);
    this.notify();

    void fetch('/api/supplies/threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, reorderThreshold: safeThreshold, products: this.state.products }),
    });
    void this.postProtectedSql('/api/db/supplies/trigger', {
      sku,
      reorderThreshold: safeThreshold,
      triggeredBy: 'threshold_policy_update',
    });
    this.showToast(`Updated ${sku} alert threshold to ${safeThreshold} units`);
  }

  restockProduct(sku: string, addQty = 40): void {
    const product = this.state.products.find((p) => p.sku === sku);
    if (!product) return;
    product.stockQty += addQty;
    this.state.supplierMessages = [
      {
        id: `SUP-${Date.now()}`,
        supplierName: product.supplierName,
        businessTier: product.businessTier === 'enterprise' ? 'enterprise' : 'small',
        direction: 'inbound',
        body: `Confirmed replenishment +${addQty} units of ${product.name} (${product.sku}).`,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      ...this.state.supplierMessages,
    ];
    this.runLocalThresholdEvaluation('restock_replenishment', false);
    this.notify();
    void fetch('/api/supplies/restock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, qty: addQty, products: this.state.products }),
    });
    void this.postProtectedSql('/api/db/supplies/trigger', {
      sku,
      deltaQty: addQty,
      triggeredBy: 'restock_replenishment',
    });
    this.showToast(`Restocked +${addQty} units of ${product.sku}`);
  }

  acknowledgeSupplyAlert(alertCode: string): void {
    const alert = this.state.supplyAlerts.find((a) => a.alertCode === alertCode);
    if (!alert || alert.status === 'resolved') return;
    alert.status = 'acknowledged';
    alert.acknowledgedBy = this.state.profile.fullName;
    alert.updatedAt = new Date().toISOString();
    this.notify();

    void fetch(`/api/alerts/supplies/${encodeURIComponent(alertCode)}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffName: this.state.profile.fullName }),
    });
    if (auth.currentUser) {
      void syncSupplyAlertFirestore(alert);
      void this.postProtectedSql(`/api/db/supplies/alerts/${encodeURIComponent(alertCode)}/status`, {
        status: 'acknowledged',
      });
    }
    this.showToast(`Acknowledged supply alert ${alertCode}`);
  }

  resolveSupplyAlert(alertCode: string): void {
    const alert = this.state.supplyAlerts.find((a) => a.alertCode === alertCode);
    if (!alert) return;
    alert.status = 'resolved';
    alert.updatedAt = new Date().toISOString();
    this.notify();

    void fetch(`/api/alerts/supplies/${encodeURIComponent(alertCode)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (auth.currentUser) {
      void syncSupplyAlertFirestore(alert);
      void this.postProtectedSql(`/api/db/supplies/alerts/${encodeURIComponent(alertCode)}/status`, {
        status: 'resolved',
      });
    }
    this.showToast(`Resolved supply alert ${alertCode}`);
  }

  submitProductReview(sku: string, authorName: string, businessType: string, rating: number, comment: string): void {
    const product = this.state.products.find((p) => p.sku === sku);
    if (!product) return;
    const updated = computeUpdatedRating(product.ratingAvg, product.reviewCount, rating);
    product.ratingAvg = updated.ratingAvg;
    product.reviewCount = updated.reviewCount;

    const review: ReviewRecord = {
      id: `REV-${Date.now()}`,
      productSku: sku,
      authorName: authorName.trim() || this.state.profile.fullName,
      businessType: businessType.trim() || 'Healthcare Partner',
      rating,
      comment: comment.trim(),
      createdAt: 'Just now',
    };
    this.state.reviews = [review, ...this.state.reviews];
    this.notify();
    void this.postProtectedSql('/api/db/reviews', {
      productSku: sku,
      authorName: review.authorName,
      rating,
      comment: review.comment,
    });
    this.showToast(`Verified review published for ${product.sku}`);
  }

  sendSupplierMessage(supplierName: string, businessTier: 'small' | 'enterprise', body: string): void {
    const clean = body.trim();
    if (!clean) return;
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.state.supplierMessages = [
      {
        id: `SUP-${Date.now()}`,
        supplierName,
        businessTier,
        direction: 'outbound',
        body: clean,
        createdAt: nowTime,
      },
      ...this.state.supplierMessages,
    ];
    this.notify();
    void this.postProtectedSql('/api/db/supplier-messages', {
      supplierName,
      businessTier,
      direction: 'outbound',
      body: clean,
    });
    this.showToast(`Dispatched purchase note to ${supplierName}`);
  }

  getKeypadContext(): KeypadPatientContext {
    const strings = getLocaleStrings(this.state.lang);
    const activeTicket = this.state.queueTickets[0] ?? null;
    const activeNurse = this.state.nurseBookings[0] ?? null;
    const activeOrder = this.state.orders[0] ?? null;
    return {
      profileId: this.state.profile.profileId,
      fullName: this.state.profile.fullName,
      language: this.state.lang,
      keypadPin: this.state.profile.keypadPinCode,
      securityAnswer: this.state.profile.securityAnswer,
      activePrescription: this.state.triage.prescriptionText,
      activeExplanation: this.state.triage.explanationText,
      queueSummary: activeTicket
        ? {
            clinicName: activeTicket.clinicName,
            roomLocation: activeTicket.roomLocation,
            slotTime: activeTicket.slotTime,
            waitMinutes: activeTicket.waitMinutes,
          }
        : null,
      nurseDispatch: activeNurse
        ? {
            nurseName: activeNurse.nurseName,
            etaMinutes: activeNurse.etaMinutes,
            status: activeNurse.status,
          }
        : null,
      activeOrderStatus: activeOrder
        ? `${activeOrder.itemSummary} (${activeOrder.status}, ETA ${activeOrder.etaMinutes} min)`
        : strings.nurseStatusPrefix,
    };
  }

  recordSmsExchange(
    inboundCommand: string,
    inboundText: string,
    replyText: string,
    periodicAlertPreview: string,
    complaint?: {
      complaintCode: string;
      channel: 'sms' | 'ivr' | 'web';
      category: string;
      assignedSupervisor: string;
      description: string;
      status: 'escalated';
    },
    nextLang?: SupportedLang
  ): void {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const entries: SmsLogRecord[] = [
      {
        id: `SMS-OUT-${Date.now() + 1}`,
        direction: 'outbound',
        command: inboundCommand,
        message: replyText,
        language: nextLang ?? this.state.lang,
        timestamp: nowTime,
      },
      {
        id: `SMS-IN-${Date.now()}`,
        direction: 'inbound',
        command: inboundCommand,
        message: inboundText,
        language: this.state.lang,
        timestamp: nowTime,
      },
    ];
    if (periodicAlertPreview) {
      entries.unshift({
        id: `SMS-ALT-${Date.now() + 2}`,
        direction: 'periodic_alert',
        command: 'ALERT',
        message: periodicAlertPreview,
        language: nextLang ?? this.state.lang,
        timestamp: nowTime,
      });
    }
    this.state.smsLogs = [...entries, ...this.state.smsLogs].slice(0, 40);

    if (nextLang) {
      this.state.lang = nextLang;
    }

    if (complaint) {
      const record: ComplaintRecord = {
        complaintCode: complaint.complaintCode,
        profileId: this.state.profile.profileId,
        channel: complaint.channel,
        category: complaint.category,
        description: complaint.description,
        assignedSupervisor: complaint.assignedSupervisor,
        status: 'escalated',
        createdAt: nowTime,
      };
      this.state.complaints = [record, ...this.state.complaints];
      if (auth.currentUser) {
        void syncFirestoreDocument('escalations', record.complaintCode, {
          escalationId: record.complaintCode,
          ownerUid: auth.currentUser.uid,
          channel: record.channel,
          summary: `${record.assignedSupervisor}: ${record.description}`,
          status: 'escalated',
          createdAt: new Date(),
        });
        void this.postProtectedSql('/api/db/complaints', record);
      }
    }

    this.notify();
    void this.postProtectedSql('/api/db/sms', {
      profileId: this.state.profile.profileId,
      phone: this.state.profile.phone,
      direction: 'inbound',
      language: this.state.lang,
      command: inboundCommand,
      message: inboundText,
    });
  }

  recordIvrInteraction(result: {
    digit: string;
    menuAction: string;
    audioResponseText: string;
    smsConfirmationText: string;
    nextLang?: SupportedLang;
    complaint?: {
      complaintCode: string;
      channel: 'sms' | 'ivr' | 'web';
      category: string;
      assignedSupervisor: string;
      description: string;
      status: 'escalated';
    };
  }): void {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.state.ivrEvents = [
      {
        id: `IVR-${Date.now()}`,
        digit: result.digit,
        menuAction: result.menuAction,
        audioResponseText: result.audioResponseText,
        smsConfirmationText: result.smsConfirmationText,
        timestamp: nowTime,
      },
      ...this.state.ivrEvents,
    ].slice(0, 30);

    if (result.nextLang) {
      this.state.lang = result.nextLang;
    }

    this.state.smsLogs = [
      {
        id: `SMS-IVR-${Date.now()}`,
        direction: 'outbound' as const,
        command: `IVR-${result.digit}`,
        message: result.smsConfirmationText,
        language: this.state.lang,
        timestamp: nowTime,
      },
      ...this.state.smsLogs,
    ].slice(0, 40);

    if (result.complaint) {
      const record: ComplaintRecord = {
        complaintCode: result.complaint.complaintCode,
        profileId: this.state.profile.profileId,
        channel: 'ivr',
        category: result.complaint.category,
        description: result.complaint.description,
        assignedSupervisor: result.complaint.assignedSupervisor,
        status: 'escalated',
        createdAt: nowTime,
      };
      this.state.complaints = [record, ...this.state.complaints];
      void this.postProtectedSql('/api/db/complaints', record);
    }

    this.notify();
    void this.postProtectedSql('/api/db/ivr', {
      profileId: this.state.profile.profileId,
      language: this.state.lang,
      digitPressed: result.digit,
      menuAction: result.menuAction,
      audioPrompt: result.audioResponseText,
    });
  }

  escalateWebComplaint(description: string): ComplaintRecord {
    const esc = createEscalatedComplaint(description, 'web');
    const record: ComplaintRecord = {
      complaintCode: esc.complaintCode,
      profileId: this.state.profile.profileId,
      channel: 'web',
      category: esc.category,
      description: esc.description,
      assignedSupervisor: esc.assignedSupervisor,
      status: 'escalated',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.state.complaints = [record, ...this.state.complaints];
    this.pushPeriodicAlert(
      'ESCALATION',
      `Complaint ${record.complaintCode} routed to ${record.assignedSupervisor}. Periodic SMS status updates active.`
    );
    this.notify();
    void this.postProtectedSql('/api/db/complaints', record);
    this.showToast(`Complaint ${record.complaintCode} routed to ${record.assignedSupervisor}`);
    return record;
  }

  updateComplaintStatus(complaintCode: string, status: 'escalated' | 'acknowledged' | 'resolved'): void {
    const item = this.state.complaints.find((c) => c.complaintCode === complaintCode);
    if (!item) return;
    item.status = status;
    this.pushPeriodicAlert(
      'STATUS',
      `Ticket ${complaintCode} status updated to ${status.toUpperCase()} by ${item.assignedSupervisor}.`
    );
    this.notify();
    void this.postProtectedSql('/api/db/complaints', item);
  }

  pushPeriodicAlert(command: string, message: string): void {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.state.smsLogs = [
      {
        id: `ALERT-${Date.now()}-${Math.floor(Math.random() * 100)}`,
        direction: 'periodic_alert' as const,
        command,
        message,
        language: this.state.lang,
        timestamp: nowTime,
      },
      ...this.state.smsLogs,
    ].slice(0, 40);
  }

  tickLiveTelemetry(): void {
    let changed = false;
    for (const nurse of this.state.nurseBookings) {
      if (nurse.status === 'dispatched' || nurse.status === 'en_route') {
        nurse.status = 'en_route';
        if (nurse.etaMinutes > 2) {
          nurse.etaMinutes -= 1;
          nurse.nurseLat += (12.9716 - nurse.nurseLat) * 0.12;
          nurse.nurseLng += (77.5946 - nurse.nurseLng) * 0.12;
          changed = true;
        }
      }
    }
    for (const order of this.state.orders) {
      if (order.status === 'in_transit' && order.etaMinutes > 2) {
        order.etaMinutes -= 1;
        order.courierLat += (12.9716 - order.courierLat) * 0.12;
        order.courierLng += (77.5946 - order.courierLng) * 0.12;
        changed = true;
      }
    }
    if (changed) this.notify();
  }
}

export const store = new CareGridStore();
