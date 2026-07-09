# WFH & Permission Requests - Core Review

## Module Scope

This review covers the core WFH and Permission request flow:

- Employee permission request submission.
- Employee WFH request submission.
- Admin WFH apply-on-behalf flow.
- Manager/admin approval and rejection actions.
- Employee cancellation/withdrawal behavior.
- Permission monthly balance and allotment flow.
- WFH yearly balance and allotment flow.
- WFH interaction with attendance views and payroll-facing attendance calculations.
- Notification and async/task handling for request creation, approval, rejection, and allotment updates.

Deferred/non-core areas for later review:

- Visual redesign of list/detail pages.
- Generic table/filter component improvements.
- Full notification template copy polish.
- Non-core setup pages outside WFH/Permission allotment behavior.
- Broad RBAC framework refactor beyond this module.

## Core Flow Summary

1. Employee submits a Permission request through `/permissions`.
2. Backend uses the authenticated user as `userId`, checks monthly permission balance, blocks duplicate same-day permission requests, creates a `Permission` record, updates `PermissionSummary`, and sends manager/admin emails.
3. Employee submits a WFH request through `/wfh`.
4. Backend uses the authenticated user as `userId`, recalculates WFH working days from shift weekend days and mandatory holidays, checks overlapping WFH requests, checks WFH balance from `LeaveSummary.workFromHome`, creates a `WFH` record, updates `LeaveSummary`, and sends manager/admin emails.
5. Admin can submit WFH on behalf of an employee through `/wfh/apply-on-behalf`; the route validates admin role and optional supporting document upload.
6. Manager/admin opens detail pages and calls `/:id/status` to approve or reject Permission/WFH requests.
7. Employee can cancel own pending requests through `/:id/cancel`; however, the status endpoints also accept `Cancelled`.
8. Admin pages can bulk update Permission allotments through `/permission-summary/allotments/bulk`.
9. Admin pages can bulk update WFH allotments through `/wfh-summary/allotments/bulk`, which writes into `LeaveSummary.workFromHome`.
10. Attendance admin views derive WFH labels by querying approved WFH requests; WFH approval itself does not write attendance records.
11. Payroll salary calculation reads attendance records and approved leave, but does not read WFH or Permission records directly.

## Applicable Roles Reviewed

- Employee/staff: self-apply Permission/WFH, view own requests, cancel pending requests.
- Manager: view assigned requests, approve/reject assigned requests.
- Admin/superadmin: view all requests, approve/reject, manage allotments, apply WFH on behalf.
- Unrelated authenticated user: reviewed because several APIs rely only on authentication and accept arbitrary IDs.

## Priority Legend

- P0: Critical security or destructive data integrity issue.
- P1: Core business flow can produce incorrect attendance, payroll, approval, or balance state.
- P2: Important reliability, UX, scalability, or maintainability issue.
- P3: Cleanup or deferred improvement.

## Positive Observations

- WFH request creation recalculates `noOfDays` on the backend instead of trusting frontend input.
- WFH request creation uses assigned shift weekend days where available.
- WFH request creation excludes mandatory holidays from WFH day count.
- WFH request creation blocks fully weekend/holiday-only date ranges.
- WFH request creation checks overlapping WFH requests.
- WFH apply-on-behalf route has an explicit admin/superadmin guard.
- WFH apply-on-behalf validates file extension, size, and maximum file count.
- Permission request creation checks monthly approved + pending balance before creating the request.
- Permission request creation blocks duplicate permission requests for the same date.
- Approval notification emails are wrapped in `try/catch` in the update-status paths, so approval itself generally does not fail because employee/admin notification failed.

## Findings

### P0 - Permission Approval/Status Endpoint Allows Unauthorized Status Changes

Evidence:

