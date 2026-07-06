# Attendance & Regularization - Core Flow Review

## Module

Attendance & Regularization

## Review Scope

This review focuses only on major functionality in the core HRMS flow:

- Biometric/manual swipe processing
- Employee attendance calendar and regularization request flow
- Manager/admin regularization approval and rejection flow
- Regularization withdrawal
- Manager/admin attendance views and reports
- Attendance override flow
- Bulk attendance upload flow
- Email, leave, overtime, shift-assignment, and attendance side effects
- Role-based access, database consistency, validations, and async/task handling

Items such as debug logging cleanup, visual polish, minor table layout issues, icon consistency, and broad non-blocking performance cleanup are treated as deferred unless they directly affect the core attendance or regularization flow.

## Confidence

These findings are based on direct source-code review across the frontend and backend attendance, regularization, override, and bulk upload flows. They are valid code-level gaps. Runtime/API testing against a seeded database is still recommended before release, especially for authorization bypasses and multi-step side effects.

## Core Flow Findings

### 1. Biometric swipe API can be spoofed

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The `/attendance/swipe` route does not require authentication. The service also treats any valid MongoDB ObjectId as a user ID, not only a biometric device identifier.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts`
- `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts`
- `Zuno-hr-India/src/lib/services/api/attendance.ts`

**Impact:**  
Anyone who knows or guesses an active user's ObjectId or biometric ID can create attendance swipes for that employee. This can directly corrupt attendance, regularization, payroll, and compliance data.

**Recommendation:**  
Require a trusted device authentication mechanism for biometric swipes. Do not accept normal user ObjectIds as biometric identifiers. If manual/self swipe is supported, expose it as a separate authenticated endpoint that uses `request.user._id` and validates geo/device policy.

---

### 2. Attendance read and admin-view APIs are not scoped by role or hierarchy

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Attendance status, records, all-records, shift-records, weekly report, and admin attendance view routes are protected inconsistently. Several routes allow arbitrary `userId` or `userIds` from the request without verifying whether the current user is admin, manager of those users, or the employee themselves.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts`
- `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts`
- `Zuno-hr-India/src/lib/services/api/attendance.ts`

**Impact:**  
A logged-in staff user can potentially view another employee's attendance status, daily records, shift assignment details, admin attendance summaries, and downloadable attendance reports by calling APIs directly.

**Recommendation:**  
Add centralized attendance scope checks:

- Staff can read self only.
- Manager can read direct or approved subordinate scope only.
- Admin/HR can read all.

Apply the same scope to status, record search, shift-records, admin view, downloads, and weekly reports.

---

### 3. Development/destructive attendance endpoints are exposed

