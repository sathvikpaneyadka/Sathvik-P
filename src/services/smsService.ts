import { getLocaleStrings } from '../core/i18n.ts';
import {
  processSmsCommand,
  type EscalatedComplaint,
  type KeypadPatientContext,
  type SmsCommandResult,
} from '../core/smsIvrEngine.ts';

export type SmsCommandVerb =
  | 'STATUS'
  | 'NURSE'
  | 'REPORT'
  | 'COMPLAINT'
  | 'QUEUE'
  | 'RX'
  | 'EXPLAIN'
  | 'VERIFY'
  | 'LANG'
  | 'HELP';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface ParsedSmsCommand {
  rawMessage: string;
  normalizedMessage: string;
  senderPhone: string;
  explicitProfileId: string | null;
  verb: SmsCommandVerb;
  rawToken: string;
  argsText: string;
  tokens: string[];
  targetCode: string | null;
}

export interface SmsBackendTrigger {
  triggerType:
    | 'status'
    | 'nurse'
    | 'report'
    | 'queue'
    | 'prescription'
    | 'explanation'
    | 'verify'
    | 'language'
    | 'help';
  endpoint: string;
  method: 'POST';
  payload: Record<string, unknown>;
}

export interface BackendTriggerResponse {
  triggerId: string;
  triggerType: SmsBackendTrigger['triggerType'];
  endpoint: string;
  httpStatus: number;
  executedAt: string;
  sideEffects: string[];
  domainResult: SmsCommandResult;
}

export interface SmsConfirmationReceipt {
  confirmationId: string;
  toPhone: string;
  profileId: string;
  command: SmsCommandVerb;
  triggerId: string;
  body: string;
  segments: number;
  periodicFollowUp: string;
  deliveryStatus: 'delivered_to_gateway' | 'queued_offline_retry';
  dispatchedAt: string;
}

export interface SmsPipelineResult {
  parsed: ParsedSmsCommand;
  trigger: SmsBackendTrigger;
  backend: BackendTriggerResponse;
  confirmation: SmsConfirmationReceipt;
  complaint?: EscalatedComplaint;
}

export interface IncomingSmsRequest {
  rawMessage: string;
  senderPhone: string;
  context: KeypadPatientContext;
}

const VERB_MAP: Record<string, SmsCommandVerb> = {
  STATUS: 'STATUS',
  ORDER: 'STATUS',
  TRACK: 'STATUS',
  '4': 'NURSE',
  NURSE: 'NURSE',
  DISPATCH: 'NURSE',
  REPORT: 'REPORT',
  COMPLAINT: 'COMPLAINT',
  ISSUE: 'COMPLAINT',
  '9': 'REPORT',
  QUEUE: 'QUEUE',
  SLOT: 'QUEUE',
  '3': 'QUEUE',
  RX: 'RX',
  PRESCRIPTION: 'RX',
  '1': 'RX',
  EXPLAIN: 'EXPLAIN',
  GUIDE: 'EXPLAIN',
  '2': 'EXPLAIN',
  VERIFY: 'VERIFY',
  PIN: 'VERIFY',
  LANG: 'LANG',
  LANGUAGE: 'LANG',
  HELP: 'HELP',
  MENU: 'HELP',
};

const TRIGGER_ENDPOINTS: Record<SmsCommandVerb, SmsBackendTrigger['triggerType']> = {
  STATUS: 'status',
  NURSE: 'nurse',
  REPORT: 'report',
  COMPLAINT: 'report',
  QUEUE: 'queue',
  RX: 'prescription',
  EXPLAIN: 'explanation',
  VERIFY: 'verify',
  LANG: 'language',
  HELP: 'help',
};

/**
 * Parses an incoming SMS string into a canonical CareGrid command verb,
 * optional patient profile prefix (e.g. `HC-ANA48210 STATUS`), and trailing arguments.
 */