- Route only uses authentication: `Zuno-hr-India-Api/src/routes/permission.routes.ts:334`
- Route passes the current user as approver without checking assignment/role: `Zuno-hr-India-Api/src/routes/permission.routes.ts:351`
- Service updates any pending permission request without role, ownership, or `appliedTo` validation: `Zuno-hr-India-Api/src/services/permission.service.ts:475`
- Service accepts `Approved`, `Rejected`, and `Cancelled`: `Zuno-hr-India-Api/src/services/permission.service.ts:35`

Issue:

Any authenticated user who knows or can discover a pending Permission request id can approve, reject, or cancel that request. The service does not verify that the caller is the assigned approver, admin/superadmin, or the applicant cancelling their own request.

Impact:

- Employees can approve or reject other employees' permission requests.
- Employees can cancel other employees' pending permission requests through the status endpoint.
- Approval records can falsely show the attacker as the approver.
- Permission balances can be deducted or left unchanged based on unauthorized status changes.

Recommendation:

- Enforce authorization in the service layer before mutating status.
- Allow `Approved`/`Rejected` only for assigned approver, authorized manager chain, admin, or superadmin.
- Allow `Cancelled` only for the applicant's own pending request or admin/superadmin with audit reason.
- Reject self-approval unless explicit admin override is required by business policy.
- Add tests for employee cannot approve, unrelated manager cannot approve, assigned manager can approve, admin can approve, and applicant can only cancel own pending request.

### P0 - WFH Approval/Status Endpoint Allows Unauthorized Status Changes

Evidence:

- Route only uses authentication: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:570`
- Route passes current user as approver without route-level role/scope check: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:587`
- Normal WFH approval branch writes status without validating `isAdmin` or `isManager`: `Zuno-hr-India-Api/src/services/wfh.service.ts:886`
- Applied-on-behalf rejection branch sets status to `Rejected` before any manager/admin enforcement: `Zuno-hr-India-Api/src/services/wfh.service.ts:819`

Issue:

For normal WFH requests, any authenticated user can approve, reject, or cancel any pending WFH request. For applied-on-behalf WFH, unauthorized users cannot approve through the approval branch, but they can reject because the rejection branch does not enforce manager/admin scope.

Impact:

- Unauthorized WFH approvals can cause attendance views to mark WFH.
- Unauthorized WFH approvals can deduct WFH balance.
- Unauthorized rejection can block valid WFH.
- Audit data can incorrectly identify the attacker as approver/rejector.

Recommendation:

- Enforce status-change authorization for all WFH request types.
- For normal WFH, allow only assigned approver/admin/superadmin to approve or reject.
- For applied-on-behalf WFH, enforce the same manager/admin rule for both approval and rejection.
- Reserve cancellation for applicant/admin with explicit policy.
- Add tests for normal WFH and applied-on-behalf WFH status changes by employee, unrelated manager, assigned manager, admin, and applicant.

### P0 - Request List, Detail, Applied-To, and Summary APIs Are Not Properly Role-Scoped

Evidence:

- Permission list accepts arbitrary `userId` before role filtering: `Zuno-hr-India-Api/src/routes/permission.routes.ts:154`
- WFH list accepts arbitrary `userId` before role filtering: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:386`
- Permission applied-to route accepts arbitrary `appliedTo`: `Zuno-hr-India-Api/src/routes/permission.routes.ts:197`
- WFH applied-to route accepts arbitrary `appliedTo`: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:433`
- Permission detail route fetches by id without ownership/scope check: `Zuno-hr-India-Api/src/routes/permission.routes.ts:306`
- WFH detail route fetches by id without ownership/scope check: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:542`
- Permission summary and balance routes accept arbitrary `userId`: `Zuno-hr-India-Api/src/routes/permission-summary.routes.ts:7`
- WFH summary and balance routes accept arbitrary `userId`: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:7`

Issue:

The route comments and frontend assume role-based filtering, but if a caller passes explicit `userId`, `appliedTo`, or request id, the backend does not consistently enforce employee ownership, manager subordinate scope, or admin-only access.

Impact:

- Employees can view other employees' WFH/Permission request history.
- Employees can infer managers, reasons, dates, hours/days, status, and remarks.
- Employees can query WFH/Permission balances for arbitrary users.
- Managers can potentially view requests outside their team by passing another approver id.

Recommendation:

- Treat user-supplied `userId`, `appliedTo`, and request id as untrusted.
- For employee role, force `userId = currentUser._id`.
- For manager role, allow only direct/authorized report scope and assigned `appliedTo = currentUser._id`.
- For admin/superadmin/HR, allow broader filtering.
- Add authorization checks after fetching by id because route parameters bypass list filtering.

### P0 - Allotment Mutation APIs Are Marked Admin-Only But Only Require Authentication

Evidence:

- Permission single allotment route comment says Admin but only authenticates: `Zuno-hr-India-Api/src/routes/permission-summary.routes.ts:116`
- Permission bulk allotment route only authenticates: `Zuno-hr-India-Api/src/routes/permission-summary.routes.ts:273`
- WFH single allotment route comment says Admin but only authenticates: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:97`
- WFH bulk allotment route only authenticates: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:242`

Issue:

Any authenticated user can call the allotment APIs directly and modify Permission hours or WFH yearly days for arbitrary employees.

Impact:

- Employees can increase their own Permission/WFH balances.
- Employees can reduce or zero out other employees' balances.
- WFH alloted `0` means unlimited, so unauthorized users can make WFH unlimited.
- Balance data used by request validation becomes untrustworthy.

Recommendation:

- Add admin/superadmin/HR permission checks to all allotment mutation routes.
- Validate each target employee is active and belongs to the permitted organization/country scope.
- Add audit history for who changed allotments, old value, new value, reason, and timestamp.
- Add tests proving normal employee and unrelated manager cannot mutate allotments.

### P1 - Request Creation Can Persist Data Then Fail Because Email Is Sent Synchronously

Evidence:

- Permission is created before email send: `Zuno-hr-India-Api/src/services/permission.service.ts:375`
- Permission summary is updated before manager email send: `Zuno-hr-India-Api/src/services/permission.service.ts:379`
- Permission manager email is awaited outside `try/catch`: `Zuno-hr-India-Api/src/services/permission.service.ts:407`
- WFH is created before email send: `Zuno-hr-India-Api/src/services/wfh.service.ts:688`
- WFH summary is updated before manager email send: `Zuno-hr-India-Api/src/services/wfh.service.ts:691`
- WFH manager email is awaited outside `try/catch`: `Zuno-hr-India-Api/src/services/wfh.service.ts:725`

Issue:

Core request creation writes records and updates summaries before sending manager email. If manager email fails, the API can return an error even though the request and summary already changed.

Impact:

- Employee sees "failed" but the request exists as pending.
- Employee may retry and hit duplicate/overlap errors.
- Manager may not receive notification.
- Support/admin sees confusing persisted records from failed submissions.

Recommendation:

- Move email sending to an async job/outbox after DB commit.
- Return success once DB state is durable.
- Store notification status separately: pending, sent, failed, retry_count, last_error.
- Add a retry worker for failed notifications.
- If not adding a queue immediately, wrap manager email in `try/catch` and do not fail request creation after DB write.

### P1 - Status Update and Summary Update Are Not Transaction-Safe

Evidence:

- Permission status is saved before summary recalculation: `Zuno-hr-India-Api/src/services/permission.service.ts:506`
- Permission summary is updated after status save: `Zuno-hr-India-Api/src/services/permission.service.ts:521`
- WFH status is saved before summary recalculation: `Zuno-hr-India-Api/src/services/wfh.service.ts:910`
- WFH `LeaveSummary.workFromHome` is updated after status save: `Zuno-hr-India-Api/src/services/wfh.service.ts:921`

Issue:

Approval/rejection/cancellation persists request status first, then updates summary. There is no MongoDB transaction/session covering both writes.

Impact:

- Request can show `Approved` while summary still shows old `availed` or `remaining`.
- Balance validation for later requests can use stale summary data.
- Admin reconciliation becomes difficult because the request is source-of-truth in one place and summary in another.

Recommendation:

- Use MongoDB transactions for request status + summary update.
- Alternatively, make request status the source of truth and rebuild summaries idempotently through a reconciliation job.
- Add a background consistency checker for PermissionSummary and `LeaveSummary.workFromHome`.
- Add tests that simulate summary update failure after status save.

### P1 - Balance Checks Are Race-Prone Under Concurrent Requests

Evidence:

- Permission reads current balance and pending/approved totals before creating: `Zuno-hr-India-Api/src/services/permission.service.ts:319`
- Permission creates after the balance check: `Zuno-hr-India-Api/src/services/permission.service.ts:375`
- WFH reads current balance and pending/approved totals before creating: `Zuno-hr-India-Api/src/services/wfh.service.ts:644`
- WFH creates after the balance check: `Zuno-hr-India-Api/src/services/wfh.service.ts:688`

Issue:

Two parallel requests can both pass the balance check before either pending request is visible to the other transaction.

Impact:

- Permission monthly balance can be oversubscribed.
- WFH yearly balance can be oversubscribed.
- Managers/admins may approve requests that should never have entered pending state.

Recommendation:

- Use a transaction with conditional summary update or an atomic quota reservation.
- Track pending reservations in the summary using atomic `$inc` and reject if remaining would go negative.
- Use idempotency keys to avoid duplicate request creation on retries.
- Add concurrency tests for simultaneous submissions.

### P1 - Approved WFH Is Not Safely Integrated With Payroll Attendance Calculation

Evidence:

- Attendance admin views derive WFH by querying approved WFH records: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:2380`
- Attendance entries are marked `isWFH` in view construction: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:2603`
- Payroll salary calculation reads `AttendanceRecord` and approved `Leave`: `Zuno-hr-India-Api/src/services/payroll/salary-calculator.service.ts:60`
- Payroll salary calculation does not query WFH: `Zuno-hr-India-Api/src/services/payroll/salary-calculator.service.ts:65`

Issue:

WFH is derived in some attendance display/export paths but WFH approval does not create or update an `AttendanceRecord`. Payroll salary calculation does not query WFH records. Therefore, approved WFH may not protect payroll if there is no attendance record for that day.

Impact:

- Employee with approved WFH can be treated as absent in payroll calculations.
- Admin attendance view and payroll can disagree.
- WFH status becomes a display overlay rather than a durable attendance state.

Recommendation:

- Define the canonical payroll effect of approved WFH.
- On approval, create/update attendance records for WFH dates, or update payroll calculation to include approved WFH records directly.
- Exclude backend-computed WFH weekends/mandatory holidays from payroll WFH days.
- Add tests for approved WFH with no swipe, WFH with swipe, WFH on weekend/holiday, and WFH spanning payroll month boundaries.

### P1 - Permission Does Not Integrate With Attendance or Payroll Shortfall Logic

Evidence:

- Payroll salary calculation only reads attendance records and approved leave: `Zuno-hr-India-Api/src/services/payroll/salary-calculator.service.ts:60`
- Permission records are handled only by Permission routes/services and PermissionSummary.
- Permission request model stores date and hours, but not attendance adjustment metadata: `Zuno-hr-India-Api/src/models/permission.model.ts:8`

Issue:

Approved Permission hours are deducted from PermissionSummary, but there is no core integration that adjusts late entry, early exit, shortfall hours, or payable attendance interpretation.

Impact:

- Employee can have approved permission but still appear short/late in attendance.
- Payroll-facing attendance can still penalize an employee despite approved Permission.
- Permission becomes an approval ledger, not an attendance-policy adjustment.

Recommendation:

- Define exactly what approved Permission means: late waiver, early exit waiver, shortfall offset, or informational only.
- Apply approved Permission to attendance calculation and payroll inputs.
- Store applied permission reference or adjusted shortfall on attendance record/audit trail.
- Add tests for permission covering late arrival, early exit, partial-day shortfall, weekend/holiday, and leave-overlap cases.

