import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyComplaintSupervisor,
  processIvrDtmf,
  processSmsCommand,
  verifyOtpOrKeypadPin,
  type KeypadPatientContext,
} from './smsIvrEngine.ts';

const sampleCtx: KeypadPatientContext = {
  profileId: 'HC-ANA48210',
  fullName: 'Ananya Rao',
  language: 'en',
  keypadPin: '4821',
  securityAnswer: 'lotus',
  activePrescription: 'Amoxicillin 500mg twice daily for 5 days',
  activeExplanation: 'Bacterial throat recovery requires completing the 5-day antibiotic course.',
  queueSummary: {
    clinicName: 'CareGrid Metro Clinic',
    roomLocation: 'Wing B · Room 204',
    slotTime: '14:30',
    waitMinutes: 12,
  },
  nurseDispatch: {
    nurseName: 'RN Priya Menon',
    etaMinutes: 18,
    status: 'En Route',
  },
  activeOrderStatus: 'Cold-Chain Box dispatched (#ORD-902)',
};

test('processSmsCommand handles RX, QUEUE, and complaint auto-escalation', () => {
  const rx = processSmsCommand('RX', sampleCtx);
  assert.equal(rx.triggeredAction, 'prescription');
  assert.match(rx.replyText, /Amoxicillin 500mg/);

  const queue = processSmsCommand('QUEUE', sampleCtx);
  assert.equal(queue.triggeredAction, 'queue_status');
  assert.match(queue.replyText, /Wing B · Room 204 at 14:30/);

  const complaint = processSmsCommand('COMPLAINT Late medicine delivery at gate', sampleCtx, 1700000012345);
  assert.equal(complaint.triggeredAction, 'complaint_escalated');
  assert.equal(complaint.complaint?.assignedSupervisor, 'R. Kapoor · Logistics Lead');
  assert.equal(complaint.complaint?.status, 'escalated');

  const report = processSmsCommand('REPORT Nurse did not reach Indiranagar', sampleCtx, 1700000099999);
  assert.equal(report.command, 'REPORT');
  assert.equal(report.triggeredAction, 'complaint_escalated');
  assert.equal(report.complaint?.category, 'clinical_care');
});

test('processIvrDtmf handles buttons 1, 2, 9, and 0 language switch', () => {
  const d1 = processIvrDtmf('1', sampleCtx);
  assert.equal(d1.menuAction, 'PRESCRIPTION_READOUT');
  assert.match(d1.audioResponseText, /Amoxicillin/);

  const d2 = processIvrDtmf('2', sampleCtx);
  assert.equal(d2.menuAction, 'CONDITION_EXPLANATION');
  assert.match(d2.audioResponseText, /5-day antibiotic course/);

  const d9 = processIvrDtmf('9', sampleCtx, 'Nurse delayed by 40 minutes', 1700000055555);
  assert.equal(d9.menuAction, 'SUPERVISOR_ESCALATION');
  assert.equal(d9.complaint?.category, 'clinical_care');

  const d0 = processIvrDtmf('0', sampleCtx);
  assert.equal(d0.nextLang, 'hi');
});

test('verifyOtpOrKeypadPin enforces strict OTP and keypad PIN validation', () => {
  assert.equal(
    verifyOtpOrKeypadPin({
      mode: 'otp',
      code: '739204',
      expectedOtp: '739204',
      expectedKeypadPin: '4821',
    }).verified,
    true
  );
  assert.equal(
    verifyOtpOrKeypadPin({
      mode: 'keypad',
      code: '4821',
      expectedOtp: '739204',
      expectedKeypadPin: '4821',
      securityAnswer: 'Lotus',
      expectedSecurityAnswer: 'lotus',
    }).verified,
    true
  );
  assert.equal(
    verifyOtpOrKeypadPin({
      mode: 'keypad',
      code: '0000',
      expectedOtp: '739204',
      expectedKeypadPin: '4821',
    }).verified,
    false
  );
});

test('classifyComplaintSupervisor routes issues to specialized leads', () => {
  assert.equal(classifyComplaintSupervisor('Invoice billing error').category, 'billing_inventory');
  assert.equal(classifyComplaintSupervisor('Nurse did not arrive').category, 'clinical_care');
});
