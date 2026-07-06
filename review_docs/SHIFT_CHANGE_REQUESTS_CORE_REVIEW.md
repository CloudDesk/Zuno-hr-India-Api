# Shift Change Requests - Core Review

## Module Scope

This review covers the core Shift Change Request flow:

- Employee shift change request submission.
- Manager/admin approval and rejection.
- Employee withdrawal/cancellation.
- Approved request application into `ShiftAssignment`.
- Current/upcoming/past shift state recalculation.
- Shift rollover cron behavior.
- Attendance-facing impact of shift assignment changes.
- Notification and async/task handling for request creation and approval.

Deferred/non-core areas for later review:

- Full shift setup/admin CRUD review.
- Generic shift assignment bulk editor review.
- Visual redesign of shift request tables/details.
- Broad RBAC middleware refactor beyond this module.
- Full attendance processor review outside shift assignment dependency points.

## Core Flow Summary

1. Employee opens Shift Change request form from `/my/shift-changes`.
2. Frontend loads current shift and available shifts.
3. Employee selects a requested shift, future effective date, reason, and submits.
4. Backend derives the authenticated employee as `userId`, finds the employee's current shift assignment, validates requested shift exists, validates future effective date, validates reason length, validates approver role, and creates a `ShiftChangeRequest`.
5. Backend emails the assigned approver and admins.
6. Manager/admin opens assigned request from manager actions or admin shift-change pages.
7. Backend status route checks whether the current user is admin/superadmin or assigned approver.
8. On approval, backend saves request as `Approved`, then creates a new `ShiftAssignment` starting on the effective date and shortens the previous assignment to the day before the effective date.
9. `recalculateUserShiftStatus` updates `User.currentShiftAssignmentData` and `User.upcomingShiftAssignmentData`.
10. Cron later promotes upcoming shift assignments to current when the date arrives.
11. Attendance processing uses shift assignments by date to decide shift timing, weekend days, attendance windows, and payroll-facing attendance state.

## Applicable Roles Reviewed

- Employee/staff: apply for shift change, view own requests, withdraw pending request.
- Manager: view assigned shift-change requests, approve/reject assigned requests.
- Admin/superadmin: view all shift-change requests, approve/reject, manage shifts and assignments.
- Unrelated authenticated user: reviewed because list and applied-to APIs accept arbitrary IDs.

## Priority Legend

- P0: Critical security or destructive data integrity issue.
- P1: Core business flow can produce incorrect attendance, payroll, approval, or shift assignment state.
- P2: Important reliability, UX, scalability, or maintainability issue.
- P3: Cleanup or deferred improvement.

## Positive Observations

- Request creation uses the authenticated user as `userId`; frontend cannot submit a request for another employee through the normal create API.
- Backend validates the employee has an active/current shift assignment before creating a request.
- Backend validates requested shift exists.
- Backend validates requested shift differs from current shift.
- Backend requires effective date to be in the future.
- Backend validates reason length.
- Detail read endpoint has an authorization check for applicant, assigned approver, admin, and superadmin.
- Status endpoint has route-level approval authorization, unlike several other request modules reviewed earlier.
- Employee cancellation is owner-checked in the service.
- Approval creates a future assignment and shortens the existing assignment to the day before effective date.
- There is a recalculation helper to correct current/upcoming/past shift assignment state.
- Notification failures are generally caught so email failure does not usually fail the business action.

## Findings

### P0 - Unauthenticated Dev Cron Endpoint Can Mutate Shift Assignment State

Evidence:

- Public route exists without `authenticate`: `Zuno-hr-India-Api/src/routes/index.ts:101`
- Route runs `updateShiftAssignmentStatuses`: `Zuno-hr-India-Api/src/routes/index.ts:102`
- The cron updater changes `ShiftAssignment` statuses and user shift assignment data: `Zuno-hr-India-Api/src/utilis/updateShiftAssignmentStatuses.ts:21`

Issue:

`GET /dev/run-shift-cron` is registered in normal routes and has no authentication or environment guard.

Impact:

- Anyone who can reach the API can trigger shift status transitions.
- This can mutate current/upcoming/past shift state outside normal HR/admin workflows.
- Attendance and payroll-facing shift logic can be affected.

Recommendation:

- Remove this endpoint from production routes.
- If needed for development, guard it with environment checks and admin/superadmin authentication.
- Prefer an internal job runner or protected admin maintenance endpoint with audit logging.

