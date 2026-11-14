import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  complaints,
  ivrEvents,
  nurseBookings,
  orders,
  patientProfiles,
  productReviews,
  products,
  smartQueueTickets,
  smsLogs,
  supplierMessages,
  supplyAlerts,
  triageSessions,
  users,
} from './schema.ts';
import type { ProductItem } from '../core/queueSupplyRules.ts';
import {
  evaluateInventoryThresholdTrigger,
  type SupplyAlertRecord,
  type SupplyAlertStatus,
  type SupplyTriggerSource,
} from '../core/supplyAlertEngine.ts';

export async function ensureUserRecord(uid: string, email: string, displayName?: string) {
  try {
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (existing.length > 0) return existing[0];
    const [inserted] = await db
      .insert(users)
      .values({ uid, email, displayName: displayName ?? email.split('@')[0] })
      .returning();
    return inserted;
  } catch (error) {
    console.error('SQL ensureUserRecord error:', error);
    throw new Error('Database unavailable');
  }
}

export async function upsertPatientProfile(input: {
  profileId: string;
  ownerUid: string;
  fullName: string;
  phone: string;
  preferredLang: string;
  otpVerified: boolean;
  keypadPinVerified: boolean;
  keypadPinCode: string;
  securityChallenge: string;
  allergies: string;
  medicalHistory: string;
}) {
  try {
    const existing = await db
      .select()
      .from(patientProfiles)
      .where(and(eq(patientProfiles.profileId, input.profileId), eq(patientProfiles.ownerUid, input.ownerUid)))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(patientProfiles)
        .set({
          fullName: input.fullName,
          phone: input.phone,
          preferredLang: input.preferredLang,
          otpVerified: input.otpVerified,
          keypadPinVerified: input.keypadPinVerified,
          allergies: input.allergies,
          medicalHistory: input.medicalHistory,
          updatedAt: new Date(),
        })
        .where(and(eq(patientProfiles.profileId, input.profileId), eq(patientProfiles.ownerUid, input.ownerUid)))
        .returning();
      return updated;
    }

    const [created] = await db.insert(patientProfiles).values(input).returning();
    return created;
  } catch (error) {
    console.error('SQL upsertPatientProfile error:', error);
    throw new Error('Database unavailable');
  }
}

export async function getUserDashboardData(ownerUid: string) {
  try {
    const [
      profileRows,
      productRows,
      reviewRows,
      orderRows,
      nurseRows,
      queueRows,
      complaintRows,
      smsRows,
      ivrRows,
      supplierRows,
      triageRows,
    ] = await Promise.all([
      db.select().from(patientProfiles).where(eq(patientProfiles.ownerUid, ownerUid)).limit(1),
      db.select().from(products).orderBy(products.id),
      db.select().from(productReviews).orderBy(desc(productReviews.createdAt)).limit(30),
      db.select().from(orders).where(eq(orders.ownerUid, ownerUid)).orderBy(desc(orders.createdAt)).limit(20),
      db.select().from(nurseBookings).where(eq(nurseBookings.ownerUid, ownerUid)).orderBy(desc(nurseBookings.createdAt)).limit(20),
      db.select().from(smartQueueTickets).where(eq(smartQueueTickets.ownerUid, ownerUid)).orderBy(desc(smartQueueTickets.createdAt)).limit(20),
      db.select().from(complaints).where(eq(complaints.ownerUid, ownerUid)).orderBy(desc(complaints.createdAt)).limit(30),
      db.select().from(smsLogs).where(eq(smsLogs.ownerUid, ownerUid)).orderBy(desc(smsLogs.createdAt)).limit(30),
      db.select().from(ivrEvents).where(eq(ivrEvents.ownerUid, ownerUid)).orderBy(desc(ivrEvents.createdAt)).limit(30),
      db.select().from(supplierMessages).where(eq(supplierMessages.ownerUid, ownerUid)).orderBy(desc(supplierMessages.createdAt)).limit(30),
      db.select().from(triageSessions).where(eq(triageSessions.ownerUid, ownerUid)).orderBy(desc(triageSessions.createdAt)).limit(20),
    ]);

    return {
      profile: profileRows[0] ?? null,
      products: productRows,
      reviews: reviewRows,
      orders: orderRows,
      nurseBookings: nurseRows,
      queueTickets: queueRows,
      complaints: complaintRows,
      smsLogs: smsRows,
      ivrEvents: ivrRows,
      supplierMessages: supplierRows,
      triageSessions: triageRows,
    };
  } catch (error) {
    console.error('SQL getUserDashboardData error:', error);
    throw new Error('Database unavailable');
  }
}

