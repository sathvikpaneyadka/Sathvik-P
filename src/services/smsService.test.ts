import test from 'node:test';
import assert from 'node:assert/strict';
import type { KeypadPatientContext } from '../core/smsIvrEngine.ts';
import {
  SmsGatewayService,
  parseIncomingSms,
  resolveBackendTrigger,
  type FetchLike,
} from './smsService.ts';

const testContext: KeypadPatientContext = {
  profileId: 'HC-ANA48210',
  fullName: 'Ananya Rao',
  language: 'en',
  keypadPin: '4821',
  securityAnswer: 'lotus',
  activePrescription: 'Paracetamol 500mg every 6h',
  activeExplanation: 'Hydrate well and monitor temperature twice daily.',
  queueSummary: {
    clinicName: 'CareGrid Metro Hub',
    roomLocation: 'Wing B · Room 204',
    slotTime: '14:30',
    waitMinutes: 12,
  },
  nurseDispatch: {
    nurseName: 'RN Priya Menon',
    etaMinutes: 14,
    status: 'en_route',
  },
  activeOrderStatus: '2x Infusion Kit (in_transit, ETA 19 min)',
};

test('parseIncomingSms parses STATUS, NURSE, REPORT, and profile prefixes accurately', () => {
  const statusParsed = parseIncomingSms('  status ORD-9024 ', '+91 98450 22190');
  assert.equal(statusParsed.verb, 'STATUS');
  assert.equal(statusParsed.targetCode, 'ORD-9024');
  assert.equal(statusParsed.senderPhone, '+91 98450 22190');

  const nurseParsed = parseIncomingSms('HC-ANA48210 nurse check ETA');
  assert.equal(nurseParsed.explicitProfileId, 'HC-ANA48210');
  assert.equal(nurseParsed.verb, 'NURSE');
  assert.equal(nurseParsed.argsText, 'check ETA');

  const reportParsed = parseIncomingSms('REPORT Cold-chain insulin box delayed at East gate');
  assert.equal(reportParsed.verb, 'REPORT');
  assert.match(reportParsed.argsText, /insulin box delayed/i);

  const helpFallback = parseIncomingSms('hello can you call me');
  assert.equal(helpFallback.verb, 'HELP');
});

test('resolveBackendTrigger maps parsed SMS verbs to exact API trigger endpoints', () => {
  const statusTrigger = resolveBackendTrigger(parseIncomingSms('STATUS ORD-9024'), testContext);
  assert.equal(statusTrigger.endpoint, '/api/sms/triggers/status');
  assert.equal(statusTrigger.triggerType, 'status');

  const nurseTrigger = resolveBackendTrigger(parseIncomingSms('NURSE'), testContext);
  assert.equal(nurseTrigger.endpoint, '/api/sms/triggers/nurse');
  assert.equal(nurseTrigger.triggerType, 'nurse');

  const reportTrigger = resolveBackendTrigger(parseIncomingSms('REPORT Nurse delayed'), testContext);
  assert.equal(reportTrigger.endpoint, '/api/sms/triggers/report');
  assert.equal(reportTrigger.triggerType, 'report');
});

test('SmsGatewayService executes backend triggers and sends automated SMS confirmations', async () => {
  const calls: Array<{ url: string; method?: string; auth?: string; body: Record<string, unknown> }> = [];

  const mockFetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init?.body || '{}') as Record<string, unknown>;
    calls.push({ url, method: init?.method, auth: init?.headers?.Authorization, body });

    if (url.startsWith('/api/sms/triggers/')) {
      const triggerType = url.split('/').pop() || 'help';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          triggerId: `TRG-${triggerType.toUpperCase()}-101`,
          triggerType,
          endpoint: url,
          httpStatus: 200,
          executedAt: '2026-11-14T12:25:00.000Z',
          sideEffects: [`Executed ${triggerType} handler`],
        }),
      };
    }

    if (url === '/api/sms/confirm') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          confirmationId: 'CNF-99881',
          toPhone: body.toPhone,
          profileId: body.profileId,
          command: body.command,
          triggerId: body.triggerId,
          body: body.body,
          segments: body.segments,
          deliveryStatus: 'delivered_to_gateway',
          dispatchedAt: '2026-11-14T12:25:01.000Z',
        }),
      };
    }

    return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
  };

  const service = new SmsGatewayService(mockFetch);

  const reportFlow = await service.handleIncomingSms(
    {
      rawMessage: 'REPORT Oxygen cylinder delayed at East Clinic gate',
      senderPhone: '+91 98450 22190',
      context: testContext,
    },
    { authToken: 'token-abc' }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/sms/triggers/report');
  assert.equal(calls[0].auth, 'Bearer token-abc');
  assert.equal(calls[1].url, '/api/sms/confirm');
  assert.equal(reportFlow.confirmation.confirmationId, 'CNF-99881');
  assert.equal(reportFlow.confirmation.deliveryStatus, 'delivered_to_gateway');
  assert.equal(reportFlow.complaint?.category, 'delivery_delay');
  assert.equal(reportFlow.complaint?.assignedSupervisor, 'R. Kapoor · Logistics Lead');
  assert.match(reportFlow.confirmation.body, /Escalated/i);

  const nurseFlow = await service.handleIncomingSms({
    rawMessage: 'NURSE',
    senderPhone: '+91 98450 22190',
    context: testContext,
  });

  assert.equal(nurseFlow.trigger.endpoint, '/api/sms/triggers/nurse');
  assert.match(nurseFlow.confirmation.body, /RN Priya Menon/);
});