### P1 - Shift Change List Allows Arbitrary User Data Access

Evidence:

- List route accepts `userId` query param: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:158`
- If `userId` is provided, route applies it before role-based filtering: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:168`
- Service then queries by that `userId`: `Zuno-hr-India-Api/src/services/shift-change.service.ts:242`

Issue:

Any authenticated user can call `/shift-changes?userId=<otherUserId>` and bypass the regular employee/manager/admin filtering path.

Impact:

- Employees can view other employees' shift change requests.
- Request reasons, manager names, shift history, and status can leak.

Recommendation:

- Only allow `userId` filter for admin/superadmin.
- For regular employees, force `query.userId = currentUser._id`.
- For managers, allow only requests assigned to them unless admin role is present.

### P1 - Applied-To Queue Endpoint Allows Arbitrary Manager Queue Access

Evidence:

- Applied-to route accepts `:appliedTo` path param: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:216`
- Route passes arbitrary `appliedTo` into service query: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:314`
- Service filters directly on `appliedTo._id`: `Zuno-hr-India-Api/src/services/shift-change.service.ts:628`

Issue:

Any authenticated user can query `/shift-changes/applied-to/<managerId>` and view requests assigned to that manager.

Impact:

- Manager queues can be enumerated by guessing or collecting user IDs.
- Employee shift reasons and requested schedules can leak.

Recommendation:

- Enforce `appliedTo === currentUser._id` unless caller is admin/superadmin.
- Reject unauthorized requests with `403`.

### P1 - Client Can Choose the Approver

Evidence:

- Create route accepts `body.appliedTo`: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:86`
- Only if `appliedTo` is missing does route derive manager from employee: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:88`
- Service validates only that approver role is admin/manager/superadmin: `Zuno-hr-India-Api/src/services/shift-change.service.ts:92`

Issue:

The employee/client can choose any manager/admin/superadmin as approver.

Impact:

- Request can be routed to an unrelated approver.
- Employee may choose a manager more likely to approve.
- Approval responsibility and audit trail can be incorrect.

Recommendation:

- Derive approver server-side from employee reporting manager.
- Allow explicit approver override only through an admin-only apply-on-behalf/admin workflow.
- Store both derived approver and assignment source for audit.

### P1 - Manager Can Potentially Self-Approve Own Shift Change

Evidence:

- Approval route allows admin/superadmin or assigned approver with manager/admin role: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:426`
- Create route allows client-provided `appliedTo`: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:86`
- Service only validates approver role, not approver relationship to applicant: `Zuno-hr-India-Api/src/services/shift-change.service.ts:98`

Issue:

A manager user can submit a shift change with `appliedTo` set to themselves and then approve it, because backend approval does not block applicant and approver being the same user.

Impact:

- Self-approval bypasses expected manager/admin oversight.
- Shift changes can affect attendance windows and payroll-facing attendance logic.

Recommendation:

- Block self-approval unless caller is superadmin through an explicitly audited admin override.
- At creation, prevent assigning `appliedTo` to the applicant.

### P1 - Approval Saves Request Before Shift Assignment Update

Evidence:

- Service sets approved status and saves request: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1121`
- `request.save()` happens before applying assignment: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1140`
- Assignment update happens afterward: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1142`

Issue:

Approval status and shift-assignment mutation are not atomic.

Impact:

- Request can remain `Approved` even if assignment update fails.
- Employee receives approval status but shift may not actually change.
- Attendance processing can continue using the old shift.

Recommendation:

- Use a Mongo transaction for request status update, old assignment end-date update, new assignment creation, and user shift data recalculation.
- If transactions are not feasible, mark request as `Applying` first and finalize to `Approved` only after assignment update succeeds.
- Add retryable reconciliation for approved requests missing matching shift assignment.

### P1 - Approval Does Not Revalidate Current Shift State

Evidence:

- Request stores `currentShiftId` at creation: `Zuno-hr-India-Api/src/models/shift-change-request.model.ts:9`
- Approval applies change using stored `request.currentShiftId`: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1336`
- Current assignment is fetched by stored id, not by latest assignment active before effective date: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1338`

Issue:

If HR/admin changes the employee's shift assignment while the request is pending, approval can shorten an outdated assignment or create a new assignment from stale state.

Impact:

- Overlapping or broken shift histories can be created.
- Attendance can match the wrong shift on effective dates.
- Employee details page may show "current shift" that no longer reflects the real current assignment.

Recommendation:

- At approval time, re-fetch the employee's active/applicable assignment for the effective date.
- Reject approval if the base assignment changed materially since request creation, or require manager/admin to re-confirm.
- Store snapshot fields for display, but use live validated assignment for mutation.

### P1 - Effective-Date Rollover Can Happen Too Late

Evidence:

- Cron schedule is `59 23 * * *`: `Zuno-hr-India-Api/src/utilis/corn.ts:6`
- Cron promotes upcoming shifts whose `startDate <= todayEndUTC`: `Zuno-hr-India-Api/src/utilis/updateShiftAssignmentStatuses.ts:39`
- App timezone is set to UTC: `Zuno-hr-India-Api/src/app.ts:11`

Issue:

The cron runs at 23:59 UTC. A shift effective for the current day may remain `upcoming` for almost the whole effective date unless another recalculation path runs.

Impact:

- Employee current shift data may be stale on the actual effective day.
- UI and any logic relying on `status: current` can be wrong for that day.
- Attendance ingestion may still work if it queries assignment date ranges directly, but other current-shift views can be stale.

Recommendation:

- Run shift status rollover shortly after start of day in the business timezone, or multiple times daily.
- Prefer date-range based "effective assignment" lookups for attendance.
- Recalculate shift status when fetching current shift if status looks stale.

### P1 - Requested Shift Validation Does Not Check Active, Validity, or Role Applicability

Evidence:

- Service validates only that requested shift exists: `Zuno-hr-India-Api/src/services/shift-change.service.ts:65`
- Generic shift list supports filters like `isActive`, `role`, and `validOn`: `Zuno-hr-India-Api/src/services/shift.service.ts:114`
- Frontend request form calls `shiftsApi.list()` with no filters: `Zuno-hr-India/src/lib/components/shiftChange/ShiftChangeRequestForm.svelte:64`

Issue:

Employee can request any existing shift returned or submitted by ID, even if the shift is inactive, not valid on the effective date, or not applicable to the employee's role.

Impact:

- Invalid shift assignments can be created.
- Employee can move into a shift not meant for their role/location/policy.
- Attendance windows and weekend handling may become incorrect.

Recommendation:

- Backend should validate:
  - requested shift is active,
  - effective date is within `validFrom`/`validTill`,
  - employee role matches `applicableForRoles`,
  - shift is eligible for employee country/location if applicable.
- Frontend should request shifts with `isActive=true`, `role=<employeeRole>`, and `validOn=<effectiveDate>` once date is selected.

### P1 - Duplicate Protection Ignores Approved Future Requests

Evidence:

- Duplicate check only blocks pending request for same effective date: `Zuno-hr-India-Api/src/services/shift-change.service.ts:103`
- Model index is non-unique: `Zuno-hr-India-Api/src/models/shift-change-request.model.ts:108`

Issue:

Employee can have an approved future shift change and still submit another pending request for the same effective date or overlapping future period.

Impact:

- Multiple future assignments can be created for same effective date.
- Recalculation may choose one assignment unpredictably by start date sorting.
- Attendance can become hard to audit.

Recommendation:

- Block pending or approved shift-change requests for the same employee/effective date unless the earlier request is rejected/cancelled.
- Consider blocking overlapping future shift assignment ranges.
- Add a partial unique index or transactional check for active request states.

### P1 - New Assignment Inherits End Date from Old Assignment Without Conflict Review

Evidence:

- Old assignment original end date is stored: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1356`
- New assignment receives `endDate: originalEndDate || undefined`: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1378`

Issue:

When the old assignment had a finite end date, the new requested assignment inherits that same end date. This may be correct for one scenario, but it is not explicitly validated against other upcoming assignments or business policy.

Impact:

- Future assignment chain can become inconsistent.
- New assignment may unexpectedly end too soon or overlap with later assignments.

Recommendation:

- At approval, compute the target assignment window from the full assignment timeline.
- Validate no overlap with existing future assignments.
- Make expected behavior explicit: permanent shift change vs change only until old assignment end date.

### P1 - Shift Assignment Mutations Lack Idempotency

Evidence:

- Approval creates a new `ShiftAssignment`: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1373`
- No check exists for an assignment already created for this request/effective date before insert.
- Request model has no applied assignment id.

