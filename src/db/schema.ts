import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const patientProfiles = pgTable('patient_profiles', {
  id: serial('id').primaryKey(),
  profileId: text('profile_id').notNull().unique(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  preferredLang: text('preferred_lang').default('en').notNull(),
  otpVerified: boolean('otp_verified').default(false).notNull(),
  keypadPinVerified: boolean('keypad_pin_verified').default(false).notNull(),
  keypadPinCode: text('keypad_pin_code').notNull(),
  securityChallenge: text('security_challenge').notNull(),
  allergies: text('allergies').default('None reported').notNull(),
  medicalHistory: text('medical_history').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  priceCents: integer('price_cents').notNull(),
  stockQty: integer('stock_qty').notNull(),
  reorderThreshold: integer('reorder_threshold').default(25).notNull(),
  supplierName: text('supplier_name').notNull(),
  businessTier: text('business_tier').default('all').notNull(),
  description: text('description').notNull(),
  ratingAvg: doublePrecision('rating_avg').default(4.8).notNull(),
  reviewCount: integer('review_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const productReviews = pgTable('product_reviews', {
  id: serial('id').primaryKey(),
  productSku: text('product_sku').notNull(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  authorName: text('author_name').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const supplierMessages = pgTable('supplier_messages', {
  id: serial('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  supplierName: text('supplier_name').notNull(),
  businessTier: text('business_tier').notNull(),
  direction: text('direction').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderCode: text('order_code').notNull().unique(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  itemSummary: text('item_summary').notNull(),
  totalCents: integer('total_cents').notNull(),
  status: text('status').notNull(),
  destAddress: text('dest_address').notNull(),
  courierLat: doublePrecision('courier_lat').notNull(),
  courierLng: doublePrecision('courier_lng').notNull(),
  etaMinutes: integer('eta_minutes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const nurseBookings = pgTable('nurse_bookings', {
  id: serial('id').primaryKey(),
  bookingCode: text('booking_code').notNull().unique(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  nurseName: text('nurse_name').notNull(),
  serviceType: text('service_type').notNull(),
  address: text('address').notNull(),
  scheduledSlot: text('scheduled_slot').notNull(),
  status: text('status').notNull(),
  nurseLat: doublePrecision('nurse_lat').notNull(),
  nurseLng: doublePrecision('nurse_lng').notNull(),
  etaMinutes: integer('eta_minutes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const smartQueueTickets = pgTable('smart_queue_tickets', {
  id: serial('id').primaryKey(),
  ticketCode: text('ticket_code').notNull().unique(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  clinicName: text('clinic_name').notNull(),
  roomLocation: text('room_location').notNull(),
  slotTime: text('slot_time').notNull(),
  verificationMethod: text('verification_method').notNull(),
  photoTag: text('photo_tag').notNull(),
  status: text('status').notNull(),
  waitMinutes: integer('wait_minutes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const triageSessions = pgTable('triage_sessions', {
  id: serial('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  language: text('language').notNull(),
  channel: text('channel').notNull(),
  symptomText: text('symptom_text').notNull(),
  prescriptionText: text('prescription_text').notNull(),
  explanationText: text('explanation_text').notNull(),
  severity: text('severity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const smsLogs = pgTable('sms_logs', {
  id: serial('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  phone: text('phone').notNull(),
  direction: text('direction').notNull(),
  language: text('language').notNull(),
  command: text('command').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ivrEvents = pgTable('ivr_events', {
  id: serial('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  language: text('language').notNull(),
  digitPressed: text('digit_pressed').notNull(),
  menuAction: text('menu_action').notNull(),
  audioPrompt: text('audio_prompt').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const complaints = pgTable('complaints', {
  id: serial('id').primaryKey(),
  complaintCode: text('complaint_code').notNull().unique(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  profileId: text('profile_id').notNull(),
  channel: text('channel').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  assignedSupervisor: text('assigned_supervisor').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplyAlerts = pgTable('supply_alerts', {
  id: serial('id').primaryKey(),
  alertCode: text('alert_code').notNull().unique(),
  ownerUid: text('owner_uid')
    .references(() => users.uid)
    .notNull(),
  sku: text('sku').notNull(),
  productName: text('product_name').notNull(),
  supplierName: text('supplier_name').notNull(),
  stockQty: integer('stock_qty').notNull(),
  reorderThreshold: integer('reorder_threshold').notNull(),
  criticalThreshold: integer('critical_threshold').notNull(),
  severity: text('severity').notNull(),
  status: text('status').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  smsDispatchSummary: text('sms_dispatch_summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

