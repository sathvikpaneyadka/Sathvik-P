import { getLocaleStrings, type SupportedLang } from './i18n.ts';

export interface KeypadPatientContext {
  profileId: string;
  fullName: string;
  language: SupportedLang;
  keypadPin: string;
  securityAnswer: string;
  activePrescription: string;
  activeExplanation: string;
  queueSummary: {
    clinicName: string;
    roomLocation: string;
    slotTime: string;
    waitMinutes: number;
  } | null;
  nurseDispatch: {
    nurseName: string;
    etaMinutes: number;
    status: string;
  } | null;
  activeOrderStatus: string;
}

export interface EscalatedComplaint {
  complaintCode: string;
  channel: 'sms' | 'ivr' | 'web';
  category: 'delivery_delay' | 'clinical_care' | 'billing_inventory' | 'general';
  assignedSupervisor: string;
  description: string;
  status: 'escalated';
}

export interface SmsCommandResult {
  command: string;
  replyText: string;
  triggeredAction:
    | 'prescription'
    | 'explanation'
    | 'queue_status'
    | 'nurse_status'
    | 'order_status'
    | 'verified_keypad'
    | 'verify_failed'
    | 'complaint_escalated'
    | 'language_changed'
    | 'help';
  nextLang?: SupportedLang;
  complaint?: EscalatedComplaint;
  periodicAlertPreview: string;
}

export interface IvrDtmfResult {
  digit: string;
  menuAction: string;
  audioResponseText: string;
  smsConfirmationText: string;
  complaint?: EscalatedComplaint;
  nextLang?: SupportedLang;
}

export function classifyComplaintSupervisor(text: string): {
  category: EscalatedComplaint['category'];
  assignedSupervisor: string;
} {
  const lower = text.toLowerCase();
  if (lower.includes('nurse') || lower.includes('doctor') || lower.includes('pain') || lower.includes('wrong')) {
    return { category: 'clinical_care', assignedSupervisor: 'Dr. M. Alvarez · Chief Nursing Officer' };
  }
  if (lower.includes('delay') || lower.includes('late') || lower.includes('order') || lower.includes('delivery')) {
    return { category: 'delivery_delay', assignedSupervisor: 'R. Kapoor · Logistics Lead' };
  }
  if (lower.includes('bill') || lower.includes('stock') || lower.includes('invoice') || lower.includes('refund')) {
    return { category: 'billing_inventory', assignedSupervisor: 'S. Nair · Supply Chain Director' };
  }
  return { category: 'general', assignedSupervisor: 'A. Vance · Duty Operations Supervisor' };
}

export function createEscalatedComplaint(
  description: string,
  channel: 'sms' | 'ivr' | 'web',
  nowMs = Date.now()
): EscalatedComplaint {
  const clean = description.trim() || 'Urgent assistance requested via keypad channel';
  const { category, assignedSupervisor } = classifyComplaintSupervisor(clean);
  const code = `ESC-${String(nowMs).slice(-5)}`;
  return {
    complaintCode: code,
    channel,
    category,
    assignedSupervisor,
    description: clean,
    status: 'escalated',
  };
}