**Priority:** Core blocker  
**Area:** Backend security/data loss  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Several development or destructive endpoints are registered in normal routes without authentication or role checks, including attendance bulk insert, user-records, bulk-delete, bulk-upload cleanup, root cleanup-users, and admin collection deletion routes.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts`
- `Zuno-hr-India-Api/src/routes/bulk-attendance-upload.routes.ts`
- `Zuno-hr-India-Api/src/routes/index.ts`

**Impact:**  
Production data can be inserted, read, or deleted outside the normal HRMS flow. This is a high-risk data integrity and security issue.

**Recommendation:**  
Remove these routes from production builds. If any cleanup tooling is required, protect it behind admin-only authorization, environment guards, explicit allowlists, and audit logging.

---

### 4. Regularization list and assigned-list APIs trust request parameters

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The user regularization list route accepts arbitrary `:userId`. The assigned-list route accepts arbitrary `:approverId` and a query flag `isAdmin=true`; when `isAdmin` is true, the service removes the approver filter and returns all regularization records.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/attendance-regularization.routes.ts`
- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India/src/lib/services/api/attendance-regularization.ts`

**Impact:**  
Any authenticated user may be able to view another employee's regularization history or all pending/processed regularization records by altering the URL or query string.

**Recommendation:**  
Ignore client-provided authority flags. Derive scope from `request.user` only. Admin access should be based on backend role checks, and manager access should be limited to records assigned to the current manager or their approved hierarchy.

---

### 5. Regularization approval/rejection trusts client-provided approver

**Priority:** Core blocker  
**Area:** Backend security/business logic  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The status update route requires `approver` in the request body and passes it directly into the service. The service does not verify that the current authenticated user is the assigned approver or an admin.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/attendance-regularization.routes.ts`
- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India/src/lib/components/attendance-Regularization/RegularizationList.svelte`
- `Zuno-hr-India/src/routes/manager/regularization/[id]/+page.svelte`
- `Zuno-hr-India/src/routes/admin/regularization/[id]/+page.svelte`

**Impact:**  
A user can approve or reject a regularization request and spoof the approver identity. Attendance records can then be updated as if the request was legitimately processed.

**Recommendation:**  
Remove `approver` from the client contract. Use `request.user` as the actor. Before mutation, verify:

- Record is pending.
- Actor is assigned approver or admin.
- Actor has access to the employee.

Return 403 for unauthorized actions.

---

### 6. Regularization withdrawal lacks ownership checks

**Priority:** Core blocker  
**Area:** Backend security/business logic  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The withdraw route only requires authentication and passes the regularization ID to the service. The service validates that the record is pending, but does not verify that the current user owns the request or is allowed to withdraw it.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/attendance-regularization.routes.ts`
- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India/src/lib/components/attendance-Regularization/RegularizationList.svelte`
- `Zuno-hr-India/src/routes/my/regularization/[id]/+page.svelte`

**Impact:**  
Any authenticated user can withdraw someone else's pending regularization if they know the record ID.

**Recommendation:**  
Pass `request.user` into the withdraw service and verify ownership before status mutation. Optionally allow admin withdrawal only if the business requires it, with audit remarks.

---

### 7. Regularization creation can mutate another user's attendance

**Priority:** Core blocker  
**Area:** Backend security/data integrity  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Single regularization creation sets `userId` from `request.user`, but validation only checks that `attendanceId` exists and needs regularization. It does not verify that the attendance record belongs to the current user. Bulk regularization is worse: it accepts `userId`, `attendanceId`, and `approver` from the client.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/attendance-regularization.routes.ts`
- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India/src/lib/components/attendance-Regularization/RegularizationFormBulk.svelte`

**Impact:**  
A user can create a regularization record against another employee's attendance record. This can attach pending regularization metadata to the wrong attendance record and corrupt approval queues.

**Recommendation:**  
For self regularization, derive `userId` and approver from authenticated user profile and manager mapping. Validate `attendance.userId === request.user._id`. For admin/manager bulk creation, require explicit privileged route and hierarchy checks.

---

### 8. Attendance override routes are not admin-protected

**Priority:** Core blocker  
**Area:** Backend security/business logic  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Attendance override routes are described as admin operations but only require authentication. The service receives `adminId` from the authenticated user but does not validate that the user is actually an admin.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/attendance-override.routes.ts`
- `Zuno-hr-India-Api/src/services/attendance-override.service.ts`

**Impact:**  
Any authenticated user may be able to override attendance as present, absent, holiday swipe, or on-leave. The on-leave override path can also create or approve leave records as part of the override flow.

**Recommendation:**  
Restrict override create, bulk override, history, and detail endpoints to admin/HR roles. Record actor, reason, before/after values, and source module in an immutable audit trail.

---

### 9. Regularization state transitions are not transactional

**Priority:** High data consistency risk  
**Area:** Backend database interaction  
**Roles affected:** Admin, Manager, Staff, Payroll/Admin downstream users

**Finding:**  
Regularization create, approve, reject, and withdraw flows save the regularization document and attendance record in separate operations. Approval/rejection saves the regularization status before applying attendance updates.

**Evidence:**

- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`

**Impact:**  
A request can be marked approved, rejected, or withdrawn while the linked attendance record remains pending or unchanged. This can affect attendance dashboards, payroll, timesheets, and employee history.

**Recommendation:**  
Use MongoDB transactions for regularization status plus attendance updates. If transactions are not available, use a state-machine approach with retryable `processing_failed` states and reconciliation jobs.

---

### 10. Out-of-window swipes are double-processed

**Priority:** High business logic risk  
**Area:** Backend attendance calculation  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
When a swipe is outside the allowed window, the service records it through `processOutOfWindowSwipe`, but then continues into normal first/second/multiple swipe processing. This can turn an out-of-window event into a normal attendance record and overwrite or dilute the `Out-Of-Window` status.

**Evidence:**

- `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts`

**Impact:**  
Out-of-window swipes may be counted as normal present attendance while also being stored as out-of-window data. This creates inconsistent regularization requirements and incorrect work-hour outcomes.

**Recommendation:**  
Define a single outcome for out-of-window swipes. Either store only as out-of-window pending regularization, or process it normally with a persistent `Out-Of-Window` status. Do not run both flows unless explicitly modeled.

---

### 11. Rejected regularization leave-vs-absent handling is incomplete

**Priority:** High business logic risk  
**Area:** Backend regularization/leave integration  
**Roles affected:** Admin, Manager, Staff, Payroll/Admin downstream users

**Finding:**  
Rejected regularization handling has a hardcoded `hasLeaveBalance = false`. As a result, rejected regularization always becomes absent, even though `Rejected-Leave` exists as a status. The regularization document can remain `Rejected` while the attendance embedded regularization status becomes `Rejected-Absent`.

**Evidence:**

- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India-Api/src/models/attendance-regularization.model.ts`
- `Zuno-hr-India-Api/src/models/attendance-record.model.ts`

**Impact:**  
Employees with leave balance may still be marked absent. Statuses can diverge between regularization and attendance collections, creating reporting and payroll ambiguity.

**Recommendation:**  
Complete the rejection policy:

- Determine whether rejection should consume leave, mark absent, or require admin decision.
- Update regularization and attendance statuses consistently.
- Integrate with leave summary in the same transaction.

---

### 12. Regularization validation has ownership, timing, and shift-assignment gaps

**Priority:** High business logic/data integrity risk  
**Area:** Backend validation  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Validation does not check attendance ownership. Bulk regularization's shift-bound validation is commented out. A null shift assignment can be dereferenced before the null check. The regularization service also does not filter shift assignments by `isActive`, unlike the biometric attendance service.

**Evidence:**

- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`

**Impact:**  
Requests can be created against the wrong employee, outside valid shift boundaries, against inactive assignments, or fail with a generic runtime error instead of a clean validation response.

**Recommendation:**  
Centralize regularization eligibility validation:

- Attendance belongs to actor or permitted employee scope.
- Shift assignment exists and is active.
- Requested time range is within the shift/window policy.
- `from < to`.
- No pending/approved request already exists for the same attendance/date.

---

### 13. Bulk attendance upload can leave partial shift, overtime, and attendance state

**Priority:** High data consistency risk  
**Area:** Backend bulk upload/database interaction  
**Roles affected:** Admin, Manager, External/Staff employees, Payroll/Admin downstream users

**Finding:**  
Bulk upload processes shift assignment changes, overtime creation, and attendance insertions in separate operations. Existing shift assignments can be modified before attendance insert fails. Overtime records can be created before attendance insert succeeds. Swipe `location` is stored as a string even though the attendance schema expects a location object.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/bulk-attendance-upload.routes.ts`
- `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts`
- `Zuno-hr-India-Api/src/models/attendance-record.model.ts`

**Impact:**  
Bulk upload can partially change shifts, create orphan overtime, or fail due to schema mismatch. Retrying the upload can then create duplicate or inconsistent state.

**Recommendation:**  
Wrap bulk upload per employee or per batch in a transaction. Validate generated attendance records before modifying existing shift assignments. Store location using the schema shape or omit it. Make retries idempotent.

