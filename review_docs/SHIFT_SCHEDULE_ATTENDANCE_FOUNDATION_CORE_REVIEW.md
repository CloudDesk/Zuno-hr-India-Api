# Shift, Schedule & Attendance Foundation - Core Review

## Module Scope

This review covers the core shift and attendance foundation flow:

- Shift setup and shift master maintenance.
- Shift assignment, update, delete, and current/upcoming/past shift retrieval.
- Employee shift-change request and approval flow.
- Biometric attendance swipe processing.
- Attendance record retrieval, admin attendance view, and Excel downloads.
- Bulk attendance upload and import processing.
- Holiday and weekend calendar dependency where it affects attendance/payroll.
- Raw timesheet submission/export where it depends on shift/weekend/holiday state.

Deferred/non-core areas for later review:

- Visual polish of individual screens.
- Non-critical console logging cleanup.
- Generic table styling and copy improvements.
- Full reporting/dashboard feature completeness outside payroll-facing attendance.

## Core Flow Summary

1. Admin/HR configures shift masters under `/shifts`.
2. Admin/HR assigns shifts to employees through shift assignment APIs.
3. Employees can request a future shift change through `/shift-changes`.
4. Managers/admins approve or reject shift-change requests.
5. Attendance swipes are recorded through `/attendance/swipe`, resolved against the active shift assignment, and stored as `AttendanceRecord`.
6. Admin/manager views pull attendance summaries from `/attendance/records`, `/attendance/records/all`, and `/attendance/admin/view`.
7. Bulk upload can create shift assignments and attendance records from Excel.
8. Holiday/weekend calendar assignments influence whether attendance is shown as holiday, restricted holiday, weekend, present, incomplete, or absent.
9. Timesheet entry/export runs separately but depends on user-specific shift/weekend/holiday context.

## Applicable Roles Reviewed

- Employee/staff: own shift visibility, shift-change request, attendance swipe, timesheet entry.
- Manager: subordinate attendance visibility, shift-change approvals, bulk attendance for manageable external users.
- Admin/superadmin/HR: shift setup, shift assignment, attendance admin view, bulk upload, holiday/weekend setup.
- External user: attendance upload/template flow appears to target external users specifically.
- Unauthenticated caller: reviewed because several attendance/timesheet endpoints are exposed without auth.

## Priority Legend

- P0: Critical security or destructive data integrity issue.
- P1: Core business flow can produce incorrect payroll/attendance/schedule state.
- P2: Important reliability, UX, or maintainability issue.
- P3: Cleanup or deferred improvement.

## Findings

### P0 - Raw Timesheet APIs Are Unauthenticated

Evidence:

- `Zuno-hr-India-Api/src/routes/timesheet.routes.ts:31`
- `Zuno-hr-India-Api/src/routes/timesheet.routes.ts:52`
- `Zuno-hr-India-Api/src/routes/timesheet.routes.ts:104`
- `Zuno-hr-India-Api/src/routes/timesheet.routes.ts:155`
- `Zuno-hr-India-Api/src/routes/timesheet.routes.ts:171`
- Registered globally at `Zuno-hr-India-Api/src/routes/index.ts:85`.

Issue:

The `/timesheet` route file registers create/update, range read, by-date read, delete, report, all, and generate endpoints without `authenticate`. There is no global auth wrapper in `app.ts`; route-level auth is required.

Impact:

- Anyone who can reach the API can create or overwrite timesheets for arbitrary users.
- Anyone can read all timesheets through `/timesheet/all`.
- Anyone can delete a timesheet by record id.
- Anyone can generate timesheet files for arbitrary users.
- Payroll/document flows can be polluted by unauthenticated data.

Recommendation:

- Add `authenticate` to all `/timesheet` endpoints.
- Enforce ownership for employee routes: caller can only access their own `userId`.
- Restrict `/all`, `/report`, and arbitrary user generation to admin/HR/authorized managers.
- Prefer the authenticated `/documents/timesheet/generate` flow or remove/deprecate the raw unauthenticated generator.

### P0 - Attendance Test/Utility Endpoints Are Exposed Without Authentication

Evidence:

- `/attendance/bulk-insert`: `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts:697`
- `/attendance/user-records`: `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts:723`
- `/attendance/bulk-delete`: `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts:754`

Issue:

Several attendance routes have no `onRequest: [authenticate]` or `preHandler: [authenticate]`. These include sample/bulk insert, arbitrary user record retrieval, and bulk deletion.

