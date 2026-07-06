# Leave Management - Core Flow Review

## Module

Leave Management

## Review Scope

This review focuses only on major functionality in the core HRMS flow:

- Leave application
- Leave approval and rejection
- Leave cancellation
- Leave list/detail access
- Leave balances and summaries
- Admin allotment updates
- Monthly/quarterly leave release
- Year-end carry-forward
- Apply-on-behalf flow
- Email, attendance, and balance side effects

Items such as debug logging cleanup, visual polish, minor table UX issues, and broad performance tuning are treated as deferred unless they directly affect the core leave flow.

## Confidence

These findings are based on direct source-code review across frontend and backend leave flows. They are valid code-level gaps. Runtime testing is still recommended before release, especially for approval/cancellation side effects against a seeded database.

## Core Flow Findings

### 1. Leave read APIs are not scoped to user role or hierarchy

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Several authenticated leave read routes accept arbitrary `userId`, leave ID, or `appliedTo` values without enforcing whether the current user is admin, the leave owner, or the assigned manager. The general list endpoint can also be called without a user filter.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/leave.routes.ts`
- `Zuno-hr-India-Api/src/services/leave.service.ts`

**Impact:**  
A logged-in user may be able to view another employee's leave history, leave details, manager queue, reasons, approval metadata, and uploaded documents by changing request parameters.

**Recommendation:**  
Add backend scoped-access helpers for leave reads:

- Admin can view all.
- Manager can view assigned/direct or recursive subordinate leaves only.
- Staff can view self only.

Apply the same scope to list, detail, summary, release history, carry-forward history, and document-linked leave responses.

---

### 2. Leave approval/rejection lacks consistent approver authorization

**Priority:** Core blocker  
**Area:** Backend security/business logic  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The approval route only requires authentication. In the service, manager/admin checks are used for applied-on-behalf logic, but the normal leave approval path can update status without clearly verifying that the current user is the assigned manager or an admin.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/leave.routes.ts`
- `Zuno-hr-India-Api/src/services/leave.service.ts`

**Impact:**  
Any authenticated user may be able to approve, reject, or cancel another employee's pending leave by calling the status endpoint directly.

**Recommendation:**  
Enforce approval authorization in the backend before status mutation:

- Admin can approve/reject according to business rules.
- Assigned manager can approve/reject only assigned leaves.
- Staff cannot approve/reject.

Return 403 for unauthorized status changes.

---

### 3. Frontend cancel API does not match backend cancel route

**Priority:** Core UX/API contract issue  
**Area:** Frontend + Backend API contract  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The frontend leave API calls `POST /leaves/:id/cancel`, while the backend exposes cancellation as `DELETE /leaves/:id`.

**Evidence:**

- `Zuno-hr-India/src/lib/services/api/leaves.ts`
- `Zuno-hr-India-Api/src/routes/leave.routes.ts`

**Impact:**  
Leave cancellation from the UI may fail even though the backend has a cancellation implementation. Users may be unable to withdraw pending leaves through the normal screen.

**Recommendation:**  
Normalize the contract. Prefer a status-based cancellation endpoint such as `POST /leaves/:id/cancel` or `PATCH /leaves/:id/status`, and keep backend and frontend aligned.

---

### 4. Leave creation and balance reservation are not atomic

**Priority:** Core data consistency risk  
**Area:** Backend database interaction  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The leave create flow creates the leave record, then separately updates the leave summary/balance. These operations are not wrapped in a MongoDB transaction.

**Evidence:**

- `Zuno-hr-India-Api/src/services/leave.service.ts`
- `Zuno-hr-India-Api/src/services/leave-summary.service.ts`

**Impact:**  
If the leave is created but the summary update fails, the request can exist without the correct balance reservation. If the API is retried, duplicate or incorrect balance effects are possible.

**Recommendation:**  
Use a transaction for leave creation plus balance reservation, or introduce an idempotent state machine that marks the leave as `creation_failed` or `balance_update_pending` and retries safely.

---

### 5. Approval saves status before attendance and balance side effects finish

**Priority:** Core data consistency risk  
**Area:** Backend business logic + attendance dependency  
**Roles affected:** Admin, Manager, Staff, Payroll/Admin downstream users

**Finding:**  
The approval flow saves the leave status, sends notifications, and only then updates attendance records. Rejection/cancellation balance reversal errors are caught and ignored.

**Evidence:**

- `Zuno-hr-India-Api/src/services/leave.service.ts`

**Impact:**  
A leave can appear approved while attendance records are missing or partially updated. A rejection/cancellation can appear complete while leave balance remains consumed. This can affect attendance, payroll, and final settlement calculations.

**Recommendation:**  
Complete core database side effects first: status, balance, attendance, and audit trail. Only after successful commit should email/FCM notifications be queued. Do not swallow balance or attendance failures for core state transitions.

---

### 6. Pending leave cancellation can delete the leave even if balance reversal fails

**Priority:** Core data loss/consistency risk  
**Area:** Backend business logic  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Cancellation tries to reverse the leave summary, catches any failure, and still deletes the leave record.

**Evidence:**

- `Zuno-hr-India-Api/src/services/leave.service.ts`

**Impact:**  
The leave can disappear from history while the balance remains deducted/reserved. This makes reconciliation difficult because the audit record is removed.

**Recommendation:**  
Do not delete leave records for cancellation. Mark them as `Cancelled` and reverse balance in the same transaction. If reversal fails, keep the leave visible with a retryable failed state.

---

### 7. Admin leave-balance mutation endpoints are only authenticated