---

### 14. Half-day leave preservation uses the wrong leave lookup shape

**Priority:** Medium business logic risk  
**Area:** Backend attendance/leave integration  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Attendance swipe processing tries to preserve half-day leave by querying `Leave.findOne({ shiftDay: record.shiftDay, leaveDuration: 'half-day' })`. The leave model and other leave flows use start/end dates, so this lookup is likely ineffective.

**Evidence:**

- `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts`
- `Zuno-hr-India-Api/src/models/leave.model.ts`

**Impact:**  
Approved half-day leave may not be preserved when swipes are added later. Attendance can appear as only present/late/early instead of reflecting the half-day leave.

**Recommendation:**  
Query approved half-day leave by `startDate <= shiftDay <= endDate`, normalized to day boundaries. Keep attendance status and leave status synchronized.

---

### 15. Frontend state and API contracts amplify backend authority issues

**Priority:** Medium UX/security-supporting issue  
**Area:** Frontend + API contract  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Frontend manager/admin regularization screens send approver identity and `isAdmin` flags to the backend. The employee attendance page captures `userId` once before auth may be ready. Manager attendance initializes `selectedEmployeeIds` as a `Set` but later assigns an array.

**Evidence:**

- `Zuno-hr-India/src/lib/services/api/attendance-regularization.ts`
- `Zuno-hr-India/src/routes/my/attendance/+page.svelte`
- `Zuno-hr-India/src/routes/manager/attendance/+page.svelte`
- `Zuno-hr-India/src/lib/components/managerActions/AssignedRegularization.svelte`
- `Zuno-hr-India/src/lib/components/attendance-Regularization/AdminRegularization.svelte`

**Impact:**  
Auth loading can produce failed self-attendance calls. Manager selection can break if selection handlers are used. More importantly, the frontend currently encodes authority in client-controlled request data, which should only be derived by the backend.

**Recommendation:**  
Make frontend calls simpler and less trusted:

- Backend derives actor, approver, admin status, and employee scope.
- Frontend waits for auth user before requesting self attendance.
- Keep `selectedEmployeeIds` as one consistent type.

---

### 16. Manager/admin review email links point to a missing route

**Priority:** Medium core UX issue  
**Area:** Backend email + Frontend routing  
**Roles affected:** Manager, Admin

**Finding:**  
Regularization request emails link to `/manager/attendance-approvals/:id`, but the existing frontend route is `/manager/regularization/:id` and manager queue access is `/manager/actions?tab=regularization`.

**Evidence:**

- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India/src/routes/manager/regularization/[id]/+page.svelte`
- `Zuno-hr-India/src/lib/components/managerActions/AssignedRegularization.svelte`

**Impact:**  
Approvers may receive a broken link and fail to process regularization requests from email.

**Recommendation:**  
Update email templates to route to the existing manager regularization detail page, or add a redirect route for backward compatibility.

## Async, Tasks, and Side-Effect Findings

### A1. Attendance and regularization emails are not handled through a durable async task pattern

**Priority:** High reliability risk  
**Area:** Backend async/side effect  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Attendance regularization creation, approval, rejection, and admin notifications call the email service directly inside request handling. Some failures are swallowed; in bulk regularization, the approver email is outside the local email try/catch and can cause a row to be reported as failed after database writes already succeeded.

**Evidence:**

- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`
- `Zuno-hr-India-Api/src/services/email.service.ts`

**Impact:**  
Users may not receive important attendance notifications. Bulk results can incorrectly report failure after records were created. API latency and reliability depend on SMTP behavior.

**Recommendation:**  
Use a durable notification outbox/job queue. Persist email jobs after the core database transaction commits. Track `queued`, `sent`, `failed`, retry count, last error, and related regularization/attendance IDs.

---

### A2. Bulk attendance upload and bulk regularization should be background jobs