export function parseIncomingSms(rawMessage: string, senderPhone = '+91 90000 00000'): ParsedSmsCommand {
  const normalizedMessage = rawMessage.trim().replace(/\s+/g, ' ');
  const parts = normalizedMessage ? normalizedMessage.split(' ') : [];

  let explicitProfileId: string | null = null;
  let workingParts = parts;

  if (parts.length > 0 && /^HC-[A-Z0-9]{4,16}$/i.test(parts[0])) {
    explicitProfileId = parts[0].toUpperCase();
    workingParts = parts.slice(1);
  }

  const rawToken = (workingParts[0] || 'HELP').toUpperCase();
  const verb: SmsCommandVerb = VERB_MAP[rawToken] ?? 'HELP';
  const argsTokens = workingParts.slice(1);
  const argsText = verb === 'HELP' && !(rawToken in VERB_MAP) ? normalizedMessage : argsTokens.join(' ');
  const codeMatch = argsText.match(/\b((?:ORD|NR|SQ|ESC)-[A-Z0-9]+|\d{4,6})\b/i);

  return {
    rawMessage,
    normalizedMessage,
    senderPhone: senderPhone.trim() || '+91 90000 00000',
    explicitProfileId,
    verb,
    rawToken,
    argsText,
    tokens: workingParts,
    targetCode: codeMatch ? codeMatch[1].toUpperCase() : null,
  };
}

/**
 * Maps a parsed SMS command to its concrete backend API trigger descriptor.
 */
export function resolveBackendTrigger(
  parsed: ParsedSmsCommand,
  context: KeypadPatientContext
): SmsBackendTrigger {
  const triggerType = TRIGGER_ENDPOINTS[parsed.verb];
  const endpoint = `/api/sms/triggers/${triggerType}`;

  const effectiveContext: KeypadPatientContext =
    parsed.explicitProfileId && parsed.explicitProfileId === context.profileId
      ? context
      : context;

  return {
    triggerType,
    endpoint,
    method: 'POST',
    payload: {
      command: parsed.verb,
      rawToken: parsed.rawToken,
      argsText: parsed.argsText,
      targetCode: parsed.targetCode,
      senderPhone: parsed.senderPhone,
      profileId: parsed.explicitProfileId ?? effectiveContext.profileId,
      context: effectiveContext,
      rawMessage: parsed.normalizedMessage,
    },
  };
}

/**
 * Executes the mapped backend API trigger over HTTP.
 */
export async function executeSmsBackendTrigger(
  trigger: SmsBackendTrigger,
  options?: { fetchFn?: FetchLike; authToken?: string | null }
): Promise<BackendTriggerResponse> {
  const fetchFn: FetchLike =
    options?.fetchFn ??
    ((url, init) => globalThis.fetch(url, init) as Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options?.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }

  const res = await fetchFn(trigger.endpoint, {
    method: trigger.method,
    headers,
    body: JSON.stringify(trigger.payload),
  });

  const data = (await res.json()) as Partial<BackendTriggerResponse> & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `SMS trigger failed (${res.status}) on ${trigger.endpoint}`);
  }

  return {
    triggerId: data.triggerId || `TRG-${Date.now()}`,
    triggerType: data.triggerType || trigger.triggerType,
    endpoint: data.endpoint || trigger.endpoint,
    httpStatus: res.status,
    executedAt: data.executedAt || new Date().toISOString(),
    sideEffects: Array.isArray(data.sideEffects) ? data.sideEffects : [],
    domainResult:
      data.domainResult ??
      processSmsCommand(
        String(trigger.payload.rawMessage || trigger.payload.command || 'HELP'),
        trigger.payload.context as KeypadPatientContext
      ),
  };
}

/**
 * Builds a concise, carrier-segmented confirmation message respecting patient language.
 */
export function formatSmsConfirmationBody(
  domainResult: SmsCommandResult,
  parsed: ParsedSmsCommand,
  langCode: KeypadPatientContext['language']
): { body: string; segments: number } {
  const locale = getLocaleStrings(domainResult.nextLang ?? langCode);
  const tag =
    parsed.verb === 'REPORT' || parsed.verb === 'COMPLAINT'
      ? locale.complaintEscalatedPrefix
      : parsed.verb === 'NURSE'
        ? locale.nurseStatusPrefix
        : 'CareGrid SMS Confirm';

  const core = domainResult.replyText.trim();
  const alreadyTagged =
    core.startsWith('[') ||
    core.startsWith(tag) ||
    core.toLowerCase().includes('confirmed');
  const body = alreadyTagged ? `ACK [${parsed.verb}] ${core}` : `${tag}: ${core}`;

  const segments = Math.max(1, Math.ceil(body.length / 160));
  return { body, segments };
}