export function processSmsCommand(
  rawInput: string,
  ctx: KeypadPatientContext,
  nowMs = Date.now()
): SmsCommandResult {
  const trimmed = rawInput.trim();
  const strings = getLocaleStrings(ctx.language);
  const tokens = trimmed.split(/\s+/);
  const head = (tokens[0] || '').toUpperCase();
  const rest = tokens.slice(1).join(' ');

  if (head === '1' || head === 'RX' || head === 'PRESCRIPTION') {
    return {
      command: 'RX',
      triggeredAction: 'prescription',
      replyText: `[${ctx.profileId}] ${ctx.activePrescription}`,
      periodicAlertPreview: `Reminder scheduled: ${ctx.profileId} dose check-in in 4h via SMS.`,
    };
  }

  if (head === '2' || head === 'EXPLAIN' || head === 'GUIDE') {
    return {
      command: 'EXPLAIN',
      triggeredAction: 'explanation',
      replyText: `[${ctx.profileId}] ${ctx.activeExplanation}`,
      periodicAlertPreview: `Follow-up SMS scheduled if symptoms persist after 6h.`,
    };
  }

  if (head === 'QUEUE' || head === 'SLOT' || head === '3') {
    const q = ctx.queueSummary;
    const replyText = q
      ? `${strings.queueConfirmedPrefix} [${ctx.profileId}]: ${q.clinicName}, ${q.roomLocation} at ${q.slotTime}. Est. wait: ${q.waitMinutes} min.`
      : `[${ctx.profileId}] No active clinic queue ticket. Reply BOOK to request a slot.`;
    return {
      command: 'QUEUE',
      triggeredAction: 'queue_status',
      replyText,
      periodicAlertPreview: q
        ? `Periodic Alert: SMS push queued 15 min before ${q.slotTime} at ${q.roomLocation}.`
        : 'No periodic queue alerts pending.',
    };
  }

  if (head === 'NURSE' || head === 'STATUS' || head === '4') {
    const n = ctx.nurseDispatch;
    const replyText = n
      ? `${strings.nurseStatusPrefix}: ${n.nurseName} (${n.status}) ETA ${n.etaMinutes} min. Order: ${ctx.activeOrderStatus}.`
      : `Order update [${ctx.profileId}]: ${ctx.activeOrderStatus}.`;
    return {
      command: head === 'NURSE' ? 'NURSE' : 'STATUS',
      triggeredAction: head === 'NURSE' ? 'nurse_status' : 'order_status',
      replyText,
      periodicAlertPreview: n
        ? `Auto-SMS dispatch pings every 10 min until ${n.nurseName} arrives.`
        : 'Delivery milestone SMS enabled.',
    };
  }

  if (head === 'VERIFY') {
    const pinOrAnswer = rest.trim();
    if (pinOrAnswer === ctx.keypadPin || pinOrAnswer.toLowerCase() === ctx.securityAnswer.toLowerCase()) {
      return {
        command: 'VERIFY',
        triggeredAction: 'verified_keypad',
        replyText: `Verified [${ctx.profileId}]. Your medical profile and SMS commands are unlocked.`,
        periodicAlertPreview: 'Account security alert sent via SMS.',
      };
    }
    return {
      command: 'VERIFY',
      triggeredAction: 'verify_failed',
      replyText: `Verification failed for [${ctx.profileId}]. Reply VERIFY <4-digit PIN> or <Security word>.`,
      periodicAlertPreview: 'No alerts triggered.',
    };
  }

  if (head === 'REPORT' || head === 'COMPLAINT' || head === 'ISSUE' || head === '9') {
    const commandName = head === 'REPORT' ? 'REPORT' : 'COMPLAINT';
    const complaint = createEscalatedComplaint(
      rest || `Service ${commandName.toLowerCase()} reported via SMS`,
      'sms',
      nowMs
    );
    return {
      command: commandName,
      triggeredAction: 'complaint_escalated',
      complaint,
      replyText: `${strings.complaintEscalatedPrefix} (${complaint.complaintCode}): Assigned to ${complaint.assignedSupervisor}. Periodic SMS updates active until resolved.`,
      periodicAlertPreview: `Escalation SLA alert: supervisor update due within 15 min for ${complaint.complaintCode}.`,
    };
  }

  if (head === 'LANG') {
    const code = rest.toLowerCase();
    if (code === 'en' || code === 'hi' || code === 'es' || code === 'ta') {
      const nextStrings = getLocaleStrings(code);
      return {
        command: 'LANG',
        triggeredAction: 'language_changed',
        nextLang: code,
        replyText: `Language updated to ${nextStrings.langName} for [${ctx.profileId}]. ${nextStrings.smsHelpReply}`,
        periodicAlertPreview: `Future SMS alerts will arrive in ${nextStrings.langName}.`,
      };
    }
  }

  return {
    command: 'HELP',
    triggeredAction: 'help',
    replyText: strings.smsHelpReply,
    periodicAlertPreview: 'Periodic SMS updates remain active for open tickets.',
  };
}

