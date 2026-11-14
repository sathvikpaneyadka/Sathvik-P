export interface ProductItem {
  sku: string;
  name: string;
  category: 'diagnostics' | 'cold_chain' | 'infusion' | 'home_care';
  priceCents: number;
  stockQty: number;
  reorderThreshold: number;
  supplierName: string;
  businessTier: 'small' | 'enterprise' | 'all';
  ratingAvg: number;
  reviewCount: number;
}

export interface SmartQueueBookingInput {
  profileId: string;
  clinicName: string;
  urgency: 'routine' | 'priority' | 'urgent';
  verificationMethod: 'photo_match' | 'keypad_token';
  photoUploaded: boolean;
  photoLabel?: string;
  existingQueueCount: number;
}

export interface SmartQueueAllocation {
  ticketCode: string;
  roomLocation: string;
  slotTime: string;
  waitMinutes: number;
  verificationMethod: 'photo_match' | 'keypad_token';
  photoTag: string;
  notificationText: string;
}

export function generateUniqueProfileId(seedText: string, randomSuffix?: string): string {
  const cleaned = seedText.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) || 'PAT';
  const suffix =
    randomSuffix?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5) ||
    Math.random().toString(36).substring(2, 7).toUpperCase();
  const padded = (cleaned + suffix).padEnd(8, '0').slice(0, 8);
  return `HC-${padded}`;
}

export function canAccessPatientProfile(requesterUid: string, ownerUid: string): boolean {
  return Boolean(requesterUid) && requesterUid === ownerUid;
}

export function allocateSmartQueueSlot(
  input: SmartQueueBookingInput,
  nowDate = new Date()
): SmartQueueAllocation {
  if (input.verificationMethod === 'photo_match' && !input.photoUploaded) {
    throw new Error('Upload a check-in or visit photo to verify Smart Queue arrival (QR scanning is disabled).');
  }

  const baseDelayMin =
    input.urgency === 'urgent' ? 8 : input.urgency === 'priority' ? 16 : 24 + input.existingQueueCount * 9;
  const scheduled = new Date(nowDate.getTime() + baseDelayMin * 60_000);
  const hh = String(scheduled.getHours()).padStart(2, '0');
  const mm = String(scheduled.getMinutes()).padStart(2, '0');
  const slotTime = `${hh}:${mm}`;

  const roomMap: Record<SmartQueueBookingInput['urgency'], string> = {
    urgent: 'Wing A · Rapid Triage Suite 102',
    priority: 'Wing B · Consultation Room 204',
    routine: 'Wing C · Outpatient Desk 308',
  };

  const roomLocation = roomMap[input.urgency];
  const ticketCode = `SQ-${String(nowDate.getTime()).slice(-5)}`;
  const photoTag =
    input.verificationMethod === 'photo_match'
      ? `Photo Verified (${input.photoLabel || 'check-in-photo.jpg'})`
      : 'Keypad Token Verified';

  return {
    ticketCode,
    roomLocation,
    slotTime,
    waitMinutes: baseDelayMin,
    verificationMethod: input.verificationMethod,
    photoTag,
    notificationText: `${input.clinicName} · ${roomLocation} at ${slotTime} (${baseDelayMin} min wait) · ${photoTag}`,
  };
}

export function getStockHealth(item: Pick<ProductItem, 'stockQty' | 'reorderThreshold'>): 'critical' | 'low' | 'healthy' {
  if (item.stockQty <= Math.floor(item.reorderThreshold * 0.4)) return 'critical';
  if (item.stockQty <= item.reorderThreshold) return 'low';
  return 'healthy';
}

export function computeInventorySummary(items: ProductItem[]) {
  let totalUnits = 0;
  let totalValuationCents = 0;
  let lowStockCount = 0;
  let criticalCount = 0;

  for (const item of items) {
    totalUnits += item.stockQty;
    totalValuationCents += item.stockQty * item.priceCents;
    const health = getStockHealth(item);
    if (health === 'low') lowStockCount += 1;
    if (health === 'critical') criticalCount += 1;
  }

  return {
    totalUnits,
    totalValuationCents,
    lowStockCount,
    criticalCount,
    skuCount: items.length,
  };
}

export function computeUpdatedRating(currentAvg: number, currentCount: number, newRating: number) {
  const clamped = Math.max(1, Math.min(5, Math.round(newRating)));
  const nextCount = currentCount + 1;
  const nextAvg = Number(((currentAvg * currentCount + clamped) / nextCount).toFixed(2));
  return { ratingAvg: nextAvg, reviewCount: nextCount };
}