**Priority:** High scalability/reliability risk  
**Area:** Backend async/batch processing  
**Roles affected:** Admin, Manager, External/Staff employees

**Finding:**  
Bulk upload and bulk regularization process rows sequentially in request/response flow while performing multiple database writes and notification side effects.

**Evidence:**

- `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts`
- `Zuno-hr-India-Api/src/services/attendance-regularization.service.ts`

**Impact:**  
Large uploads can time out, partially complete, or return inconsistent row statuses. Users have no durable progress or retry visibility.

**Recommendation:**  
Move bulk operations to background jobs with upload/job IDs, progress, row-level results, idempotency keys, retry support, and downloadable error reports.

---

### A3. Attendance override with leave creation/approval is not transactionally isolated

**Priority:** High reliability risk  
**Area:** Backend side effects  
**Roles affected:** Admin, Staff, Payroll/Admin downstream users

**Finding:**  
On-leave attendance override can create or approve leave, then separately update attendance override fields. These operations are not wrapped in a transaction.

**Evidence:**

- `Zuno-hr-India-Api/src/services/attendance-override.service.ts`
- `Zuno-hr-India-Api/src/services/leave.service.ts`

**Impact:**  
The system can create or approve a leave while failing to complete the attendance override, or vice versa. Attendance, leave balance, and override history can diverge.

**Recommendation:**  
Treat leave override as one domain transaction: leave status, leave balance, attendance record, override metadata, and audit log should commit or fail together. Queue notifications after commit.

## Deferred Work

The following items were found during review but are not part of the immediate core-flow fix list:

- Reduce sensitive and noisy attendance debug logging.
- Normalize time format strings such as `0:00:00` versus `00:00:00`.
- Improve frontend regularization form layout and mobile density.
- Add pagination directly in attendance/regularization database queries instead of paginating after loading all records.
- Add upload history and real statistics for bulk upload; current stats return placeholder zeros.
- Standardize attendance status enums across frontend, attendance records, and regularization records.
- Add indexes for frequent regularization query patterns if missing after access-control fixes.
- Clean up obsolete or commented validation blocks after the correct policy is implemented.

## Suggested Fix Order

1. Lock down exposed/destructive routes and remove production-unsafe endpoints.
2. Fix swipe API authentication and stop accepting user ObjectIds as biometric identifiers.
3. Add centralized attendance and regularization scope middleware.
4. Fix regularization approval, rejection, withdrawal, and override authorization.
5. Add ownership validation for regularization create and bulk create.
6. Make regularization status plus attendance updates transactional.
7. Correct rejected regularization leave/absent behavior.
8. Fix out-of-window swipe processing.
9. Transactionalize bulk upload and override-leave side effects.
10. Move attendance/regularization emails and bulk operations to durable async jobs.
11. Fix frontend auth readiness, Set/array state, and broken email links.

## Recommended Verification Scenarios

- Call `/attendance/swipe` without auth using another user's ObjectId and confirm the fixed API rejects it.
- Login as staff and attempt to fetch another user's attendance records, shift-records, admin view, and regularization history; confirm 403.
- Login as staff and attempt to approve, reject, or withdraw another user's regularization by ID; confirm 403.
- Submit a regularization request using self auth but another user's `attendanceId`; confirm the fixed API rejects it.
- Submit bulk regularization with another user's `userId` and `attendanceId`; confirm hierarchy/admin checks are enforced.
- Attempt attendance override as staff and manager; confirm only permitted admin/HR roles can override.
- Force email failure during regularization create/approval and confirm database state remains correct while notification job records failure/retry.
- Force attendance update failure after regularization status change and confirm transaction rollback.
- Swipe outside the shift window and confirm it produces exactly one consistent attendance outcome.
- Reject a regularization for an employee with available leave balance and verify the intended absent/leave policy is applied consistently.
- Upload a bulk attendance file with one invalid row and confirm no partial shift/overtime/attendance state remains.
- Open regularization email review links and confirm they land on the existing manager detail route.