/**
 * Sends an automated SMS confirmation receipt via `/api/sms/confirm`.
 */
export async function sendAutomatedSmsConfirmation(
  input: {
    toPhone: string;
    profileId: string;
    command: SmsCommandVerb;
    language: KeypadPatientContext['language'];
    domainResult: SmsCommandResult;
    parsed: ParsedSmsCommand;
    triggerId: string;
  },
  options?: { fetchFn?: FetchLike; authToken?: string | null }
): Promise<SmsConfirmationReceipt> {
  const fetchFn: FetchLike =
    options?.fetchFn ??
    ((url, init) => globalThis.fetch(url, init) as Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>);

  const { body, segments } = formatSmsConfirmationBody(input.domainResult, input.parsed, input.language);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options?.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }

  try {
    const res = await fetchFn('/api/sms/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        toPhone: input.toPhone,
        profileId: input.profileId,
        command: input.command,
        triggerId: input.triggerId,
        language: input.domainResult.nextLang ?? input.language,
        body,
        segments,
        periodicFollowUp: input.domainResult.periodicAlertPreview,
      }),
    });

    const data = (await res.json()) as Partial<SmsConfirmationReceipt>;
    if (!res.ok) {
      throw new Error(`SMS confirmation endpoint returned ${res.status}`);
    }

    return {
      confirmationId: data.confirmationId || `CNF-${Date.now()}`,
      toPhone: data.toPhone || input.toPhone,
      profileId: data.profileId || input.profileId,
      command: input.command,
      triggerId: input.triggerId,
      body: data.body || body,
      segments: data.segments ?? segments,
      periodicFollowUp: input.domainResult.periodicAlertPreview,
      deliveryStatus: data.deliveryStatus || 'delivered_to_gateway',
      dispatchedAt: data.dispatchedAt || new Date().toISOString(),
    };
  } catch {
    return {
      confirmationId: `CNF-LOCAL-${Date.now()}`,
      toPhone: input.toPhone,
      profileId: input.profileId,
      command: input.command,
      triggerId: input.triggerId,
      body,
      segments,
      periodicFollowUp: input.domainResult.periodicAlertPreview,
      deliveryStatus: 'queued_offline_retry',
      dispatchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Full incoming SMS gateway orchestrator:
 * 1. Parses inbound SMS command string
 * 2. Maps & invokes the corresponding backend API trigger
 * 3. Dispatches automated outbound SMS confirmation receipt
 */
export class SmsGatewayService {
  private defaultFetch?: FetchLike;

  constructor(defaultFetch?: FetchLike) {
    this.defaultFetch = defaultFetch;
  }

  async handleIncomingSms(
    request: IncomingSmsRequest,
    options?: { fetchFn?: FetchLike; authToken?: string | null }
  ): Promise<SmsPipelineResult> {
    const fetchFn = options?.fetchFn ?? this.defaultFetch;
    const parsed = parseIncomingSms(request.rawMessage, request.senderPhone);
    const trigger = resolveBackendTrigger(parsed, request.context);
    const backend = await executeSmsBackendTrigger(trigger, {
      fetchFn,
      authToken: options?.authToken,
    });
    const confirmation = await sendAutomatedSmsConfirmation(
      {
        toPhone: parsed.senderPhone,
        profileId: parsed.explicitProfileId ?? request.context.profileId,
        command: parsed.verb,
        language: request.context.language,
        domainResult: backend.domainResult,
        parsed,
        triggerId: backend.triggerId,
      },
      { fetchFn, authToken: options?.authToken }
    );

    return {
      parsed,
      trigger,
      backend,
      confirmation,
      complaint: backend.domainResult.complaint,
    };
  }
}

export const smsGatewayService = new SmsGatewayService();