export async function createProductReviewSql(input: {
  productSku: string;
  ownerUid: string;
  authorName: string;
  rating: number;
  comment: string;
}) {
  try {
    const [review] = await db.insert(productReviews).values(input).returning();
    const stats = await db
      .select({
        avg: sql<number>`avg(${productReviews.rating})`,
        count: sql<number>`count(*)`,
      })
      .from(productReviews)
      .where(eq(productReviews.productSku, input.productSku));
    if (stats[0]) {
      await db
        .update(products)
        .set({
          ratingAvg: Number(Number(stats[0].avg ?? input.rating).toFixed(2)),
          reviewCount: Number(stats[0].count ?? 1),
        })
        .where(eq(products.sku, input.productSku));
    }
    return review;
  } catch (error) {
    console.error('SQL createProductReviewSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertSupplierMessageSql(input: {
  ownerUid: string;
  supplierName: string;
  businessTier: string;
  direction: string;
  body: string;
}) {
  try {
    const [row] = await db.insert(supplierMessages).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertSupplierMessageSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertNurseBookingSql(input: {
  bookingCode: string;
  ownerUid: string;
  profileId: string;
  nurseName: string;
  serviceType: string;
  address: string;
  scheduledSlot: string;
  status: string;
  nurseLat: number;
  nurseLng: number;
  etaMinutes: number;
}) {
  try {
    const [row] = await db.insert(nurseBookings).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertNurseBookingSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertQueueTicketSql(input: {
  ticketCode: string;
  ownerUid: string;
  profileId: string;
  clinicName: string;
  roomLocation: string;
  slotTime: string;
  verificationMethod: string;
  photoTag: string;
  status: string;
  waitMinutes: number;
}) {
  try {
    const [row] = await db.insert(smartQueueTickets).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertQueueTicketSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertOrderSql(input: {
  orderCode: string;
  ownerUid: string;
  profileId: string;
  itemSummary: string;
  totalCents: number;
  status: string;
  destAddress: string;
  courierLat: number;
  courierLng: number;
  etaMinutes: number;
}) {
  try {
    const [row] = await db.insert(orders).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertOrderSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertTriageSessionSql(input: {
  ownerUid: string;
  profileId: string;
  language: string;
  channel: string;
  symptomText: string;
  prescriptionText: string;
  explanationText: string;
  severity: string;
}) {
  try {
    const [row] = await db.insert(triageSessions).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertTriageSessionSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertSmsLogSql(input: {
  ownerUid: string;
  profileId: string;
  phone: string;
  direction: string;
  language: string;
  command: string;
  message: string;
}) {
  try {
    const [row] = await db.insert(smsLogs).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertSmsLogSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function insertIvrEventSql(input: {
  ownerUid: string;
  profileId: string;
  language: string;
  digitPressed: string;
  menuAction: string;
  audioPrompt: string;
}) {
  try {
    const [row] = await db.insert(ivrEvents).values(input).returning();
    return row;
  } catch (error) {
    console.error('SQL insertIvrEventSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function upsertComplaintSql(input: {
  complaintCode: string;
  ownerUid: string;
  profileId: string;
  channel: string;
  category: string;
  description: string;
  assignedSupervisor: string;
  status: string;
}) {
  try {
    const existing = await db
      .select()
      .from(complaints)
      .where(and(eq(complaints.complaintCode, input.complaintCode), eq(complaints.ownerUid, input.ownerUid)))
      .limit(1);
    if (existing.length > 0) {
      const [updated] = await db
        .update(complaints)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(complaints.complaintCode, input.complaintCode), eq(complaints.ownerUid, input.ownerUid)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(complaints).values(input).returning();
    return created;
  } catch (error) {
    console.error('SQL upsertComplaintSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function getLiveDispatchTelemetrySql(ownerUid: string) {
  try {
    const [orderRows, nurseRows] = await Promise.all([
      db.select().from(orders).where(eq(orders.ownerUid, ownerUid)).orderBy(desc(orders.updatedAt)).limit(20),
      db
        .select()
        .from(nurseBookings)
        .where(eq(nurseBookings.ownerUid, ownerUid))
        .orderBy(desc(nurseBookings.updatedAt))
        .limit(20),
    ]);
    return { orders: orderRows, nurseBookings: nurseRows };
  } catch (error) {
    console.error('SQL getLiveDispatchTelemetrySql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function advanceDispatchTelemetrySql(
  ownerUid: string,
  targetLat = 12.9716,
  targetLng = 77.5946
) {
  try {
    const current = await getLiveDispatchTelemetrySql(ownerUid);
    const now = new Date();

    for (const order of current.orders) {
      if (order.status === 'in_transit' && order.etaMinutes > 2) {
        const nextLat = order.courierLat + (targetLat - order.courierLat) * 0.14;
        const nextLng = order.courierLng + (targetLng - order.courierLng) * 0.14;
        await db
          .update(orders)
          .set({
            courierLat: nextLat,
            courierLng: nextLng,
            etaMinutes: Math.max(1, order.etaMinutes - 1),
            updatedAt: now,
          })
          .where(and(eq(orders.id, order.id), eq(orders.ownerUid, ownerUid)));
      }
    }

    for (const nurse of current.nurseBookings) {
      if ((nurse.status === 'dispatched' || nurse.status === 'en_route') && nurse.etaMinutes > 2) {
        const nextLat = nurse.nurseLat + (targetLat - nurse.nurseLat) * 0.14;
        const nextLng = nurse.nurseLng + (targetLng - nurse.nurseLng) * 0.14;
        await db
          .update(nurseBookings)
          .set({
            status: 'en_route',
            nurseLat: nextLat,
            nurseLng: nextLng,
            etaMinutes: Math.max(1, nurse.etaMinutes - 1),
            updatedAt: now,
          })
          .where(and(eq(nurseBookings.id, nurse.id), eq(nurseBookings.ownerUid, ownerUid)));
      }
    }

    return await getLiveDispatchTelemetrySql(ownerUid);
  } catch (error) {
    console.error('SQL advanceDispatchTelemetrySql error:', error);
    throw new Error('Database unavailable');
  }
}

function mapSqlProductRow(row: typeof products.$inferSelect): ProductItem {
  return {
    sku: row.sku,
    name: row.name,
    category: (row.category as ProductItem['category']) || 'diagnostics',
    priceCents: row.priceCents,
    stockQty: row.stockQty,
    reorderThreshold: row.reorderThreshold,
    supplierName: row.supplierName,
    businessTier: (row.businessTier as ProductItem['businessTier']) || 'all',
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
  };
}

function mapSqlAlertRow(row: typeof supplyAlerts.$inferSelect): SupplyAlertRecord {
  return {
    alertCode: row.alertCode,
    sku: row.sku,
    productName: row.productName,
    supplierName: row.supplierName,
    stockQty: row.stockQty,
    reorderThreshold: row.reorderThreshold,
    criticalThreshold: row.criticalThreshold,
    deficitUnits: Math.max(0, row.reorderThreshold - row.stockQty),
    suggestedReorderQty: Math.max(row.reorderThreshold * 2 - row.stockQty, 20),
    severity: row.severity === 'critical' ? 'critical' : 'low',
    status: (row.status as SupplyAlertStatus) || 'active',
    triggeredBy: (row.triggeredBy as SupplyTriggerSource) || 'db_threshold_sweep',
    smsDispatchSummary: row.smsDispatchSummary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function runSupplyThresholdTriggerSql(
  ownerUid: string,
  triggeredBy: SupplyTriggerSource
) {
  try {
    const [productRows, existingAlertRows] = await Promise.all([
      db.select().from(products).orderBy(products.id),
      db
        .select()
        .from(supplyAlerts)
        .where(eq(supplyAlerts.ownerUid, ownerUid))
        .orderBy(desc(supplyAlerts.updatedAt)),
    ]);

    const mappedProducts = productRows.map(mapSqlProductRow);
    const mappedAlerts = existingAlertRows.map(mapSqlAlertRow);
    const evaluation = evaluateInventoryThresholdTrigger(mappedProducts, mappedAlerts, triggeredBy);

    for (const alert of evaluation.alerts) {
      const existing = existingAlertRows.find((r) => r.alertCode === alert.alertCode);
      if (existing) {
        await db
          .update(supplyAlerts)
          .set({
            stockQty: alert.stockQty,
            reorderThreshold: alert.reorderThreshold,
            criticalThreshold: alert.criticalThreshold,
            severity: alert.severity,
            status: alert.status,
            triggeredBy: alert.triggeredBy,
            smsDispatchSummary: alert.smsDispatchSummary,
            updatedAt: new Date(),
          })
          .where(and(eq(supplyAlerts.alertCode, alert.alertCode), eq(supplyAlerts.ownerUid, ownerUid)));
      } else {
        await db.insert(supplyAlerts).values({
          alertCode: alert.alertCode,
          ownerUid,
          sku: alert.sku,
          productName: alert.productName,
          supplierName: alert.supplierName,
          stockQty: alert.stockQty,
          reorderThreshold: alert.reorderThreshold,
          criticalThreshold: alert.criticalThreshold,
          severity: alert.severity,
          status: alert.status,
          triggeredBy: alert.triggeredBy,
          smsDispatchSummary: alert.smsDispatchSummary,
        });
      }
    }

    return { products: mappedProducts, evaluation };
  } catch (error) {
    console.error('SQL runSupplyThresholdTriggerSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function mutateSupplyStockSql(
  ownerUid: string,
  sku: string,
  deltaQty: number,
  triggeredBy: SupplyTriggerSource
) {
  try {
    const rows = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
    if (rows.length === 0) return null;
    const nextQty = Math.max(0, rows[0].stockQty + deltaQty);
    await db.update(products).set({ stockQty: nextQty }).where(eq(products.sku, sku));
    return await runSupplyThresholdTriggerSql(ownerUid, triggeredBy);
  } catch (error) {
    console.error('SQL mutateSupplyStockSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function updateSupplyThresholdSql(
  ownerUid: string,
  sku: string,
  reorderThreshold: number
) {
  try {
    const safeThreshold = Math.max(1, Math.floor(reorderThreshold));
    await db
      .update(products)
      .set({ reorderThreshold: safeThreshold })
      .where(eq(products.sku, sku));
    return await runSupplyThresholdTriggerSql(ownerUid, 'threshold_policy_update');
  } catch (error) {
    console.error('SQL updateSupplyThresholdSql error:', error);
    throw new Error('Database unavailable');
  }
}

export async function updateSupplyAlertStatusSql(
  ownerUid: string,
  alertCode: string,
  status: SupplyAlertStatus
) {
  try {
    const [updated] = await db
      .update(supplyAlerts)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(supplyAlerts.alertCode, alertCode), eq(supplyAlerts.ownerUid, ownerUid)))
      .returning();
    return updated ? mapSqlAlertRow(updated) : null;
  } catch (error) {
    console.error('SQL updateSupplyAlertStatusSql error:', error);
    throw new Error('Database unavailable');
  }
}

