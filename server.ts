import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, Type } from '@google/genai';
import { allocateSmartQueueSlot, type ProductItem } from './src/core/queueSupplyRules.ts';
import {
  evaluateInventoryThresholdTrigger,
  type SupplyAlertRecord,
  type SupplyTriggerSource,
} from './src/core/supplyAlertEngine.ts';
import {
  processIvrDtmf,
  processSmsCommand,
  verifyOtpOrKeypadPin,
  type KeypadPatientContext,
} from './src/core/smsIvrEngine.ts';
import {
  formatSmsConfirmationBody,
  parseIncomingSms,
  resolveBackendTrigger,
  type SmsCommandVerb,
} from './src/services/smsService.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  advanceDispatchTelemetrySql,
  createProductReviewSql,
  ensureUserRecord,
  getLiveDispatchTelemetrySql,
  getUserDashboardData,
  insertIvrEventSql,
  insertNurseBookingSql,
  insertOrderSql,
  insertQueueTicketSql,
  insertSmsLogSql,
  insertSupplierMessageSql,
  insertTriageSessionSql,
  mutateSupplyStockSql,
  runSupplyThresholdTriggerSql,
  updateSupplyAlertStatusSql,
  updateSupplyThresholdSql,
  upsertComplaintSql,
  upsertPatientProfile,
} from './src/db/queries.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

function pcmBase64ToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([wavHeader, pcmBuffer]).toString('base64');
}

function langDisplayName(code: string): string {
  if (code === 'hi') return 'Hindi';
  if (code === 'es') return 'Spanish';
  if (code === 'ta') return 'Tamil';
  return 'English';
}