Impact:

- Attendance records can be generated or deleted without login.
- Arbitrary user attendance can be queried without authorization.
- Payroll/FNF workday inputs can be silently corrupted.

Recommendation:

- Remove development/test endpoints from production builds.
- If retained, protect with authentication, admin-only authorization, environment guard, and audit logging.
- For deletion, require role check, bounded date range, explicit reason, and soft-delete/audit trail where possible.

### P0 - Bulk Upload Cleanup Can Delete Core Collections Without Authentication

Evidence:

- `Zuno-hr-India-Api/src/routes/bulk-attendance-upload.routes.ts:516`
- Deletes via `Model.deleteMany(query)` at `Zuno-hr-India-Api/src/routes/bulk-attendance-upload.routes.ts:672`.

Issue:

`DELETE /bulk-upload/cleanup` is marked "Development/Testing only" but has no authentication or role guard. It supports deleting `attendancerecords`, `leaves`, `shiftassignments`, `attendanceregularizations`, and `documents`.

Impact:

- A caller can delete attendance, leave, shift assignment, regularization, or document records with `?confirm=true`.
- If `collection=documents` is used without `userId`, the query can be broad.
- This is a direct production data loss risk.

Recommendation:

- Remove this route from production.
- Add environment guard such as `NODE_ENV !== 'production'`.
- Add `authenticate`, superadmin-only authorization, audit logging, and irreversible-operation confirmation if retained.

### P0/P1 - Shift Mutation APIs Are Authenticated But Not Role-Restricted

Evidence:

- Create shift: `Zuno-hr-India-Api/src/routes/shift.routes.ts:110`
- Update shift: `Zuno-hr-India-Api/src/routes/shift.routes.ts:231`
- Assign shift: `Zuno-hr-India-Api/src/routes/shift.routes.ts:307`
- Update assignment: `Zuno-hr-India-Api/src/routes/shift.routes.ts:598`
- Delete assignment: `Zuno-hr-India-Api/src/routes/shift.routes.ts:681`

Issue:

These routes require a login, but they do not check whether the caller is admin, HR, or otherwise authorized.

Impact:

- Any logged-in employee can potentially create shifts.
- Any logged-in employee can assign shifts to users.
- Any logged-in employee can modify or delete shift assignments.
- Attendance and payroll calculations can be altered at the schedule foundation.

Recommendation:

- Add explicit role/permission middleware for shift master and assignment mutations.
- Require admin/HR/superadmin for shift master changes.
- Require scoped manager/admin permissions for assignment changes.
- Add audit logs for all shift assignment mutations.

### P1 - Shift Read APIs Can Expose Other Employees' Shift Details

Evidence:

- Current shift by arbitrary user: `Zuno-hr-India-Api/src/routes/shift.routes.ts:403`
- Upcoming shifts by arbitrary user: `Zuno-hr-India-Api/src/routes/shift.routes.ts:477`
- Past shifts by arbitrary user: `Zuno-hr-India-Api/src/routes/shift.routes.ts:523`

Issue:

Authenticated users can request shift data for any `userId`; no ownership or manager/admin scope check is applied.

Impact:

- Employee schedules can be disclosed to unrelated users.
- Future/past shift history can be used to infer work timings and availability.

Recommendation:

- Allow employees to read only their own shift data.
- Allow managers to read only direct/reporting subordinates.
- Allow admin/HR/superadmin broader access.

### P1 - Shift Assignment Is Not Transaction-Safe

Evidence:

- `insertMany` happens before user joining-date validation: `Zuno-hr-India-Api/src/services/shift.service.ts:442`
- Joining-date validation happens later: `Zuno-hr-India-Api/src/services/shift.service.ts:458`
- User updates and shift recalculation happen after the insert.

Issue:

`bulkAssignShift` writes `ShiftAssignment` rows first, then validates users, sends emails, updates user snapshots, and recalculates assignment status. There is no transaction spanning these changes.

Impact:

- A validation failure after insert can leave shift assignments in DB.
- Email failure can fail the request after DB writes.
- User `currentShiftAssignmentData` and `upcomingShiftAssignmentData` can become stale or inconsistent with `ShiftAssignment`.

Recommendation:

- Validate all users, dates, overlaps, joining dates, and permissions before writing.
- Use MongoDB transactions for assignment records plus user snapshot updates.
- Move notification sending to a post-commit async job/outbox.

### P1 - Shift Assignment Emails Are Synchronous and Can Break Core Requests