### P1 - WFH Frontend Counts Calendar Days While Backend Deducts Working Days

Evidence:

- Frontend WFH form computes requested days as raw date difference: `Zuno-hr-India/src/lib/components/wfh/WFHForm.svelte:36`
- Backend recalculates working days excluding shift weekends and mandatory holidays: `Zuno-hr-India-Api/src/services/wfh.service.ts:553`
- Backend overwrites `noOfDays` with computed working days: `Zuno-hr-India-Api/src/services/wfh.service.ts:607`
- Apply-on-behalf form also computes raw calendar days: `Zuno-hr-India/src/lib/components/wfh/ApplyOnBehalfForm.svelte:44`

Issue:

The frontend can block or warn based on calendar-day count, while the backend validates based on working-day count. A Friday-Monday request with a Saturday/Sunday weekend can show 4 requested days on the frontend but only 2 WFH days on the backend.

Impact:

- Valid WFH requests can be blocked by frontend balance validation.
- Admin apply-on-behalf screen can display misleading day count and balance warnings.
- Employee loses trust because submitted result can differ from what the form showed.

Recommendation:

- Add a backend WFH calculation/preview endpoint that returns computed working days, excluded weekends, excluded holidays, and balance impact.
- Use that endpoint in employee and admin forms before submission.
- Do not block based on frontend-only calendar math.
- Display excluded dates so users understand why backend day count differs.

### P1 - Frontend 3-Day WFH Rule Can Use Wrong Weekend Calendar

Evidence:

- WFH form uses `check3DayRule(startDate, weekends)`: `Zuno-hr-India/src/lib/components/wfh/WFHForm.svelte:124`
- `weekends` defaults to `[0, 6]`: `Zuno-hr-India/src/lib/components/wfh/WFHForm.svelte:11`
- Backend resolves weekend days from the user's active shift assignment: `Zuno-hr-India-Api/src/services/wfh.service.ts:512`
- Utility message says "leave" even when WFH uses it: `Zuno-hr-India/src/lib/utils/businessDays.ts:58`

Issue:

The frontend may apply a default Saturday/Sunday weekend rule while the backend applies the employee's actual shift weekend calendar.

Impact:

- Frontend can block valid WFH for employees with non-standard weekends.
- Frontend can allow a request that backend rejects.
- Error copy says "leave" on a WFH flow.

Recommendation:

- Use backend preview/validation for the 3-business-day rule.
- Pass actual employee shift weekend days into WFH form where possible.
- Make the utility message module-neutral or configurable.

### P1 - Employees Can Supply Arbitrary Approver Data

Evidence:

- Permission route accepts `appliedTo` from request body: `Zuno-hr-India-Api/src/routes/permission.routes.ts:77`
- WFH route accepts `appliedTo` from request body: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:310`
- Permission form sends `user.managerId` from client state: `Zuno-hr-India/src/lib/components/permission/PermissionForm.svelte:161`
- WFH form sends `user.managerId` from client state: `Zuno-hr-India/src/lib/components/wfh/WFHForm.svelte:150`

Issue:

The backend trusts client-provided `appliedTo` if it exists. A caller can select another approver, stale manager, inactive user, or themselves.

Impact:

- Requests can be routed to the wrong approver.
- Manager queues become incomplete or polluted.
- Employee can pair this with the unauthorized status endpoint to self-approve through API.

Recommendation:

- Derive `appliedTo` server-side for employee self-application.
- Only allow admin apply-on-behalf to override approver, and validate selected approver is active and allowed.
- Store approver id as ObjectId consistently.
- Add tests for client-supplied approver spoofing.

### P1 - Permission Create Can Persist Request Then Fail On Invalid Manager Id

Evidence:

- Route falls back to blank appliedTo id when no manager exists: `Zuno-hr-India-Api/src/routes/permission.routes.ts:87`
- Service creates the permission before resolving manager: `Zuno-hr-India-Api/src/services/permission.service.ts:375`
- Service constructs `new Types.ObjectId(permission.appliedTo?._id)` without validating it: `Zuno-hr-India-Api/src/services/permission.service.ts:388`

Issue:

If `appliedTo._id` is empty or invalid, the request can be created and summary updated, then manager lookup can throw a cast error.

Impact:

- API returns failure although a Permission request exists.
- Employee retries and gets duplicate/balance errors.
- Pending request may have no valid approver.

Recommendation:

- Validate manager/approver before creating the Permission record.
- If no manager exists, either block with a clear error or route to HR/admin queue based on policy.
- Mirror WFH's safer ObjectId validation before manager email lookup.

### P1 - WFH Summary Has Two Competing Storage Paths

Evidence:

- Dedicated WFH summary service writes `WFHSummary`: `Zuno-hr-India-Api/src/services/wfh-summary.service.ts:11`
- Active WFH summary routes read `leaveSummaryService.getLeaveSummary`: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:32`
- WFH allotment route writes `LeaveSummary.workFromHome`: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:160`
- WFH request creation also writes `LeaveSummary.workFromHome`: `Zuno-hr-India-Api/src/services/wfh.service.ts:691`

Issue:

The codebase has a dedicated `WFHSummary` model/service, but the active WFH summary APIs and WFH service use `LeaveSummary.workFromHome`. This creates an unused or stale parallel source of truth.

Impact:

- Developers can accidentally read or write the wrong summary collection.
- Future fixes may update `WFHSummary` while UI still reads `LeaveSummary`.
- Data migration/reporting can become inconsistent.

Recommendation:

- Choose one canonical WFH summary source.
- If `LeaveSummary.workFromHome` is canonical, remove or clearly deprecate `WFHSummary` service/model.
- If `WFHSummary` is desired, migrate active routes/services to it and remove WFH from `LeaveSummary`.
- Add data consistency checks during migration.

### P1 - WFH Cross-Year Requests Are Not Split Correctly

Evidence:

- WFH create uses start date year for balance/summary: `Zuno-hr-India-Api/src/services/wfh.service.ts:642`
- Approved WFH yearly total only counts requests where `startDate >= Jan 1` and `endDate <= Dec 31`: `Zuno-hr-India-Api/src/services/wfh.service.ts:1158`
- Pending WFH yearly total uses the same fully-contained date range rule: `Zuno-hr-India-Api/src/services/wfh.service.ts:1183`

Issue:

WFH requests spanning year boundaries are not prorated or split across years. The yearly total query can exclude cross-year WFH entirely from both years depending on the range.

Impact:

- WFH balance can be undercounted or deducted from the wrong year.
- Year-end WFH requests can bypass yearly allocation controls.
- Attendance and summary can disagree for boundary dates.

Recommendation:

- Split WFH working days by year during balance validation and summary update.
- Store per-year day allocations for a cross-year request or disallow cross-year WFH with a clear error.
- Add tests for Dec-Jan WFH ranges.

### P1 - WFH and Permission Do Not Check Conflicts With Leave, Holidays, Attendance Regularization, or Each Other

Evidence:

- WFH checks overlapping WFH only: `Zuno-hr-India-Api/src/services/wfh.service.ts:626`
- Permission checks duplicate Permission for same date only: `Zuno-hr-India-Api/src/services/permission.service.ts:356`
- WFH excludes mandatory holidays from day count but does not check approved/pending leave overlaps.

Issue:

WFH and Permission requests can coexist with leave, optional/restricted holiday, regularization, attendance overrides, or each other unless blocked somewhere outside this module.

Impact:

- Employee can have approved leave and approved WFH for the same day.
- Employee can have permission hours on non-working days or leave days.
- Payroll-facing attendance interpretation becomes ambiguous.

Recommendation:

- Add conflict checks against approved/pending leave, WFH, Permission, attendance regularization, and attendance overrides.
- Define precedence rules: leave vs WFH vs permission vs regularization vs manual attendance override.
- Return actionable conflict messages with conflicting request ids/dates.

### P1 - Supporting WFH Documents Are Stored As Public OfferLetter Files

Evidence:

- WFH apply-on-behalf uploads to GCP with category `EmployeeLifecycle`: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:170`
- WFH apply-on-behalf uses type `OfferLetter`: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:175`
- Upload is marked `public: true`: `Zuno-hr-India-Api/src/routes/wfh.routes.ts:176`

Issue:

Supporting WFH documents are categorized as offer letters and uploaded as public files.

Impact:

- Sensitive supporting documents may be publicly accessible.
- Document classification and lifecycle management are incorrect.
- Cleanup/retention policies for offer letters may incorrectly apply to WFH attachments.

Recommendation:

- Store WFH documents under a dedicated private category/type.
- Use signed URLs or authenticated download endpoints.
- Scan uploaded documents if malware scanning infrastructure exists.
- Add file metadata for owner, purpose, request id, and access policy.

### P2 - Allotment Notification Handling Is Inconsistent and Not Task-Based

Evidence:

- WFH allotment route updates `LeaveSummary.workFromHome`: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:160`
- WFH bulk allotment processes users in `Promise.all`: `Zuno-hr-India-Api/src/routes/wfh-summary.routes.ts:343`
- `updateLeaveAllotments` sends email inline: `Zuno-hr-India-Api/src/services/leave-summary.service.ts:576`
- Permission bulk allotment updates PermissionSummary without notification: `Zuno-hr-India-Api/src/services/permission-summary.service.ts:140`

