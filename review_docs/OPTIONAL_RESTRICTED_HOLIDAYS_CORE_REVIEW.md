# Optional / Restricted Holidays - Core Review

## Module Scope

This review covers the core Optional / Restricted Holiday flow:

- HR/admin restricted holiday allotment and release.
- Employee restricted holiday request submission.
- Manager/admin approval and rejection.
- Employee withdrawal/cancellation.
- Holiday calendar validation for optional holidays.
- Attendance behavior for approved restricted holidays and holiday swipes.
- Payroll treatment of approved restricted holidays.
- Notification and async/task handling for allotment, request creation, approval, and rejection.

Deferred/non-core areas for later review:

- Generic table/filter UI polish.
- Full copy/design cleanup for deprecated optional-holiday screens.
- Migration tooling for old optional holiday records beyond core consistency risks.
- Broad notification framework design beyond this module's async gaps.

## Core Flow Summary

1. Admin/HR releases restricted holiday entitlement through leave summary/release APIs.
2. Employee should apply for a restricted holiday through the unified Leave flow using `leaveType: restricted_holiday`.
3. The Leave service validates that the selected date is a single date, exists as an optional holiday in the employee's holiday calendar, and does not exceed the annual restricted holiday allocation.
4. The request is stored as a `Leave` record with `leaveType: restricted_holiday`.
5. Manager/admin approves or rejects the Leave request through the Leave status endpoint.
6. On approval, Leave service updates attendance records and payroll later counts approved `restricted_holiday` Leave records as paid leave.
7. Attendance views should show approved optional holidays as `RH`.
8. Payroll should count mandatory holidays separately and count approved restricted holidays through approved Leave records.

Important current-state note:

- A legacy `OptionalHolidayRequest` model, service, routes, API client, and detail pages still exist.
- Frontend list pages say the old module is deprecated and redirect to Leave, but the old APIs and detail/action pages remain reachable.
- This creates two competing sources of truth: `OptionalHolidayRequest` and `Leave.leaveType = restricted_holiday`.

## Applicable Roles Reviewed

- Employee/staff: request restricted holidays, view own requests, withdraw pending request.
- Manager: view assigned requests and approve/reject assigned requests.
- Admin/superadmin: view all requests, release restricted holiday allocation, approve/reject, apply on behalf through Leave.
- Unrelated authenticated user: reviewed because several endpoints rely only on authentication and accept arbitrary IDs.

## Priority Legend

- P0: Critical security or destructive data integrity issue.
- P1: Core business flow can produce incorrect attendance, payroll, approval, or balance state.
- P2: Important reliability, UX, scalability, or maintainability issue.
- P3: Cleanup or deferred improvement.

## Positive Observations

- The unified Leave flow has explicit `restricted_holiday` handling and enforces same start/end date.
- Leave restricted holiday validation checks `holidayCalendarHistory` for the target year before falling back to current calendar.
- Leave restricted holiday validation confirms the selected date is marked as `optional` in the holiday calendar.
- Payroll has been intentionally updated to count approved `restricted_holiday` Leave records as paid leave.
- Payroll counts only mandatory holidays in `holidayDays`, avoiding double count of restricted holidays when they are modeled as Leave.
- Attendance swipe processing checks both legacy `OptionalHolidayRequest` and unified `Leave.restricted_holiday` when deciding whether an optional holiday swipe should be treated as `Holiday-Swipe`.
- Frontend primary list pages for `/my/optional-holidays` and `/admin/optional-holidays` are marked deprecated and redirect users toward Leave pages.

## Findings

### P0 - Legacy Optional Holiday Status Endpoint Allows Unauthorized Approval/Rejection

Evidence:

- Status route only authenticates the request: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:220`
- Route passes the current user as `approvedBy` without checking admin/manager/applicant permissions: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:239`
- Service loads the request and updates status without caller scope validation: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:557`

Issue:

Any authenticated user who knows or guesses a pending optional holiday request id can approve, reject, or cancel the request through the legacy endpoint.

Impact:

- Unauthorized approval can affect attendance and leave summary.
- Unauthorized rejection/cancellation can deny employee entitlement.
- Audit fields will incorrectly show the attacking/authenticated user as the approver.

Recommendation:

- Either retire/disable the legacy `/optional-holidays` status endpoint or enforce backend authorization:
  - Admin/superadmin can approve/reject all.
  - Assigned approver can approve/reject only requests assigned to them.
  - Applicant can only cancel their own pending request.
- Return `403` for unauthorized status changes.
- Keep this logic in the service layer, not only the route.

### P0 - Unified Leave Status Endpoint Also Lacks Approval Scope for Normal Requests

Evidence:

- Leave status route only authenticates: `Zuno-hr-India-Api/src/routes/leave.routes.ts:647`
- Service computes `isAdmin` and `isManager`: `Zuno-hr-India-Api/src/services/leave.service.ts:1361`
- Normal approval branch directly sets status without enforcing `isAdmin` or `isManager`: `Zuno-hr-India-Api/src/services/leave.service.ts:1433`

Issue:

Restricted holidays are now handled as normal Leave records. In the normal approval path, any authenticated user can potentially approve/reject a pending restricted holiday Leave request if they know the id.

Impact:

- This affects the intended core RH flow, not only the deprecated optional-holiday module.
- Unauthorized changes can flow into attendance and payroll because payroll trusts approved `Leave.restricted_holiday`.

Recommendation:

- Enforce approval authorization before changing status:
  - Assigned manager or admin/superadmin can approve/reject.
  - Applicant cannot approve their own request unless explicitly allowed for admin self-service.
  - Applicant can cancel only through a dedicated owner-checked cancel path.

### P0 - Restricted Holiday Allotment and Release APIs Are Auth-Only

Evidence:

- Leave allotment route uses only `authenticate`: `Zuno-hr-India-Api/src/routes/leave-summary.routes.ts:412`
- Leave release route uses only `authenticate`: `Zuno-hr-India-Api/src/routes/leave-summary.routes.ts:569`
- Release service trusts the authenticated user as `releasedBy`: `Zuno-hr-India-Api/src/services/leave-release.service.ts:40`

Issue:

Any authenticated user may be able to update leave allotments or release restricted holiday balances for employees.

Impact:

- Users could increase their own or another employee's restricted holiday allocation.
- Payroll and attendance correctness can be compromised indirectly through unauthorized entitlement changes.

Recommendation:

- Restrict allotment and release endpoints to admin/superadmin.
- Add an audit event for entitlement changes.
- Validate employee country and leave type server-side before updates.

### P1 - Two Sources of Truth Exist for the Same Business Flow

Evidence:

- Legacy model exists: `Zuno-hr-India-Api/src/models/optional-holiday-request.model.ts:38`
- Legacy routes still registered and active: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:62`
- Payroll comment says optional holiday request import was removed and restricted holidays are handled via Leave: `Zuno-hr-India-Api/src/services/payroll.service.ts:13`
- Payroll counts approved `Leave` records with `leaveType` in `['annual', 'compOff', 'restricted_holiday']`: `Zuno-hr-India-Api/src/services/payroll.service.ts:2345`
- Deprecated frontend pages redirect list views to Leave: `Zuno-hr-India/src/routes/my/optional-holidays/+page.svelte:1`

Issue:

The app has both:

- `OptionalHolidayRequest` records from the legacy module.
- `Leave` records with `leaveType: restricted_holiday` from the unified Leave module.

Payroll only counts the unified Leave path. Some attendance code still reads the legacy path. Summary logic is split.

Impact:

- Approved legacy optional holidays may not be included correctly in payroll.
- Approved Leave restricted holidays may not appear in legacy optional-holiday summaries.
- Employees/managers can see different histories depending on which page/API is used.

Recommendation:

- Make `Leave.restricted_holiday` the only active core flow.
- Disable legacy creation and status APIs, or migrate legacy records into Leave.
- If legacy data must remain readable, expose it as read-only historical data.
- Remove user-facing links/action pages that can still mutate legacy records.

### P1 - Payroll Ignores Legacy Approved OptionalHolidayRequest Records

Evidence:

- Payroll states legacy optional holiday import was removed: `Zuno-hr-India-Api/src/services/payroll.service.ts:13`
- Approved paid leave count comes from `Leave` only: `Zuno-hr-India-Api/src/services/payroll.service.ts:2345`
- Legacy optional holiday approval email says the day will be counted as a holiday in payroll: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:691`

Issue:

When a legacy optional holiday request is approved, no `Leave.restricted_holiday` record is created. Payroll does not read `OptionalHolidayRequest`, so the approved holiday may not be paid/represented correctly.

Impact:

- Employee payroll can be wrong for days approved through the legacy endpoint.
- The notification promises behavior the payroll calculation may not honor.

Recommendation:

- Stop allowing legacy approvals, or mirror approved legacy records into Leave using a controlled migration.
- Update notification copy only after the underlying payroll path is correct.

### P1 - Attendance Display Is Inconsistent Across Paths

Evidence:

- Swipe processing checks both `OptionalHolidayRequest` and `Leave.restricted_holiday`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:381`
- Admin attendance view fetches approved leaves and builds restricted-holiday maps only from `Leave`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:2409`
- Restricted holiday map only tracks `leave.leaveType === 'restricted_holiday'`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:2446`
- Optional holiday display uses that map to set `isRestrictedHoliday`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:2583`

Issue:

One attendance path recognizes legacy approved optional holidays, while another only recognizes unified Leave restricted holidays.

Impact:

- Same employee/date can show as `Holiday-Swipe` in one flow but not show `RH` in admin attendance summary.
- Managers/admins can make payroll or attendance decisions from inconsistent displays.

Recommendation:

- Normalize attendance logic around one source of truth.
- If legacy data must be supported temporarily, all attendance aggregation/display paths should read the same compatibility layer.

### P1 - Leave Restricted Holiday Balance Is Deducted at Request Creation

Evidence:

- Leave creation calls `updateLeaveBalance` immediately after `Leave.create`: `Zuno-hr-India-Api/src/services/leave.service.ts:1219`
- Rejection/cancellation later calls `decreaseLeaveBalance`: `Zuno-hr-India-Api/src/services/leave.service.ts:1862`
- Comment confirms balance was increased even while pending: `Zuno-hr-India-Api/src/services/leave.service.ts:1856`

Issue:

Restricted holiday entitlement is consumed when a request is submitted, not when approved.

Impact:

- Pending requests reduce visible balance.
- If email/summary/other post-create steps fail, request and balance can drift.
- Managers may reject a request after the balance was already consumed, relying on reversal logic to succeed.

Recommendation:

- For restricted holidays, either:
  - reserve pending balance explicitly with a separate pending/reserved field, or
  - deduct only on approval.
- Keep `availed` strictly approved/taken, not pending.

### P1 - Annual Limit Checks Do Not Use a Unified Count

Evidence:

- Legacy optional-holiday limit counts only approved `OptionalHolidayRequest`: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:76`
- Leave restricted-holiday limit counts only approved `Leave` records: `Zuno-hr-India-Api/src/services/leave.service.ts:159`

Issue:

Each path checks only its own collection.

Impact:

- An employee could use legacy and Leave paths together to exceed annual restricted holiday allocation.
- Summaries can show different used/remaining values than approval checks.

Recommendation:

- Use one canonical source for allocation and usage.
- If legacy records are retained, centralize count logic into a single compatibility query during migration.

### P1 - Legacy Optional Holiday Approval Updates Summary Without Payroll/Leave Record

Evidence:

- Legacy approval saves `OptionalHolidayRequest` status: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:575`
- It updates leave summary `restricted_holiday.availed`: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:639`
- It does not create a `Leave` record.

Issue:

Legacy approval can make leave summary say RH was availed while payroll still sees no approved `Leave.restricted_holiday`.

Impact:

- Summary, attendance, and payroll can disagree.
- Employee balance may be reduced without the payroll-paid-leave path being activated.

Recommendation:

- Do not update `LeaveSummary.restricted_holiday` from legacy approval unless the canonical Leave record exists.
- Prefer migration or hard deprecation.

### P1 - Attendance Updates Are Not Transactional with Approval

Evidence:

- Legacy approval saves request first: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:594`
- Attendance update happens after request save: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:596`
- Leave approval saves status before later attendance updates: `Zuno-hr-India-Api/src/services/leave.service.ts:1457`
- Attendance upsert happens later per date: `Zuno-hr-India-Api/src/services/leave.service.ts:1764`

Issue:

Approval, summary update, and attendance update are not atomic.

Impact:

- Request can be approved while attendance update fails or partially succeeds.
- Payroll can later calculate from inconsistent attendance/leave state.

Recommendation:

- Use a Mongo transaction for status, summary, and attendance updates where possible.
- If transactions are not practical, make post-approval attendance reconciliation idempotent and retryable through a background job.

### P1 - Legacy Optional Holiday Validation Ignores Holiday Calendar History

Evidence:

- Legacy validation selects only `holidayCalendarId`: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:99`
- Unified Leave validation checks `holidayCalendarId holidayCalendarHistory`: `Zuno-hr-India-Api/src/services/leave.service.ts:97`

Issue:

Legacy optional holiday validation uses the employee's current calendar, not the calendar assigned for the requested year.

Impact:

- A request for a year with a different holiday calendar can be incorrectly allowed or blocked.
- Users can get different validation results between old optional-holiday and new Leave RH flows.

Recommendation:

- Retire the legacy flow.
- If kept temporarily, reuse the Leave holiday-calendar resolution logic.

### P1 - Client Can Influence Legacy Holiday Name

Evidence:

- Route accepts `holidayName` from request body: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:83`
- Service prefers `data.holidayName` before calendar name: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:429`

Issue:

The backend validates the date against the calendar but stores a client-provided holiday name when supplied.

Impact:

- Records, emails, and audit views can show a spoofed holiday name.

Recommendation:

- Always derive holiday name from the validated calendar entry.
- Treat client holiday name as display-only or ignore it.

### P1 - Applied-To Approver Can Be Supplied by Client

Evidence:

- Legacy create route accepts `body.appliedTo`: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:69`
- Leave create route accepts `body.appliedTo`: `Zuno-hr-India-Api/src/routes/leave.routes.ts:111`
- LeaveForm falls back to a hardcoded manager id/name if auth manager data is missing: `Zuno-hr-India/src/lib/components/leave/LeaveForm.svelte:199`

Issue:

Approver assignment is client-controlled in parts of the flow.

Impact:

- Requests may be routed to the wrong approver.
- A malicious client may assign an approver who should not own the request.

Recommendation:

- Derive approver server-side from the employee's manager/reporting configuration.
- Allow admin override only through an admin-only route with audit.
- Remove hardcoded manager fallback from production flow.

### P1 - Duplicate and Limit Checks Are Race-Prone

Evidence:

- Legacy duplicate check is a service-level `findOne`: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:439`
- Legacy model has non-unique `{ userId, holidayDate }` index: `Zuno-hr-India-Api/src/models/optional-holiday-request.model.ts:87`
- Leave restricted-holiday duplicate check is a service-level `findOne`: `Zuno-hr-India-Api/src/services/leave.service.ts:904`

Issue:

Duplicate and annual-limit checks are not protected by unique indexes or transactions.

Impact:

- Concurrent requests can create duplicate pending records for the same user/date.
- Concurrent approvals can exceed allocation.

Recommendation:

- Add a unique partial index for active restricted holiday requests by user/date/status where applicable.
- Recheck limits inside the same transaction as approval.

### P1 - Emails and Side Effects Are Awaited Inside API Requests Instead of Queued

Evidence:

- Legacy create saves request, then awaits manager email outside `try/catch`: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:472`
- Legacy manager email send is awaited directly: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:487`
- Leave create awaits manager email inside request flow: `Zuno-hr-India-Api/src/services/leave.service.ts:1237`
- Leave release loops employees sequentially and awaits email per employee: `Zuno-hr-India-Api/src/services/leave-release.service.ts:71`
- Leave release email send is awaited in the request: `Zuno-hr-India-Api/src/services/leave-release.service.ts:176`

Issue:

Email notifications are not handled through a background task/queue. Some are caught, but they still add latency. One legacy manager email can fail after DB save and cause the API to return failure even though the request exists.

Impact:

- Slow email provider slows HRMS APIs.
- Transient email failure can create confusing "failed but actually saved" behavior.
- Bulk release to many employees scales poorly.

Recommendation:

- Move emails to an async job queue with retry and dead-letter handling.
- Store notification jobs after the business transaction commits.
- API response should reflect business action success, not email delivery success.

### P1 - Leave Release Bulk Processing Is Sequential and Not Transactional

Evidence:

- `releaseLeaves` iterates employees one-by-one: `Zuno-hr-India-Api/src/services/leave-release.service.ts:71`
- It updates leave summary before creating release record: `Zuno-hr-India-Api/src/services/leave-release.service.ts:98`
- Release record is created after summary update: `Zuno-hr-India-Api/src/services/leave-release.service.ts:108`

Issue:

Leave release updates and release records are not atomic per employee. Bulk processing is sequential and mixes DB writes with emails.

Impact:

- Summary can be updated without a release audit record if release creation fails.
- Large quarterly/annual RH releases can be slow.
- Partial success is expected but not strongly recoverable.

Recommendation:

- Use a per-employee transaction for summary update + release record.
- Queue email after commit.
- Consider batch processing/background job for large releases.

### P1 - Legacy Request Detail Pages Remain Reachable

Evidence:

- My optional holiday detail page still mounts `OptionalHolidayDetails`: `Zuno-hr-India/src/routes/my/optional-holidays/[id]/+page.svelte:12`
- Admin optional holiday detail page still mounts actions: `Zuno-hr-India/src/routes/admin/optional-holidays/[id]/+page.svelte:12`
- Manager optional holiday detail page still mounts actions: `Zuno-hr-India/src/routes/manager/actions/optional-holidays/[id]/+page.svelte:12`
- Detail component calls legacy `updateStatus`: `Zuno-hr-India/src/lib/components/optionalHoliday/OptionalHolidayDetails.svelte:67`

Issue:

List pages redirect, but detail/action pages still expose legacy behavior when accessed directly.

Impact:

- Deprecated module can still mutate records.
- Users can reach old flows via saved links, emails, browser history, or guessed URLs.

Recommendation:

- Redirect legacy detail/action pages to equivalent Leave detail if a migrated Leave id exists.
- Otherwise render read-only historical view.
- Remove approve/reject/cancel calls to legacy endpoints from active UI.

### P1 - Arbitrary ID Reads Leak Optional Holiday Data

Evidence:

- Legacy list accepts arbitrary `userId` before role filtering: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:144`
- Legacy detail fetch has no owner/approver/admin scope check: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:186`
- Legacy summary accepts arbitrary `userId`: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:300`
- Legacy limit accepts arbitrary `userId`: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:346`
- Legacy applied-to endpoint accepts arbitrary `appliedTo`: `Zuno-hr-India-Api/src/routes/optional-holiday.routes.ts:392`

Issue:

Authenticated users can query optional holiday records, limits, and summaries for other users.

Impact:

- Employee leave/holiday data can be exposed across users.
- Manager queues can be enumerated by guessing `appliedTo` ids.

Recommendation:

- Enforce scope on every read:
  - Employee can read self.
  - Manager can read assigned requests.
  - Admin/superadmin can read all.
- Validate arbitrary `userId` filters only for admin/superadmin.

### P2 - Attendance Update Uses Exact Date Equality in Legacy Approval

Evidence:

- Legacy approval looks up attendance by exact `shiftDay: request.holidayDate`: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:598`

Issue:

If `shiftDay` is normalized differently from `holidayDate`, the attendance record may not be found.

Impact:

- Approved holiday with swipes may fail to become `Holiday-Swipe`.

Recommendation:

- Use start/end-of-day range matching or a shared date-normalization helper.
- Prefer the unified Leave attendance update logic.

### P2 - Legacy Optional Holiday Approval Does Not Create Attendance Record When No Swipe Exists

Evidence:

- Legacy approval updates attendance only if an existing record has swipes: `Zuno-hr-India-Api/src/services/optional-holiday.service.ts:603`

Issue:

An approved optional holiday with no swipe has no attendance record created by legacy approval.

Impact:

- Attendance summaries may not show RH consistently.
- Payroll/reporting can depend on whether another attendance process later creates/derives the day.

Recommendation:

- Do not use legacy approval for active RH.
- If retained, reconcile approved legacy RH into the same attendance representation as Leave RH.

### P2 - Deprecated UI Still Contains Hardcoded Limit Copy

Evidence:

- Legacy form defaults annual limit to `2` on API failure: `Zuno-hr-India/src/lib/components/optionalHoliday/OptionalHolidayRequestForm.svelte:162`
- UI displays `{limit.used} / 2 used`: `Zuno-hr-India/src/lib/components/optionalHoliday/OptionalHolidayRequestForm.svelte:286`

Issue:

The actual restricted holiday allocation is dynamic from leave summary, but deprecated UI hardcodes a fallback and display copy.

Impact:

- Users can see incorrect entitlement.
- If the old page is accessed directly or restored, it misleads users.

Recommendation:

- Remove active access to this form.
- If kept, display `limit.total`, not hardcoded `2`, and avoid optimistic fallback entitlement.

### P2 - Console Logging Is Excessive in Core Flows

Evidence:

- Leave create/status paths log request and user data: `Zuno-hr-India-Api/src/services/leave.service.ts:1211`
- Legacy optional holiday form logs calendar and holiday data: `Zuno-hr-India/src/lib/components/optionalHoliday/OptionalHolidayRequestForm.svelte:52`
- Route and services contain several debug `console.log` statements across approval/list flows.

Issue:

Debug logging in HR flows can expose personal data and make production logs noisy.

Impact:

- Privacy risk.
- Harder incident/debug analysis.

Recommendation:

- Replace noisy logs with structured logs at appropriate levels.
- Avoid logging full employee/request objects.

## Async / Task Handling Review

The module currently performs important side effects inline:

- Manager/admin/employee emails are awaited during request creation and approval.
- Leave release emails are awaited inside a per-employee loop.
- Attendance and leave summary updates happen after status changes and are not transactionally tied.

Expected behavior for core HRMS:

- Business action should commit first.
- Notification should be queued as a background job.
- Email sending should retry without blocking the user.
- Attendance/payroll-impacting reconciliation should be idempotent and retryable.
- Bulk release should create audit records and enqueue notifications without waiting on every email.

Highest-priority async fixes:

1. Queue emails for RH request created, approved, rejected, cancelled, and RH allocation released.
2. Use a transaction or idempotent background reconciliation for approval -> summary -> attendance updates.
3. Add retryable reconciliation for approved RH attendance display/payroll readiness.
4. Add monitoring for failed notification/reconciliation jobs.

## Recommended Fix Order

1. P0: Lock down Leave status endpoint authorization because this is the active restricted holiday flow.
2. P0: Lock down leave allotment and release APIs to admin/superadmin.
3. P0: Disable or protect legacy optional-holiday status endpoint.
4. P1: Decide canonical source of truth: `Leave.restricted_holiday`.
5. P1: Make legacy optional holiday records read-only or migrate them to Leave.
6. P1: Align payroll, attendance, summary, and request history around the canonical Leave record.
7. P1: Move email notifications and bulk release side effects to async jobs.
8. P1: Fix balance semantics so pending RH requests do not incorrectly appear as availed.
9. P1: Add transaction/idempotency around approval, summary, and attendance updates.
10. P2: Remove deprecated UI action routes and clean hardcoded limit/debug logging.

## Deferred Work

- Visual polish of Leave restricted holiday selection UI.
- Full redesign of historical optional holiday pages.
- Advanced reporting for migrated legacy RH records.
- Notification template copy refinement.
- Centralized RBAC middleware refactor across all modules.

## Overall Assessment

The intended direction is correct: restricted holidays should live in the unified Leave module as `leaveType: restricted_holiday`, and payroll already expects that. The main risk is that the old OptionalHolidayRequest module is only partially deprecated. Because it remains active at the API and detail-page level, the app can produce inconsistent approval, attendance, summary, and payroll behavior.

Before moving deeper into related modules, the core decision should be to make `Leave.restricted_holiday` the single source of truth, then lock down permissions and background side effects around that path.
