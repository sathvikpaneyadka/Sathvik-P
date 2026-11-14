# CareGrid Firestore Security Specification

## 1. Data Invariants
1. **Strict Patient PII & Profile Isolation**: `users/{userId}/private/{docId}` and `patientProfiles/{profileId}` contain PII (`email`, `phone`, `uniqueProfileId`) and medical summary fields. No other signed-in user may `get` or `list` another user's private info or medical profile. Only the owning `request.auth.uid` (with verified email) or a verified bootstrapped/registered supervisor admin may access them.
2. **Identity Integrity**: Every document with `ownerUid` or `uid` MUST enforce `data.ownerUid == request.auth.uid` (or `data.uid == request.auth.uid`) at creation and prevent `ownerUid` / `uid` / `createdAt` mutation on updates.
3. **Anti-Update-Gap & Ghost Field Guard**: Every `create` and `update` invokes its `isValid[Entity](incoming())` helper enforcing `keys().hasAll(...)` and `keys().hasOnly(...)`, type safety, and strict `.size()` bounds. Every `update` explicitly constrains `incoming().diff(existing()).affectedKeys().hasOnly([...])` per action branch.
4. **Temporal Integrity**: `createdAt == request.time` on creation and `updatedAt == request.time` on updates.
5. **Terminal State Locking**: Completed/cancelled `queueTickets`, completed `dispatches`, and resolved `escalations` cannot be mutated by non-admin users once terminal.
6. **Privilege Escalation Prevention**: `/admins/{uid}` is read-only for the owning user and cannot be written from client SDKs. Admin bootstrap checks `request.auth.token.email == "sathvikpaneyadka@gmail.com" && request.auth.token.email_verified == true`.
7. **Secure List Queries**: Every `allow list` validates `resource.data.ownerUid == request.auth.uid` (or `isAdmin()`) directly on `resource.data` without `get()` lookups.
8. **Supply Alert Lifecycle Lock**: `/supplyAlerts/{alertId}` validates integer bounds (`0..1000000`) for `stockQty`/`reorderThreshold`/`criticalThreshold`, restricts `severity` (`low`/`critical`) and `status` (`active`/`acknowledged`/`resolved`), locks `sku`/`ownerUid`/`createdAt`, and prevents non-admins from reopening `resolved` alerts.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read on `/patientProfiles/HC-AB12CD`**: Missing `request.auth`.
2. **Cross-user `get` on `/users/victimUid/private/info`**: `request.auth.uid != victimUid`.
3. **Blanket `list` query on `/patientProfiles` without `where('ownerUid', '==', auth.uid)`**: Non-owner records fail `resource.data.ownerUid == request.auth.uid`.
4. **Identity Spoofing on create**: Writing `/queueTickets/t1` with `ownerUid: "victimUid"`.
5. **Shadow / Ghost Field Injection**: Creating `/patientProfiles/HC-123456` with extra key `isVerifiedAdmin: true`.
6. **Self-Assigned Admin Escalation**: Writing `/admins/attackerUid` with `{ role: "admin" }`.
7. **Email Spoofing Admin Bypass**: Token with `email: "sathvikpaneyadka@gmail.com"` and `email_verified: false`.
8. **ID Poisoning**: Creating `/queueTickets/bad$id!` or a 200-character document ID violating `isValidId()`.
9. **Client Timestamp Forgery**: Creating `/dispatches/d1` with a backdated `createdAt` instead of `request.time`.
10. **Immutable Field Overwrite**: Updating `/queueTickets/t1` to change `ownerUid` or `createdAt` or `/supplyAlerts/a1` to change `sku`.
11. **Terminal State Resurrection**: Non-admin attempting to reopen `/escalations/e1` or `/supplyAlerts/a1` after terminal resolution (`resolved`).
12. **Value Poisoning**: Updating `/queueTickets/t1` `roomLocation` with a 1,000-character string exceeding `.size() <= 120`, or `/supplyAlerts/a1` `stockQty: -5`.