function parseDataUrl(input: string): { mimeType: string; data: string } | null {
  const match = input.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
  });

  // Authoritative Backend Supply Inventory & Threshold Trigger Engine (synced with SQL when reachable)
  let monitoredInventory: ProductItem[] = [
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
  ];
  let monitoredAlerts: SupplyAlertRecord[] = evaluateInventoryThresholdTrigger(
    monitoredInventory,
    [],
    'db_threshold_sweep'
  ).alerts;

  const alertSseClients = new Set<express.Response>();

  const runBackendSupplyTrigger = (triggeredBy: SupplyTriggerSource, nextInventory?: ProductItem[]) => {
    if (Array.isArray(nextInventory) && nextInventory.length > 0) {
      monitoredInventory = nextInventory.map((item) => ({ ...item }));
    }
    const evaluation = evaluateInventoryThresholdTrigger(
      monitoredInventory,
      monitoredAlerts,
      triggeredBy
    );
    monitoredAlerts = evaluation.alerts;

    const payload = {
      triggeredBy,
      evaluatedAt: new Date().toISOString(),
      products: monitoredInventory,
      ...evaluation,
    };

    const sseBody = `event: supply_alert_update\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of alertSseClients) {
      try {
        client.write(sseBody);
      } catch {
        alertSseClients.delete(client);
      }
    }

    return payload;
  };

  app.get('/api/alerts/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const initialPayload = {
      triggeredBy: 'db_threshold_sweep',
      evaluatedAt: new Date().toISOString(),
      products: monitoredInventory,
      alerts: monitoredAlerts,
      newlyTriggered: [],
      escalatedToCritical: [],
      autoResolved: [],
      summary: evaluateInventoryThresholdTrigger(monitoredInventory, monitoredAlerts, 'db_threshold_sweep').summary,
    };
    res.write(`event: snapshot\ndata: ${JSON.stringify(initialPayload)}\n\n`);
    alertSseClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(keepAlive);
        alertSseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      alertSseClients.delete(res);
    });
  });

  app.get('/api/alerts/supplies', (_req, res) => {
    const result = runBackendSupplyTrigger('db_threshold_sweep');
    res.json({ ok: true, ...result });
  });

  app.post('/api/alerts/supplies/evaluate', (req, res) => {
    const { triggeredBy = 'db_threshold_sweep', products: clientProducts } = (req.body || {}) as {
      triggeredBy?: SupplyTriggerSource;
      products?: ProductItem[];
    };
    const result = runBackendSupplyTrigger(triggeredBy, clientProducts);
    res.json({ ok: true, ...result });
  });

  app.post('/api/supplies/consume', (req, res) => {
    const { sku, qty = 10, products: clientProducts } = (req.body || {}) as {
      sku?: string;
      qty?: number;
      products?: ProductItem[];
    };
    if (!sku) return res.status(400).json({ error: 'sku is required' });
    if (Array.isArray(clientProducts) && clientProducts.length > 0) {
      monitoredInventory = clientProducts.map((p) => ({ ...p }));
    }
    const target = monitoredInventory.find((p) => p.sku === sku);
    if (!target) return res.status(404).json({ error: `Unknown SKU ${sku}` });
    const delta = Math.max(1, Math.floor(qty));
    target.stockQty = Math.max(0, target.stockQty - delta);
    const result = runBackendSupplyTrigger('clinical_consumption');
    res.json({ ok: true, ...result });
  });

  app.post('/api/supplies/restock', (req, res) => {
    const { sku, qty = 40, products: clientProducts } = (req.body || {}) as {
      sku?: string;
      qty?: number;
      products?: ProductItem[];
    };
    if (!sku) return res.status(400).json({ error: 'sku is required' });
    if (Array.isArray(clientProducts) && clientProducts.length > 0) {
      monitoredInventory = clientProducts.map((p) => ({ ...p }));
    }
    const target = monitoredInventory.find((p) => p.sku === sku);
    if (!target) return res.status(404).json({ error: `Unknown SKU ${sku}` });
    const delta = Math.max(1, Math.floor(qty));
    target.stockQty += delta;
    const result = runBackendSupplyTrigger('restock_replenishment');
    res.json({ ok: true, ...result });
  });

  app.post('/api/supplies/threshold', (req, res) => {
    const { sku, reorderThreshold, products: clientProducts } = (req.body || {}) as {
      sku?: string;
      reorderThreshold?: number;
      products?: ProductItem[];
    };
    if (!sku || typeof reorderThreshold !== 'number') {
      return res.status(400).json({ error: 'sku and numeric reorderThreshold are required' });
    }
    if (Array.isArray(clientProducts) && clientProducts.length > 0) {
      monitoredInventory = clientProducts.map((p) => ({ ...p }));
    }
    const target = monitoredInventory.find((p) => p.sku === sku);
    if (!target) return res.status(404).json({ error: `Unknown SKU ${sku}` });
    target.reorderThreshold = Math.max(1, Math.floor(reorderThreshold));
    const result = runBackendSupplyTrigger('threshold_policy_update');
    res.json({ ok: true, ...result });
  });

  app.post('/api/alerts/supplies/:alertCode/acknowledge', (req, res) => {
    const { alertCode } = req.params;
    const { staffName = 'Staff Operator' } = (req.body || {}) as { staffName?: string };
    const found = monitoredAlerts.find((a) => a.alertCode === alertCode);
    if (!found) return res.status(404).json({ error: `Alert ${alertCode} not found` });
    if (found.status !== 'resolved') {
      found.status = 'acknowledged';
      found.acknowledgedBy = staffName;
      found.updatedAt = new Date().toISOString();
    }
    const result = runBackendSupplyTrigger('db_threshold_sweep');
    res.json({ ok: true, alert: found, ...result });
  });

  app.post('/api/alerts/supplies/:alertCode/resolve', (req, res) => {
    const { alertCode } = req.params;
    const found = monitoredAlerts.find((a) => a.alertCode === alertCode);
    if (!found) return res.status(404).json({ error: `Alert ${alertCode} not found` });
    found.status = 'resolved';
    found.updatedAt = new Date().toISOString();
    const result = runBackendSupplyTrigger('restock_replenishment');
    res.json({ ok: true, alert: found, ...result });
  });

  // Stateless CareGrid engines (available immediately across smart & keypad channels)
  app.post('/api/engine/sms', (req, res) => {
    const { message, context } = req.body as {
      message?: string;
      context?: KeypadPatientContext;
    };
    if (!message || !context) {
      return res.status(400).json({ error: 'message and context are required' });
    }
    const result = processSmsCommand(message, context);
    res.json(result);
  });

  app.post('/api/engine/ivr', (req, res) => {
    const { digit, context, complaintReason } = req.body as {
      digit?: string;
      context?: KeypadPatientContext;
      complaintReason?: string;
    };
    if (!digit || !context) {
      return res.status(400).json({ error: 'digit and context are required' });
    }
    const result = processIvrDtmf(digit, context, complaintReason);
    res.json(result);
  });

  app.post('/api/engine/verify', (req, res) => {
    const result = verifyOtpOrKeypadPin(req.body);
    res.json(result);
  });

  app.post('/api/engine/queue-slot', (req, res) => {
    try {
      const allocation = allocateSmartQueueSlot(req.body);
      res.json(allocation);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Queue verification failed' });
    }
  });

  // In-memory gateway audit trail for non-smartphone SMS triggers & confirmations
  const smsGatewayAudit: Array<{
    id: string;
    kind: 'trigger' | 'confirmation';
    command: string;
    profileId: string;
    toPhone: string;
    endpoint: string;
    summary: string;
    timestamp: string;
  }> = [];

  const pushSmsAudit = (entry: (typeof smsGatewayAudit)[number]) => {
    smsGatewayAudit.unshift(entry);
    if (smsGatewayAudit.length > 60) smsGatewayAudit.length = 60;
  };

  // Dedicated Backend API Trigger Routes mapped from incoming SMS commands
  app.post('/api/sms/triggers/:triggerType', (req, res) => {
    const { triggerType } = req.params;
    const {
      command,
      rawMessage,
      argsText = '',
      targetCode,
      senderPhone = '+91 90000 00000',
      context,
    } = req.body as {
      command?: string;
      rawMessage?: string;
      argsText?: string;
      targetCode?: string | null;
      senderPhone?: string;
      context?: KeypadPatientContext;
    };

    if (!context) {
      return res.status(400).json({ error: 'Patient context is required for SMS trigger execution.' });
    }

    const validTriggers = new Set([
      'status',
      'nurse',
      'report',
      'queue',
      'prescription',
      'explanation',
      'verify',
      'language',
      'help',
    ]);
    if (!validTriggers.has(triggerType)) {
      return res.status(404).json({ error: `Unknown SMS backend trigger: ${triggerType}` });
    }

    const effectiveCommandText =
      rawMessage?.trim() || [command || triggerType.toUpperCase(), argsText].filter(Boolean).join(' ');
    const domainResult = processSmsCommand(effectiveCommandText, context);
    const triggerId = `TRG-${triggerType.toUpperCase()}-${String(Date.now()).slice(-6)}`;
    const executedAt = new Date().toISOString();

    const sideEffects: string[] = [];
    if (triggerType === 'status') {
      sideEffects.push(
        `Queried order/dispatch status${targetCode ? ` for ${targetCode}` : ''} (${context.profileId})`
      );
    } else if (triggerType === 'nurse') {
      sideEffects.push(
        context.nurseDispatch
          ? `Synced Home Nurse telemetry (${context.nurseDispatch.nurseName}, ETA ${context.nurseDispatch.etaMinutes}m)`
          : 'Evaluated home nurse dispatch queue'
      );
    } else if (triggerType === 'report' && domainResult.complaint) {
      sideEffects.push(
        `Created escalation ${domainResult.complaint.complaintCode} -> ${domainResult.complaint.assignedSupervisor}`
      );
    } else if (triggerType === 'queue') {
      sideEffects.push(
        context.queueSummary
          ? `Confirmed Smart Queue room ${context.queueSummary.roomLocation} at ${context.queueSummary.slotTime}`
          : 'Checked Smart Queue allocation'
      );
    } else if (triggerType === 'verify') {
      sideEffects.push(
        domainResult.triggeredAction === 'verified_keypad'
          ? `Unlocked keypad access for ${context.profileId}`
          : `Recorded failed keypad PIN verification attempt for ${context.profileId}`
      );
    } else if (triggerType === 'language' && domainResult.nextLang) {
      sideEffects.push(`Updated patient handset language to ${domainResult.nextLang.toUpperCase()}`);
    } else {
      sideEffects.push(`Served ${triggerType} guidance payload for ${context.profileId}`);
    }

    pushSmsAudit({
      id: triggerId,
      kind: 'trigger',
      command: domainResult.command,
      profileId: context.profileId,
      toPhone: senderPhone,
      endpoint: `/api/sms/triggers/${triggerType}`,
      summary: sideEffects[0],
      timestamp: executedAt,
    });

    res.json({
      triggerId,
      triggerType,
      endpoint: `/api/sms/triggers/${triggerType}`,
      httpStatus: 200,
      executedAt,
      sideEffects,
      domainResult,
    });
  });

  // Automated Outbound SMS Confirmation Response Handler
  app.post('/api/sms/confirm', (req, res) => {
    const {
      toPhone,
      profileId,
      command,
      triggerId,
      body,
      segments = 1,
      periodicFollowUp = '',
    } = req.body as {
      toPhone?: string;
      profileId?: string;
      command?: string;
      triggerId?: string;
      body?: string;
      segments?: number;
      periodicFollowUp?: string;
    };

    if (!toPhone || !body || !command) {
      return res.status(400).json({ error: 'toPhone, command, and body are required to send confirmation SMS.' });
    }

    const confirmationId = `CNF-${String(Date.now()).slice(-7)}`;
    const dispatchedAt = new Date().toISOString();

    pushSmsAudit({
      id: confirmationId,
      kind: 'confirmation',
      command,
      profileId: profileId || 'UNKNOWN',
      toPhone,
      endpoint: '/api/sms/confirm',
      summary: body.slice(0, 140),
      timestamp: dispatchedAt,
    });

    res.json({
      confirmationId,
      toPhone,
      profileId: profileId || 'UNKNOWN',
      command,
      triggerId: triggerId || 'DIRECT',
      body,
      segments,
      periodicFollowUp,
      deliveryStatus: 'delivered_to_gateway',
      dispatchedAt,
    });
  });

  // Unified Incoming SMS Webhook (Parse -> Trigger -> Auto-Confirm)
  app.post('/api/sms/dispatch', (req, res) => {
    const { rawMessage, senderPhone = '+91 90000 00000', context } = req.body as {
      rawMessage?: string;
      senderPhone?: string;
      context?: KeypadPatientContext;
    };

    if (!rawMessage || !context) {
      return res.status(400).json({ error: 'rawMessage and context are required' });
    }

    const parsed = parseIncomingSms(rawMessage, senderPhone);
    const trigger = resolveBackendTrigger(parsed, context);
    const domainResult = processSmsCommand(parsed.normalizedMessage, context);
    const triggerId = `TRG-${trigger.triggerType.toUpperCase()}-${String(Date.now()).slice(-6)}`;
    const { body, segments } = formatSmsConfirmationBody(domainResult, parsed, context.language);
    const confirmationId = `CNF-${String(Date.now()).slice(-7)}`;
    const nowIso = new Date().toISOString();

    pushSmsAudit({
      id: confirmationId,
      kind: 'confirmation',
      command: parsed.verb,
      profileId: context.profileId,
      toPhone: parsed.senderPhone,
      endpoint: trigger.endpoint,
      summary: body.slice(0, 140),
      timestamp: nowIso,
    });

    res.json({
      parsed,
      trigger,
      backend: {
        triggerId,
        triggerType: trigger.triggerType,
        endpoint: trigger.endpoint,
        httpStatus: 200,
        executedAt: nowIso,
        sideEffects: [`Dispatched ${trigger.triggerType} trigger via unified SMS webhook`],
        domainResult,
      },
      confirmation: {
        confirmationId,
        toPhone: parsed.senderPhone,
        profileId: context.profileId,
        command: parsed.verb as SmsCommandVerb,
        triggerId,
        body,
        segments,
        periodicFollowUp: domainResult.periodicAlertPreview,
        deliveryStatus: 'delivered_to_gateway',
        dispatchedAt: nowIso,
      },
      complaint: domainResult.complaint,
    });
  });

  app.get('/api/sms/history', (_req, res) => {
    res.json({ ok: true, events: smsGatewayAudit });
  });

  // Server-side Gemini Multimodal Clinical Triage (free-tier gemini-4-hydrogen)
  app.post('/api/ai/triage', async (req, res) => {
    const { symptoms, language = 'en', imageDataUrl, channel = 'web' } = req.body as {
      symptoms?: string;
      language?: string;
      imageDataUrl?: string;
      channel?: string;
    };

    if (!symptoms && !imageDataUrl) {
      return res.status(400).json({ error: 'Provide symptoms text or a clinical photo.' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: 'AI service key is not configured on the server.' });
    }

    const targetLang = langDisplayName(language);
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (imageDataUrl) {
      const parsed = parseDataUrl(imageDataUrl);
      if (parsed) {
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }
    }

    parts.push({
      text: `You are CareGrid's clinical triage bridge between doctors and patients (${channel} channel).
Analyze the patient's symptoms and any visual context carefully.
Respond strictly in ${targetLang} (${language}).
Produce:
1. prescription: Safe structured medication guidance, supportive hydration/OTC regimen, dosage schedule, and clinician sign-off prompt suitable for button [1].
2. explanation: Clear plain-language medical explanation of what the symptoms or uploaded photo likely indicate, warning signs, and recovery steps suitable for button [2].
3. severity: One of "routine", "priority", or "urgent".
4. recommendedSpecialty: Nearest matching medical specialty or home nurse type.
5. smsSummary: Concise under-155-character SMS instruction in ${targetLang} for keypad phones.

Patient report: ${symptoms || 'Uploaded symptom photo only.'}`,
    });

    try {
      const runTriageModel = async (modelId: string) =>
        ai.models.generateContent({
          model: modelId,
          contents: [{ role: 'user', parts }],
          config: {
            ...(modelId === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
              : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              required: ['prescription', 'explanation', 'severity', 'recommendedSpecialty', 'smsSummary'],
              properties: {
                prescription: { type: Type.STRING },
                explanation: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['routine', 'priority', 'urgent'] },
                recommendedSpecialty: { type: Type.STRING },
                smsSummary: { type: Type.STRING },
              },
            },
          },
        });

      let modelUsed = 'gemini-4-hydrogen';
      let response;
      try {
        response = await runTriageModel('gemini-4-hydrogen');
      } catch {
        modelUsed = 'gemini-3.1-flash-lite';
        response = await runTriageModel('gemini-3.1-flash-lite');
      }

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        ...parsed,
        language,
        modelUsed,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      console.error('Gemini triage error:', msg);
      res.status(isQuota ? 429 : 502).json({
        error: isQuota
          ? 'Gemini API quota reached. Check Settings > Secrets for a billing-enabled key.'
          : 'Clinical analysis failed. Please retry.',
      });
    }
  });

  // Server-side Audio Transcription (gemini-3.5-transcribe)
  app.post('/api/ai/transcribe', async (req, res) => {
    const { audioDataUrl, language = 'en' } = req.body as {
      audioDataUrl?: string;
      language?: string;
    };
    if (!audioDataUrl) {
      return res.status(400).json({ error: 'audioDataUrl is required' });
    }

    const parsed = parseDataUrl(audioDataUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid base64 audio data URL' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: 'AI service key is not configured on the server.' });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: parsed.mimeType, data: parsed.data } },
              {
                text: `Transcribe the spoken medical symptoms or care question verbatim in ${langDisplayName(language)}. Output plain transcript text only.`,
              },
            ],
          },
        ],
      });
      res.json({ transcript: (response.text || '').trim() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Gemini transcribe error:', msg);
      res.status(502).json({ error: 'Audio transcription failed.' });
    }
  });

  // Server-side Text-to-Speech (gemini-3.8-flash-lite-tts with clean browser fallback signal)
  app.post('/api/ai/tts', async (req, res) => {
    const { text, language = 'en' } = req.body as { text?: string; language?: string };
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.json({ fallback: true, notice: 'Device speech synthesizer active.' });
    }

    try {
      const voiceName = language === 'hi' || language === 'ta' ? 'Zephyr' : language === 'es' ? 'Puck' : 'Kore';
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{ role: 'user', parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
      const audioPart = candidateParts.find((p) => p.inlineData?.data);
      if (!audioPart?.inlineData?.data) {
        return res.json({ fallback: true, notice: 'Using device speech synthesizer.' });
      }

      const rawMime = (audioPart.inlineData.mimeType || 'audio/wav').toLowerCase();
      let audioBase64 = audioPart.inlineData.data;
      let mimeType = audioPart.inlineData.mimeType || 'audio/wav';

      if (!rawMime.includes('wav') && (rawMime.includes('pcm') || rawMime.includes('l16'))) {
        const rateMatch = rawMime.match(/rate=(\d+)/);
        const rate = rateMatch ? Number(rateMatch[1]) : 24000;
        audioBase64 = pcmBase64ToWavBase64(audioBase64, rate);
        mimeType = 'audio/wav';
      }

      res.json({ audioBase64, mimeType, fallback: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('Gemini TTS fallback to browser speech:', msg);
      res.json({ fallback: true, notice: 'Using device speech synthesizer.' });
    }
  });

  // Server-side Google Maps Grounding with Gemini (NO PII, NO responseSchema)
  app.post('/api/ai/maps-grounding', async (req, res) => {
    const { query, latitude = 12.9716, longitude = 77.5946 } = req.body as {
      query?: string;
      latitude?: number;
      longitude?: number;
    };
    const safeQuery =
      query?.trim() || '24 hour medical clinics, diagnostic laboratories, and emergency pharmacies nearby';

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: 'AI service key is not configured on the server.' });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts: [{ text: safeQuery }] }],
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: { latitude, longitude },
            },
          },
        },
      });

      const metadata = response.candidates?.[0]?.groundingMetadata;
      const chunks = (metadata?.groundingChunks ?? [])
        .map((chunk) => {
          if (!chunk.maps) return null;
          return {
            title: chunk.maps.title ?? 'Medical Facility',
            uri: chunk.maps.uri ?? 'https://maps.google.com',
            placeId: chunk.maps.placeId ?? '',
          };
        })
        .filter(Boolean);

      res.json({
        text: response.text || '',
        places: chunks,
        widgetToken: metadata?.googleMapsWidgetContextToken ?? null,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      console.error('Gemini Maps Grounding error:', msg);
      res.status(isQuota ? 429 : 502).json({
        error: isQuota
          ? 'Gemini Maps Grounding quota reached (429). Check Settings > Secrets or use Google Places results below.'
          : 'Maps grounding lookup failed.',
      });
    }
  });

  // Protected Cloud SQL Persistence Routes (with graceful 503 if SQL proxy is unauthorized across projects)
  app.get('/api/db/bootstrap', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    const email = req.user?.email || 'patient@caregrid.local';
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    try {
      await ensureUserRecord(uid, email, req.user?.name);
      const data = await getUserDashboardData(uid);
      res.json({ ok: true, data });
    } catch {
      res.status(503).json({ ok: false, error: 'Cloud SQL persistence currently unavailable.' });
    }
  });

  app.post('/api/db/profile', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      await ensureUserRecord(uid, req.user?.email || 'patient@caregrid.local', req.user?.name);
      const row = await upsertPatientProfile({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/reviews', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await createProductReviewSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/supplier-messages', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertSupplierMessageSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/nurse-bookings', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertNurseBookingSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/queue-tickets', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertQueueTicketSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/orders', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertOrderSql({ ...req.body, ownerUid: uid });
      const sku = typeof req.body?.sku === 'string' ? req.body.sku : undefined;
      const qty = typeof req.body?.qty === 'number' ? req.body.qty : undefined;
      if (sku && qty) {
        await mutateSupplyStockSql(uid, sku, -Math.abs(qty), 'db_order_decrement');
      } else {
        await runSupplyThresholdTriggerSql(uid, 'db_order_decrement');
      }
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/supplies/trigger', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { sku, deltaQty, reorderThreshold, triggeredBy = 'db_threshold_sweep' } = (req.body || {}) as {
      sku?: string;
      deltaQty?: number;
      reorderThreshold?: number;
      triggeredBy?: SupplyTriggerSource;
    };
    try {
      await ensureUserRecord(uid, req.user?.email || 'patient@caregrid.local', req.user?.name);
      let sqlResult;
      if (sku && typeof deltaQty === 'number' && deltaQty !== 0) {
        sqlResult = await mutateSupplyStockSql(uid, sku, deltaQty, triggeredBy);
      } else if (sku && typeof reorderThreshold === 'number') {
        sqlResult = await updateSupplyThresholdSql(uid, sku, reorderThreshold);
      } else {
        sqlResult = await runSupplyThresholdTriggerSql(uid, triggeredBy);
      }
      if (!sqlResult) {
        return res.status(404).json({ ok: false, error: 'Product SKU not found in SQL database' });
      }
      res.json({ ok: true, source: 'sql', ...sqlResult });
    } catch {
      res.status(503).json({ ok: false, error: 'Cloud SQL persistence currently unavailable.' });
    }
  });

  app.post('/api/db/supplies/alerts/:alertCode/status', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const alertCode = String(req.params.alertCode || '');
    const { status } = (req.body || {}) as { status?: 'active' | 'acknowledged' | 'resolved' };
    if (!status) return res.status(400).json({ ok: false, error: 'status is required' });
    try {
      const updated = await updateSupplyAlertStatusSql(uid, alertCode, status);
      if (!updated) return res.status(404).json({ ok: false, error: 'Supply alert not found in SQL' });
      res.json({ ok: true, source: 'sql', alert: updated });
    } catch {
      res.status(503).json({ ok: false, error: 'Cloud SQL persistence currently unavailable.' });
    }
  });

  app.get('/api/db/dispatch-telemetry', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      await ensureUserRecord(uid, req.user?.email || 'patient@caregrid.local', req.user?.name);
      const telemetry = await getLiveDispatchTelemetrySql(uid);
      res.json({
        ok: true,
        source: 'sql',
        syncedAt: new Date().toISOString(),
        ...telemetry,
      });
    } catch {
      res.status(503).json({ ok: false, error: 'Cloud SQL persistence currently unavailable.' });
    }
  });

  app.post('/api/db/dispatch-telemetry/tick', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { targetLat, targetLng } = (req.body || {}) as { targetLat?: number; targetLng?: number };
    try {
      await ensureUserRecord(uid, req.user?.email || 'patient@caregrid.local', req.user?.name);
      const telemetry = await advanceDispatchTelemetrySql(uid, targetLat, targetLng);
      res.json({
        ok: true,
        source: 'sql',
        syncedAt: new Date().toISOString(),
        ...telemetry,
      });
    } catch {
      res.status(503).json({ ok: false, error: 'Cloud SQL persistence currently unavailable.' });
    }
  });

  app.post('/api/db/triage', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertTriageSessionSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/sms', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertSmsLogSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/ivr', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await insertIvrEventSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.post('/api/db/complaints', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await upsertComplaintSql({ ...req.body, ownerUid: uid });
      res.json({ ok: true, row });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  // Frontend Vite / Static Integration
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws/live' || url.pathname === '/ws/translate') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, url);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs: WebSocket, _req: http.IncomingMessage, url: URL) => {
    const ai = getGeminiClient();
    if (!ai) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Gemini API key unavailable on server.' }));
      clientWs.close();
      return;
    }

    const isTranslate = url.pathname === '/ws/translate';
    const lang = url.searchParams.get('lang') || 'en';
    const targetLanguageCode =
      lang === 'hi' ? 'hi-IN' : lang === 'es' ? 'es-ES' : lang === 'ta' ? 'ta-IN' : 'en-US';

    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      session = await ai.live.connect({
        model: isTranslate ? 'gemini-3.5-live-translate-preview' : 'gemini-3.8-live',
        config: isTranslate
          ? {
              responseModalities: [Modality.AUDIO],
              translationConfig: {
                targetLanguageCode,
              },
            }
          : {
              responseModalities: [Modality.AUDIO],
              systemInstruction: `You are CareGrid's multilingual doctor-patient voice assistant. Respond concisely and empathetically in ${langDisplayName(lang)}.`,
            },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'connected', mode: isTranslate ? 'translate' : 'live' }));
            }
          },
          onmessage: (msg) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const serverContent = msg.serverContent;
            if (serverContent?.modelTurn?.parts) {
              for (const part of serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  clientWs.send(
                    JSON.stringify({
                      type: 'audio',
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    })
                  );
                }
                if (part.text) {
                  clientWs.send(JSON.stringify({ type: 'text', text: part.text }));
                }
              }
            }
            if (serverContent?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: 'input_transcript', text: serverContent.inputTranscription.text }));
            }
            if (serverContent?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: 'output_transcript', text: serverContent.outputTranscription.text }));
            }
            if (serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: 'turn_complete' }));
            }
          },
          onerror: (err) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'error', message: String(err) }));
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'closed' }));
            }
          },
        },
      });
    } catch (error) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unable to establish live voice session',
          })
        );
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (raw) => {
      if (!session) return;
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; data?: string; text?: string; mimeType?: string };
        if (msg.type === 'audio' && msg.data) {
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: msg.mimeType || 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && msg.text) {
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    clientWs.on('close', () => {
      session?.close();
      session = null;
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CareGrid Health & Supply OS server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