Issue:

WFH allotment uses the leave-summary email path and sends emails inline in the request. Permission allotment has no employee notification. Neither flow uses an async task/outbox with retries.

Impact:

- Bulk WFH allotment can be slow and fragile for many employees.
- Email failure after DB save can mark an item failed even though the allotment changed.
- Permission allotment changes can happen silently.
- There is no reliable notification retry trail.

Recommendation:

- Use a common allotment notification job for WFH and Permission.
- Persist allotment changes first, then enqueue notification jobs.
- Include email status, retries, and last error.
- For bulk changes, return job id and counts instead of blocking until all emails send.

### P2 - Frontend and Backend Disagree On Permission Default Allotment

Evidence:

- Permission form falls back to 2 hours when summary endpoint fails: `Zuno-hr-India/src/lib/components/permission/PermissionForm.svelte:72`
- Permission form falls back to 2 available hours on general balance load failure: `Zuno-hr-India/src/lib/components/permission/PermissionForm.svelte:121`
- Admin Permission list hardcodes `2 hrs/month`: `Zuno-hr-India/src/lib/components/permission/PermissionList.svelte:100`
- PermissionSummary creates default alloted `0`: `Zuno-hr-India-Api/src/services/permission-summary.service.ts:25`

Issue:

UI copy and fallback behavior imply a default 2 hours/month policy, but backend summary defaults to 0 hours unless admin explicitly allots hours.

Impact:

- Employee can see available/default Permission hours that backend does not actually allow.
- Admin list can show misleading allotment data.
- Support confusion when requests fail despite UI claiming default allocation.

Recommendation:

- Decide whether Permission has a default monthly allocation.
- If yes, seed/create default allotments server-side.
- If no, remove hardcoded `2 hrs/month` UI copy and fallback.
- Never use frontend fallback as business truth.

### P2 - Search/List APIs Use N+1 User Lookups

Evidence:

- Permission list populates user/approver with per-row queries: `Zuno-hr-India-Api/src/services/permission.service.ts:184`
- Permission applied-to list also uses per-row queries: `Zuno-hr-India-Api/src/services/permission.service.ts:858`
- WFH list populates user/approver with per-row queries: `Zuno-hr-India-Api/src/services/wfh.service.ts:368`
- WFH applied-to list also uses per-row queries: `Zuno-hr-India-Api/src/services/wfh.service.ts:1294`