Evidence:

- New assignment email is awaited inline: `Zuno-hr-India-Api/src/services/shift.service.ts:484`
- `emailService.sendEmail` throws on failure.
- Shift update references `shiftUpdateEmail`: `Zuno-hr-India-Api/src/services/shift.service.ts:854`
- Only `shiftAssignmentEmail.hbs` exists under `Zuno-hr-India-Api/src/emails/templates`.

Issue:

Shift assignment and update notifications are sent inside the request-response transaction flow. One update path references a missing template, so rendering can throw.

Impact:

- Assignment/update API can fail because email/template failed.
- DB writes may already be committed before email failure.
- Admin sees failure even though schedule data may have partially changed.

Recommendation:

- Create an email outbox/job table.
- Persist notification intent after successful transaction commit.
- Send emails asynchronously with retries.
- Add missing `shiftUpdateEmail.hbs` or use a shared existing template.

### P1 - Shift Overlap Protection Is Incomplete and Bypassed by Bulk Insert

Evidence:

- Overlap hook checks same `shiftCode` and `status: current`: `Zuno-hr-India-Api/src/models/shift.model.ts:244`
- It calls `next(error)` and then `next()` again: `Zuno-hr-India-Api/src/models/shift.model.ts:273`
- Bulk assignment uses `insertMany`: `Zuno-hr-India-Api/src/services/shift.service.ts:442`

Issue:

The pre-save overlap check only detects overlaps for the same shift code and current status. It misses overlapping different shifts and upcoming assignments. `insertMany` does not rely on `pre('save')`, so bulk assignment can bypass this check.

Impact:

- Users can receive overlapping current/upcoming assignments.
- Swipe processing chooses one applicable assignment unpredictably.
- Attendance and payroll results may be based on the wrong shift.

Recommendation:

- Enforce user/date overlap at service level before insert/update.
- Use a broader query independent of `shiftCode` and `status`.
- Add a DB-level strategy where possible, or transactional conflict checks.
- Fix the double `next()` issue in the hook.

### P1 - Bulk Assign Mixed Add/Remove Flow Can Break Mapping

Evidence:

- Operations array may contain remove operation before insert operation.
- Later mapping assumes `resultdata[0]` is inserted assignment array: `Zuno-hr-India-Api/src/services/shift.service.ts:512`.

Issue:

If a request includes both `removeUserIds` and `addUserIds`, `resultdata[0]` may be the update result from removal, not the inserted assignment array.

Impact:

- `.map` can fail.
- Assignments may already be inserted while user snapshot updates fail.

Recommendation:

- Separate remove and add results clearly.
- Do not depend on positional `Promise.all` results for different operation types.
- Wrap the whole operation in a transaction.

### P1 - Shift-Change Approval Can Be Approved Without Applying the Schedule Change

Evidence:

- Request status is set and saved before applying the approved shift change: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1121`
- Schedule update is applied after save: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1143`
- Assignment creation occurs in `applyApprovedShiftChange`: `Zuno-hr-India-Api/src/services/shift-change.service.ts:1372`

Issue:

The request is saved as approved before the shift assignment update/create succeeds. No transaction connects the request state and schedule mutation.

Impact:

- Shift-change request can show `Approved`.
- Employee schedule may remain unchanged if assignment update fails.
- Manager/admin may assume the change is live when it is not.

Recommendation:

- Use a transaction for request status plus assignment changes.
- Save approval only after assignment mutation succeeds.
- Add `applicationStatus` or job status if approval is intended to schedule async application.

### P1 - Shift-Change Applied-To Listing Allows Arbitrary Approver Query

Evidence:

- Applied-to route reads `appliedTo` from params: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:307`
- It calls service without checking caller is the approver/admin: `Zuno-hr-India-Api/src/routes/shift-change.routes.ts:325`

Issue:

`GET /shift-changes/applied-to/:appliedTo` is authenticated but does not authorize the caller against the `appliedTo` id.

Impact:

- A logged-in user can potentially list shift-change requests assigned to any manager/admin id.
- Employee names, reasons, requested shifts, and statuses may be exposed.

Recommendation:

- Require current user id to match `appliedTo`, or require admin/superadmin.
- Reuse the stricter authorization logic used in the single-record route.

### P1 - Admin Attendance View Is Not Admin-Only

Evidence:

- Admin view route only authenticates: `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts:885`
- Download route also only authenticates: `Zuno-hr-India-Api/src/routes/biometric-attendance.routes.ts:1018`

Issue:

The route name and response are admin-scoped, but the route only checks login.

Impact:

- Any logged-in user may access all users' attendance calendar.
- Excel export can leak organization-wide attendance records.

Recommendation:

- Restrict to admin/superadmin/HR.
- If managers need access, filter to subordinate users.
- Add audit logs for downloads.

### P1 - Holiday Handling Is Inconsistent Between Swipe Processing and Admin Attendance View

Evidence:

- Swipe processor checks only `HolidayCalendar.assignedTo`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:103`
- Admin attendance view uses user `holidayCalendarId` and `holidayCalendarHistory`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:2214`

Issue:

The same user/date can be treated differently during live swipe processing versus admin attendance/payroll view.

Impact:

- Swipe may record a working-day attendance while admin view later labels the date as holiday.
- Mandatory/optional holiday treatment can diverge.
- Payroll/FNF workday counts can become inconsistent.

Recommendation:

- Centralize holiday resolution into one service method.
- Use the same source of truth in swipe processing, admin view, Excel export, regularization, and timesheet.
- Include `holidayCalendarHistory` and `holidayCalendarId` in swipe holiday resolution.

### P1 - Half-Day Leave Preservation Query Uses Wrong Field

Evidence:

- Attendance processing queries `Leave.findOne({ shiftDay: record.shiftDay })`: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:655`
- Leave model uses `startDate` and `endDate`, not `shiftDay`.

Issue:

The logic meant to preserve `On-Leave` for half-day leave after swipes will not find approved half-day leave records.

Impact:

- Half-day leave plus attendance can be mislabeled.
- Admin attendance grid can show incorrect present/incomplete leave combinations.
- Payroll half-day treatment can be wrong.

Recommendation:

- Query leave by `startDate <= record.shiftDay` and `endDate >= record.shiftDay`.
- Normalize dates to UTC day boundaries.
- Add tests for first-half and second-half leave with swipes before and after leave approval.

### P1 - Swipe Assignment Lookup Is Non-Deterministic When Assignments Overlap

Evidence:

- `findOne` searches applicable active assignments without sorting: `Zuno-hr-India-Api/src/services/biometric-attendance.service.ts:231`

Issue:

If multiple assignments overlap, swipe processing picks whichever MongoDB returns first.

Impact:

- Attendance can be attached to the wrong shift code/window.
- Late/early calculations can be wrong.
- Regularization and payroll work hours can be wrong.

Recommendation:

- Prevent overlaps at assignment write time.
- Add deterministic sorting as defense in depth, for example latest `startDate` descending.
- Log and flag overlapping assignment anomalies.

### P1 - Bulk Attendance Upload Is Synchronous and Non-Transactional

Evidence:

- Confirm processing loops by user and group: `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts:584`
- Shift assignments are handled before attendance insert: `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts:694`
- Attendance insert happens later through `insertMany`: `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts:1242`

Issue:

Bulk import performs shift assignment mutation, attendance creation, and overtime creation inline without one transaction or background job.

Impact:

- Shift assignments may be changed even if attendance insert later fails.
- Partial success is possible without a durable upload job state.
- Large files can block request threads and time out.

Recommendation:

- Convert confirm to a background job with upload id/status.
- Validate synchronously, then enqueue processing.
- Use transactions per user or per upload batch.
- Provide retry and rollback/compensation strategy.

### P1 - Bulk Upload Writes Incorrect AttendanceRecord Shape

Evidence:

- `shiftId` is set to `shiftAssignmentId`: `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts:1207`
- `swipes.location` is a string: `Zuno-hr-India-Api/src/services/bulk-attendance-upload.service.ts:1083`
- Attendance schema expects `shiftId` to reference `Shift` and location to be an object.

Issue:

Bulk-created attendance records do not match the same shape as live swipe-created records.

Impact:

- Population/query behavior can break for `shiftId`.
- UI or reports expecting a location object can behave inconsistently.
- Data quality differs by ingestion source.

Recommendation:

- Store `shift._id` in `AttendanceRecord.shiftId`.
- Add separate `shiftAssignmentId` field if assignment traceability is needed.
- Convert location strings into the expected location object.
- Add import tests comparing live-swipe and bulk-upload record shape.

### P1 - Holiday and Weekend Calendar Mutation APIs Lack Role Guards

Evidence:

