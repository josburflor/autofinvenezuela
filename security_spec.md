# Security Specification — Autofin Venezuela CRM (Zero-Trust Firestore)

## 1. Data Invariants & Relationship Mapping (Master Source of Truth)

1. **Global Default-Deny**: All paths default to `allow read, write: if false`. Every collection declared in `firebase-blueprint.json` has an explicit, hardened `match` block.
2. **Trusted RBAC (`/admins/{adminUid}`)**:
   - Auth tokens never carry custom role claims. Admin privileges are resolved strictly from either the bootstrapped runtime owner (`josburflor@gmail.com` with `email_verified == true`) or an active document in `/admins/$(request.auth.uid)` where `isActive == true` and `role in ['super_admin', 'admin']`.
   - Non-admin users can never self-register or escalate privileges in `/admins/{adminUid}`.
   - Admins cannot delete their own active admin record.
3. **PII Isolation (`/leads/{leadId}` & `/leadLocks/{lockId}`)**:
   - Customer PII (`cedula`, `phone`, `email`, `availableAmount`) in `/leads/{leadId}` is NEVER readable by unauthenticated visitors or random signed-in users. `get` requires `isActiveAdvisor()` and `list` requires `isBootstrappedAdmin()` or `resource.data.assignedAdvisorUid == request.auth.uid` (zero `get()`/`exists()` inside `allow list`).
   - `/leadLocks/{lockId}` forbids public reads (`get` only for `isAdmin()`, `list: if false`) to prevent enumeration of registered national IDs, phones, or emails.
4. **Atomic Uniqueness Guarantee (`existsAfter`)**:
   - A `Lead` document in `/leads/{leadId}` cannot be created unless its three deterministic uniqueness lock documents (`cedulaLockId`, `phoneLockId`, `emailLockId`) exist after the batch (`existsAfter`), AND each `/leadLocks/{lockId}` document requires `existsAfter(/databases/$(database)/documents/leads/$(incoming().leadDocId))` and `allow update: if false`. Any attempt to submit a duplicate `cedula`, `phone`, or `email` collides with an existing lock document, triggers the `update: if false` gate, and aborts the entire batch atomically.
5. **Terminal State Locking (`/leads/{leadId}`)**:
   - Once a `Lead` reaches a terminal status (`'Cerrado'` or `'Perdido'`), non-admin advisors are blocked from mutating the document; only `isAdmin()` can override terminal states.
6. **Master Gate for Subcollections (`/leads/{leadId}/activities/{activityId}` & `/leads/{leadId}/attachments/{attachmentId}`)**:
   - Neither an activity nor an attachment can be created, read (`get`), updated, or deleted unless the parent `/leads/$(leadId)` document exists (`exists(...)`) and the caller is an active verified staff member (`isActiveAdvisor()`).
   - `advisorUid` / `uploadedByUid` must strictly match `request.auth.uid` on creation and remain immutable.
7. **Temporal & Structural Integrity**:
   - Every `createdAt` and `updatedAt` timestamp must equal `request.time`.
   - Every `create` enforces `hasAll` + `hasOnly` and every `update` wraps logic inside `isValid[Entity](incoming())` plus action-specific `affectedKeys().hasOnly(...)` and immutability gates.

---

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)

1. **Payload 1 — Privilege Escalation / Self-Assigned Admin (`/admins/attacker_uid`)**:
   ```json
   {
     "uid": "attacker_uid",
     "email": "attacker@example.com",
     "displayName": "Attacker",
     "role": "super_admin",
     "isActive": true,
     "createdByUid": "attacker_uid",
     "createdAt": "SERVER_TIMESTAMP",
     "updatedAt": "SERVER_TIMESTAMP"
   }
   ```
2. **Payload 2 — Unverified Bootstrapped Admin Email Spoof (`/leads` read)**:
   - Token: `{ "uid": "spoof_1", "email": "josburflor@gmail.com", "email_verified": false }` attempting `getDoc(/leads/lead_1)`.
3. **Payload 3 — PII Scraping by Authenticated Non-Staff User (`/leads/lead_1` get)**:
   - Token: `{ "uid": "random_user", "email": "visitor@gmail.com", "email_verified": true }` attempting `getDoc(/leads/lead_1)`.
4. **Payload 4 — Shadow / Ghost Field Injection on Lead Creation (`/leads/lead_shadow`)**:
   ```json
   {
     "...validLeadFields": true,
     "isApprovedVIP": true
   }
   ```
5. **Payload 5 — Public Lead Creation Without Atomic Uniqueness Locks (`/leads/lead_nolock`)**:
   - Attempting `setDoc(/leads/lead_nolock, validLeadPayload)` without creating `/leadLocks/{cedulaLockId}`, `/leadLocks/{phoneLockId}`, and `/leadLocks/{emailLockId}` in the same atomic batch.
6. **Payload 6 — Duplicate Cedula Registration Overwriting Existing Lock (`/leadLocks/ced_V12345678`)**:
   - Attempting a second batch write using an already registered `cedulaLockId` (`ced_V12345678`), triggering `update` on `/leadLocks`.
7. **Payload 7 — Public Lead Status Spoofing (`status: 'Cerrado'` on `create`)**:
   - Submitting a public lead with `"status": "Cerrado"` instead of `"Nuevo"`.
8. **Payload 8 — Client Timestamp Forgery (`createdAt` != `request.time`)**:
   - Submitting a past timestamp `2020-01-01T00:00:00Z` for `createdAt` instead of `serverTimestamp()`.
9. **Payload 9 — Terminal State Bypass by Non-Admin Advisor (`/leads/lead_closed` update)**:
   - Active `'asesor'` attempting to change `status` on a lead whose existing `status` is `'Cerrado'`.
10. **Payload 10 — Value Poisoning / Oversized String DoW Attack (`/advisorProfiles/main` update)**:
    - Authorized advisor attempting to update `advisorName` with a 5,000-character string (exceeding `maxLength: 120`) or wrong type (`advisorName: 99999`).
11. **Payload 11 — Orphaned Subcollection Write (`/leads/nonexistent_lead/activities/act_1` create)**:
    - Active advisor attempting to create an activity under a `leadId` that does not exist in `/leads`.
12. **Payload 12 — Identity Spoofing in Activity Creation (`advisorUid` != `request.auth.uid`)**:
    - Advisor `uid_A` attempting to create `/leads/lead_1/activities/act_2` with `"advisorUid": "uid_B"`.

---

## 3. Automated Test Suite

See `/firestore.rules.test.ts` for the executable `@firebase/rules-unit-testing` verification suite covering all 12 Dirty Dozen payloads.