Issue:

Each page of request data can trigger two user lookups per row after the main list query.

Impact:

- Manager/admin lists slow down as request volume grows.
- Search/filter pages place avoidable load on MongoDB.
- Bulk admin pages become more expensive under high employee counts.

Recommendation:

- Use Mongoose `populate`, aggregation `$lookup`, or denormalized immutable user snapshots consistently.
- Use `.lean()` for read-only list queries.
- Add indexes for common filters: userId/date/status/appliedTo/status/date.
- Keep stored user snapshot fields in sync or treat them as historical display data.

### P2 - Applied-On-Behalf Approval Model Is Inconsistent With "Dual Approval" Fields

Evidence:

- WFH model stores manager/admin approval fields: `Zuno-hr-India-Api/src/models/wfh.model.ts`
- Service comment says "Handle dual approval for applied on behalf": `Zuno-hr-India-Api/src/services/wfh.service.ts:818`
- Approval branch immediately approves if either manager or admin approves: `Zuno-hr-India-Api/src/services/wfh.service.ts:846`
- Email comment says either manager or admin can approve and email is sent immediately: `Zuno-hr-India-Api/src/services/wfh.service.ts:933`

Issue:

The data model implies dual approval, but the actual behavior is single approval by either manager or admin.

Impact:

- Future developers may implement UI/reporting assuming two approvals are required.
- Admin and manager may both believe the other role still has a pending action.
- Audit fields are misleading.

Recommendation:

- Clarify the business policy.
- If single approval is intended, rename/remove dual-approval fields and update comments/UI.
- If dual approval is intended, keep status pending until both required approvals are recorded.
- Add tests around applied-on-behalf approval state transitions.

## Async/Task Handling Assessment

Current behavior:

- Request creation emails are synchronous and can fail after DB writes.
- Approval employee/admin notification emails are synchronous but caught.
- WFH allotment notifications are synchronous through `LeaveSummaryService`.
- Permission allotment does not notify employees.
- There is no queue, outbox table/collection, retry worker, idempotency key, or notification status ledger for WFH/Permission.

Recommended target:

1. Persist the core business state inside a transaction where multiple collections are touched.
2. Add notification/job records after commit.
3. Return API success based on durable business state, not email delivery.
4. Let a worker send email asynchronously with retry/backoff.
5. Expose notification status to admin for failed jobs.
6. Use idempotency keys for create/status/allotment APIs to avoid duplicate actions on retry.

## Recommended Fix Order

1. P0: Lock down status endpoints, request detail/list routes, applied-to routes, summary read routes, and allotment mutation routes with backend authorization.
2. P0/P1: Add service-layer authorization tests for employee, manager, admin, superadmin, applicant, assigned approver, and unrelated user.
3. P1: Move request creation and status + summary updates into transactions or make summaries fully derived/rebuildable.
4. P1: Move request/allotment emails to async outbox/job handling.
5. P1: Decide payroll meaning for WFH and Permission, then integrate approved WFH/Permission with attendance/payroll consistently.
6. P1: Add backend WFH calculation preview and use it in employee/admin forms.
7. P1: Fix approver derivation/validation and invalid-manager persistence behavior.
8. P1: Resolve WFH summary source-of-truth.
9. P1/P2: Add conflict checks and cross-year handling.
10. P2: Optimize list queries and remove misleading hardcoded Permission defaults.

## Module Verdict

WFH and Permission cover the visible request workflow, and WFH has a good backend working-day calculation foundation. However, the module is not ready for production payroll-sensitive use without backend authorization fixes, transaction/consistency fixes, and clear attendance/payroll integration. The highest-risk gaps are unauthorized approval/allotment mutation, stale summary risk, synchronous email side effects, and WFH/Permission not being consistently reflected in payroll-facing attendance.