**Priority:** Core security/business risk  
**Area:** Backend authorization  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Leave allotment, release, carry-forward, and batch carry-forward routes are described as admin operations, but the reviewed route handlers only apply authentication. Admin role checks were found on some list/report endpoints, not on these mutation endpoints.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/leave-summary.routes.ts`

**Impact:**  
Non-admin users may be able to mutate leave balances, release quarterly/monthly leave, or process carry-forward by calling APIs directly.

**Recommendation:**  
Add backend role middleware to every leave-summary mutation route. Restrict balance mutation, release, carry-forward, and history-wide admin views to admin or explicit HR roles.

## Async, Tasks, and Side-Effect Findings

### A1. Leave notification emails are awaited in request flow but not durable

**Priority:** High reliability risk  
**Area:** Backend async/side effect  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Leave create, approval, rejection, allotment, release, and carry-forward flows call the shared email service directly. Some email failures are swallowed, while others can fail the API after the database has already changed.

**Evidence:**

- `Zuno-hr-India-Api/src/services/email.service.ts`
- `Zuno-hr-India-Api/src/services/leave.service.ts`
- `Zuno-hr-India-Api/src/services/leave-summary.service.ts`
- `Zuno-hr-India-Api/src/services/leave-release.service.ts`
- `Zuno-hr-India-Api/src/services/leave-carry-forward.service.ts`

**Impact:**  
Users may not receive important leave notifications, admins may not know delivery failed, and API latency depends on SMTP. The system has no retry or delivery audit for core leave notifications.

**Recommendation:**  
Queue all leave emails through a durable notification outbox after the core database transaction commits. Track status, retry count, last error, and related leave/release/carry-forward IDs.

---

### A2. Quarterly/monthly leave release should be a background batch job

**Priority:** High scalability/reliability risk  
**Area:** Backend async/bulk processing  
**Roles affected:** Admin, Staff

**Finding:**  
Leave release loops through employees sequentially inside the API request, updates summary, creates a release record, and sends email per employee.

**Evidence:**

- `Zuno-hr-India-Api/src/services/leave-release.service.ts`
- `Zuno-hr-India-Api/src/routes/leave-summary.routes.ts`

**Impact:**  
Large quarterly releases can be slow, partially complete, or time out. If summary update succeeds but release record creation or email fails, audit and notification state can diverge.

**Recommendation:**  
Create a release batch record and process employees in a worker. Return a job ID to the UI. Use idempotency keys such as `employeeId + year + period + leaveType + releaseType` to prevent duplicate releases.

---

### A3. Carry-forward is multi-step and not transactionally safe

**Priority:** High data consistency risk  
**Area:** Backend async/batch processing  
**Roles affected:** Admin, Staff

**Finding:**  
Carry-forward creates a carry-forward record, updates the source-year summary, updates the destination-year summary, optionally creates a release history record, and sends email as separate operations.

**Evidence:**

- `Zuno-hr-India-Api/src/services/leave-carry-forward.service.ts`

**Impact:**  
Partial success can leave an audit record without complete balance changes, or updated balances without matching release history. Batch carry-forward repeats the same risk across many employees.

**Recommendation:**  
Use a transaction for carry-forward record, source summary, destination summary, and release history. Process batch carry-forward through a job worker with per-employee retry and failure reporting.

---

### A4. Apply-on-behalf document upload can leave orphaned files

**Priority:** Medium reliability risk  
**Area:** Backend file side effect  
**Roles affected:** Admin, Staff

**Finding:**  
The apply-on-behalf route uploads the supporting document to GCP before creating the leave. If leave creation later fails, the uploaded file can remain unattached. The upload metadata also uses `EmployeeLifecycle` and `OfferLetter`, which is not semantically correct for leave documents.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/leave.routes.ts`

**Impact:**  
Storage can accumulate orphaned files, and leave documents may be misclassified in downstream document views or cleanup routines.

**Recommendation:**  
Use leave-specific document metadata. If upload remains synchronous, add cleanup on leave creation failure. For larger document workflows, use a direct upload plus attach/confirm flow or async file processing job.

## Deferred Work

The following items were found during review but are not part of the immediate core-flow fix list:

- Remove excessive debug logging from leave routes, services, and frontend pages.
- Normalize status casing between frontend types and backend values.
- Review search and pagination query performance for large leave datasets.
- Add stronger validation for decimal day values and country-specific leave types.
- Improve UI loading and error states for long-running release/carry-forward actions.
- Review response field selection for leave documents and approval metadata.

## Suggested Fix Order

1. Add backend role/scope enforcement for leave reads and mutations.
2. Fix approval/rejection authorization.
3. Align frontend/backend cancellation API contract.
4. Make leave create/cancel/status transitions transactionally safe.
5. Move leave notification emails to an outbox/job queue.
6. Convert release and carry-forward into background batch jobs.
7. Fix apply-on-behalf document upload cleanup and metadata.

## Recommended Verification Scenarios

- Call leave list/detail/userId/applied-to APIs as staff, unrelated manager, assigned manager, and admin to confirm correct scoping.
- Attempt leave approval/rejection as a staff user, unrelated manager, assigned manager, and admin.
- Cancel a pending leave from the UI and confirm the frontend route matches the backend route and balance is restored.
- Simulate leave-summary update failure during leave create/cancel and confirm the system does not leave partial state.
- Approve leave while attendance update fails and confirm notifications are not sent before core side effects complete.
- Run quarterly release for multiple employees with SMTP disabled and confirm release state, email retry state, and partial failures are trackable.
- Run carry-forward with a forced failure after the source-year update and confirm balances and audit records remain consistent.
- Submit apply-on-behalf with a document, then force leave creation failure and confirm uploaded files are cleaned up or not attached incorrectly.