export function processIvrDtmf(
  digit: string,
  ctx: KeypadPatientContext,
  complaintReason = 'Automated keypad option 9 escalation',
  nowMs = Date.now()
): IvrDtmfResult {
  const strings = getLocaleStrings(ctx.language);

  switch (digit) {
    case '1':
      return {
        digit,
        menuAction: 'PRESCRIPTION_READOUT',
        audioResponseText: `Profile ${ctx.profileId}. Your active prescription: ${ctx.activePrescription}`,
        smsConfirmationText: `IVR Confirmation [1]: ${ctx.activePrescription}`,
      };
    case '2':
      return {
        digit,
        menuAction: 'CONDITION_EXPLANATION',
        audioResponseText: `Medical explanation for ${ctx.fullName}: ${ctx.activeExplanation}`,
        smsConfirmationText: `IVR Confirmation [2]: Care instructions sent to your handset.`,
      };
    case '3': {
      const q = ctx.queueSummary;
      const msg = q
        ? `${strings.queueConfirmedPrefix}. Report to ${q.clinicName}, ${q.roomLocation} at ${q.slotTime}. Estimated wait is ${q.waitMinutes} minutes.`
        : 'No clinic queue ticket is currently booked.';
      return {
        digit,
        menuAction: 'SMART_QUEUE_CHECK',
        audioResponseText: msg,
        smsConfirmationText: `IVR Confirmation [3]: ${msg}`,
      };
    }
    case '4': {
      const n = ctx.nurseDispatch;
      const msg = n
        ? `${strings.nurseStatusPrefix}: ${n.nurseName} is ${n.status} and arriving in ${n.etaMinutes} minutes.`
        : `Supply order status: ${ctx.activeOrderStatus}.`;
      return {
        digit,
        menuAction: 'NURSE_DISPATCH_STATUS',
        audioResponseText: msg,
        smsConfirmationText: `IVR Confirmation [4]: ${msg}`,
      };
    }
    case '9': {
      const complaint = createEscalatedComplaint(complaintReason, 'ivr', nowMs);
      const msg = `${strings.complaintEscalatedPrefix}. Ticket ${complaint.complaintCode} routed to ${complaint.assignedSupervisor}.`;
      return {
        digit,
        menuAction: 'SUPERVISOR_ESCALATION',
        audioResponseText: msg,
        smsConfirmationText: `IVR Escalation [${complaint.complaintCode}]: Assigned to ${complaint.assignedSupervisor}. Updates sent periodically until resolved.`,
        complaint,
      };
    }
    case '0': {
      const order: SupportedLang[] = ['en', 'hi', 'es', 'ta'];
      const nextLang = order[(order.indexOf(ctx.language) + 1) % order.length];
      const nextStrings = getLocaleStrings(nextLang);
      return {
        digit,
        menuAction: 'LANGUAGE_SWITCH',
        nextLang,
        audioResponseText: nextStrings.ivrWelcome,
        smsConfirmationText: `Language switched to ${nextStrings.langName}.`,
      };
    }
    default:
      return {
        digit,
        menuAction: 'MAIN_MENU',
        audioResponseText: strings.ivrWelcome,
        smsConfirmationText: strings.smsHelpReply,
      };
  }
}

export function verifyOtpOrKeypadPin(input: {
  mode: 'otp' | 'keypad';
  code: string;
  expectedOtp: string;
  expectedKeypadPin: string;
  securityAnswer?: string;
  expectedSecurityAnswer?: string;
}): { verified: boolean; reason: string } {
  const cleanCode = input.code.trim();
  if (input.mode === 'otp') {
    if (!/^\d{6}$/.test(cleanCode)) {
      return { verified: false, reason: 'Enter a valid 6-digit OTP code.' };
    }
    if (cleanCode !== input.expectedOtp) {
      return { verified: false, reason: 'OTP code does not match.' };
    }
    return { verified: true, reason: 'Smartphone OTP verified.' };
  }

  if (!/^\d{4}$/.test(cleanCode)) {
    return { verified: false, reason: 'Enter a valid 4-digit keypad PIN.' };
  }
  const answerOk =
    !input.expectedSecurityAnswer ||
    (input.securityAnswer ?? '').trim().toLowerCase() === input.expectedSecurityAnswer.trim().toLowerCase();
  if (cleanCode !== input.expectedKeypadPin || !answerOk) {
    return { verified: false, reason: 'Keypad PIN or security word did not match.' };
  }
  return { verified: true, reason: 'Non-smartphone keypad verification passed.' };
}