Issue:

If approval is retried after partial failure, duplicate shift assignments can be created.

Impact:

- Multiple active/upcoming assignments can exist for same user/date.
- Recalculate logic may clean some overlaps, but audit history remains messy.

Recommendation:

- Store `appliedShiftAssignmentId` or a request reference on the created `ShiftAssignment`.
- Before creating, check whether this request already created an assignment.
- Make approval idempotent.

### P1 - Generic Shift Management APIs Are Auth-Only

Evidence:

- Create shift route only authenticates: `Zuno-hr-India-Api/src/routes/shift.routes.ts:109`
- Update shift route only authenticates: `Zuno-hr-India-Api/src/routes/shift.routes.ts:230`
- Bulk assign route only authenticates: `Zuno-hr-India-Api/src/routes/shift.routes.ts:306`
- Update shift assignment route only authenticates: `Zuno-hr-India-Api/src/routes/shift.routes.ts:598`

Issue:

Although this review is focused on shift-change requests, the surrounding shift setup APIs directly affect the same core flow and appear to require only authentication.

Impact:

- Any authenticated user may be able to create/update shifts or assign users to shifts if no global hidden guard exists.
- Shift-change request validation can be bypassed by manipulating underlying shift setup.

Recommendation:

- Restrict shift CRUD and assignment APIs to admin/superadmin or HR admin roles.
- Add audit logs for shift definition and assignment changes.

### P1 - Shift Assignment Read APIs Allow Arbitrary User Shift History Reads

Evidence:

- Current shift route accepts arbitrary `userId`: `Zuno-hr-India-Api/src/routes/shift.routes.ts:402`
- Upcoming shift route accepts arbitrary `userId`: `Zuno-hr-India-Api/src/routes/shift.routes.ts:478`
- Past shift route accepts arbitrary `userId`: `Zuno-hr-India-Api/src/routes/shift.routes.ts:524`
- Date-range assignment route accepts arbitrary `userId`: `Zuno-hr-India-Api/src/routes/shift.routes.ts:754`

Issue:

Authenticated users can read other employees' current, upcoming, past, and date-range shift assignments.

Impact:

- Employee schedule data can leak.
- Shift-change pages use these APIs as fallbacks, increasing exposure.

Recommendation:

- Employee can read own shift assignments.
- Manager can read direct reports.
- Admin/superadmin can read all.
- Enforce scope in route/service layer.

### P2 - Email Notifications Are Awaited Inside Request Flow

Evidence:

- Create flow awaits approver email: `Zuno-hr-India-Api/src/services/shift-change.service.ts:150`
- Create flow awaits admin email: `Zuno-hr-India-Api/src/services/shift-change.service.ts:205`
- Status update awaits employee email: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1221`
- Status update awaits admin email: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1289`

Issue:

Email sends are caught, which is good, but they still happen synchronously during API calls.

Impact:

- API latency depends on email provider latency.
- Bulk admin notifications can slow approval path.
- Transient email issues are only logged and not retried.

Recommendation:

- Queue notifications after request creation/status commit.
- Add retries and failure tracking.
- Keep API response focused on business action result.

### P2 - Frontend Shift Form Shows Only Default First Page of Shifts

Evidence:

- Form calls `shiftsApi.list()` without limit/filter params: `Zuno-hr-India/src/lib/components/shiftChange/ShiftChangeRequestForm.svelte:64`
- API default limit is 10: `Zuno-hr-India-Api/src/services/shift.service.ts:115`

Issue:

If more than 10 shifts exist, employee may not see all valid choices.

Impact:

- Employee may be unable to request the intended shift.
- Users may assume a shift is unavailable when it is simply paginated out.

Recommendation:

- Add a dedicated eligible-shifts endpoint for shift-change requests.
- Or call list with suitable `limit`, `isActive`, `role`, and `validOn` filters.

### P2 - Frontend Fallback Fetch Uses Current Shift Instead of Historical Request Shift

Evidence:

- Details fallback for missing current shift calls `shiftsApi.current(requestData.userId)`: `Zuno-hr-India/src/lib/components/shiftChange/ShiftChangeRequestDetails.svelte:188`
- `currentShiftId` in request is a `ShiftAssignment` id, not current live shift id: `Zuno-hr-India-Api/src/models/shift-change-request.model.ts:9`

Issue:

If backend fails to populate current shift, frontend fallback can display the employee's current shift now, not the shift at request creation.

Impact:

- Detail page can misrepresent what shift the employee requested to change from.
- Manager/admin can approve based on misleading information.

Recommendation:

- Backend should always return snapshot/current-at-request shift data.
- Frontend should not use live current shift as fallback for historical request details.

### P2 - Manager Assigned Shift List Has Incorrect Fallback for Current Shift

Evidence:

- Manager list fallback calls `shiftsApi.getById(requestCopy.currentShiftId)`: `Zuno-hr-India/src/lib/components/managerActions/AssignedShiftChanges.svelte:304`
- `currentShiftId` is a `ShiftAssignment` id, not a `Shift` id.

Issue:

If backend does not populate current shift, manager list tries to fetch a Shift using a ShiftAssignment id.

Impact:

- Current shift can show `N/A` even when data exists.
- Extra failed API calls add noise and latency.

Recommendation:

- Remove incorrect fallback.
- Add a backend endpoint or populated field for assignment snapshot if needed.

### P2 - Excessive Debug Logging in Shift Flows

Evidence:

- Shift routes log request/params/user data in several endpoints: `Zuno-hr-India-Api/src/routes/shift.routes.ts:380`
- Shift service logs shift assignment state: `Zuno-hr-India-Api/src/services/shift.service.ts:157`
- Frontend shift request list logs request samples and populated shift details: `Zuno-hr-India/src/lib/components/shiftChange/ShiftChangeRequestList.svelte:254`
- Frontend details logs request and shift data: `Zuno-hr-India/src/lib/components/shiftChange/ShiftChangeRequestDetails.svelte:118`

Issue:

Production logs can expose employee schedules, emails, reasons, and shift history.

Impact:

- Privacy and operational noise.
- Harder incident/debug analysis.

Recommendation:

- Replace with structured logs where needed.
- Avoid logging full request/user objects.
- Remove frontend console debug logs.

## Async / Task Handling Review

The module currently performs these side effects inline:

- Request creation writes request, then sends approver/admin emails.
- Approval saves status, applies shift assignment changes, recalculates user shift status, then sends employee/admin emails.
- Cron performs daily shift status mutation.

Expected behavior for a core HRMS flow:

- Approval and assignment mutation should be atomic or idempotent.
- Notification should be queued after commit.
- Rollover should run at the correct start-of-business-day time and be retryable.
- Failed approval-side assignment application should be detectable and recoverable.

Highest-priority async/task fixes:

1. Make approved request -> assignment mutation transactional or idempotent.
2. Add reconciliation job for approved requests missing applied assignment.
3. Queue notification emails instead of awaiting them in API calls.
4. Protect and monitor shift rollover job.
5. Run rollover at a time that makes the effective date usable from the start of that date.

## Recommended Fix Order

1. P0: Remove or protect `/dev/run-shift-cron`.
2. P1: Lock down shift-change list and applied-to read scopes.
3. P1: Derive approver server-side and block self-approval.
4. P1: Revalidate current shift state at approval time.
5. P1: Make request approval and shift assignment mutation transactional/idempotent.
6. P1: Validate requested shift active status, validity, and role applicability.
7. P1: Prevent duplicate/overlapping pending or approved future requests.
8. P1: Restrict generic shift CRUD and shift assignment APIs to admin/superadmin/HR.
9. P1: Fix rollover schedule so upcoming shifts become current at the start of effective day.
10. P2: Move emails to async jobs.
11. P2: Fix frontend eligible-shift loading and incorrect fallback fetches.
12. P2: Remove noisy debug logs.

## Deferred Work

- Full UI polish for shift request detail/list pages.
- Better manager dashboard aggregation for upcoming effective shift changes.
- Dedicated audit trail view for assignment mutation caused by shift-change approval.
- Shift conflict visualization before approval.
- Full shift setup module review.

## Overall Assessment

The Shift Change module is stronger than several earlier request modules because the status endpoint has route-level authorization and employee cancellation is owner-checked. The biggest risks are data consistency and policy enforcement: client-chosen approvers, stale base shift assignment during approval, non-transactional assignment mutation, late rollover timing, and incomplete requested-shift eligibility validation.

Because shift assignments drive attendance windows and weekend logic, these issues can ripple into attendance correctness and payroll-facing attendance calculations. The module should be stabilized before relying on it for strict shift-based attendance policy.