- Holiday create: `Zuno-hr-India-Api/src/routes/holiday-calendar.routes.ts:54`
- Holiday assign: `Zuno-hr-India-Api/src/routes/holiday-calendar.routes.ts:362`
- Weekend create/update: `Zuno-hr-India-Api/src/routes/weekend-calendar.routes.ts:34`
- Weekend assign: `Zuno-hr-India-Api/src/routes/weekend-calendar.routes.ts:145`

Issue:

Calendar mutation routes authenticate but do not restrict to admin/HR/superadmin.

Impact:

- Calendar assignments that affect attendance/payroll can be changed by unauthorized logged-in users.
- Weekend/holiday labels in admin attendance and timesheet can be manipulated.

Recommendation:

- Add role/permission middleware.
- Log calendar create/update/assign changes.
- Consider effective dating and versioning for payroll audit.

### P2 - Frontend Timesheet Submission Can Partially Save a Week

Evidence:

- Frontend loops one API call per day: `Zuno-hr-India/src/routes/my/timesheet/+page.svelte:291`

Issue:

If a weekly submit has multiple days and a later day fails, earlier days remain saved.

Impact:

- User sees generic failure but week may be partially submitted.
- Re-submit can overwrite or duplicate user expectations.

Recommendation:

- Add a bulk timesheet submit endpoint.
- Validate and persist the week atomically.
- Return per-day validation errors before writing.

### P2 - Bulk Upload Frontend Exposes Incomplete Backend Workflow

Evidence:

- Frontend exposes upload history/cancel/retry APIs: `Zuno-hr-India/src/lib/services/api/bulkAttendance.ts:116`
- Backend stats currently return placeholder zeros: `Zuno-hr-India-Api/src/routes/bulk-attendance-upload.routes.ts:500`

Issue:

The frontend API layer suggests an upload job/history model, but backend implementation is limited to template, parse, confirm, stats, and cleanup.

Impact:

- Operators cannot reliably track large upload status.
- Partial upload recovery is unclear.

Recommendation:

- Implement upload job records, status history, retry, cancel, and audit.
- Until implemented, hide unused frontend API paths.

## Async and Background Task Review

### Should Be Async/Task-Based

- Shift assignment notifications.
- Shift-change request notifications to approver/admin/employee.
- Bulk attendance import processing.
- Large attendance Excel/report generation.
- Timesheet Excel generation and document creation.

### Current State

- Shift assignment email is synchronous and can fail the request.
- Shift-change email is wrapped in try/catch and does not fail primary flow, which is better, but still runs inline.
- Bulk attendance upload processing is synchronous and non-transactional.
- Timesheet generation is synchronous.
- Admin attendance Excel generation is synchronous.

### Recommendation

Introduce a shared background job/outbox pattern:

- `notification_outbox` for emails.
- `bulk_upload_jobs` for attendance import.
- `report_generation_jobs` for attendance/timesheet exports.
- Job status values: `Pending`, `Processing`, `Completed`, `Failed`, `Retrying`.
- Store attempts, error message, actor id, createdAt, completedAt.
- Trigger emails and report generation only after DB transaction commit.

## Core Risk Ranking

1. Unauthenticated destructive/data APIs: immediate P0 fix.
2. Missing role guards on shift/calendar/admin attendance APIs: immediate P0/P1 fix.
3. Non-transactional shift assignment and shift-change approval: P1 fix before payroll reliance.
4. Attendance holiday/leave mismatch: P1 fix before payroll/FNF reliance.
5. Bulk upload data-shape and transaction issues: P1 fix before production import use.
6. Timesheet partial submit and raw endpoint exposure: P1/P2 depending on business reliance.

## Recommended Fix Order

1. Lock down unauthenticated routes and remove production cleanup/test endpoints.
2. Add role/permission middleware to shift, calendar, admin attendance, and timesheet admin routes.
3. Make shift assignment transactional and move emails to async jobs.
4. Fix overlap validation for shift assignments.
5. Make shift-change approval transactional.
6. Centralize holiday/weekend/leave resolution for attendance.
7. Fix half-day leave query and add coverage for half-day plus swipe scenarios.
8. Rework bulk attendance upload into a job with transactions and correct record shape.
9. Add bulk/atomic timesheet submission.

## Final Verdict

The module is functionally present but not production-safe for payroll-critical use yet. The main issue is not missing UI screens; it is backend authorization, transactional consistency, and async processing. The most urgent work is to secure exposed routes, enforce role scopes, and make shift/attendance mutations atomic before relying on these records for payroll, FNF, attendance regularization, or compliance reports.
