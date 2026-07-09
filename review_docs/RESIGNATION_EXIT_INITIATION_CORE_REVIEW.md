# Resignation / Exit Initiation - Core Review

## Module Scope

This review covers the core Resignation / Exit Initiation flow:

- Employee resignation submission.
- Employee resignation withdrawal.
- Employee resignation status display.
- Manager/admin resignation request listing.
- Manager/admin approval and rejection.
- Resignation notification emails.
- Resignation handoff into payroll and Final Settlement / F&F.
- Exit-state fields that affect payroll, salary statements, and employee lifecycle.
- Frontend state, validation, and role-based UX for the resignation flow.
- Async/task handling for resignation emails and exit workflow side effects.

Deferred/non-core areas for later review:

- Full employee profile editing UX.
- Broad dashboard analytics around resignation counts.
- Generic employee import/migration behavior except where separation fields affect this flow.
- Deep F&F calculation review, already covered separately.
- Minor visual redesign of cards, buttons, and empty states.
- Organization-wide RBAC refactor outside the APIs used by this module.

## Confidence

These findings are based on direct source-code review across backend resignation routes, user service/model, authentication context, frontend resignation components, frontend API service, payroll status filters, salary statement logic, and Final Settlement initialization/confirmation paths.

No runtime API tests were executed for this module during this pass. The issues below are code-level confirmed, but release validation should still include seeded-role API tests, concurrent request tests, and email failure simulations.

## Priority Legend

- P0: Critical security, data integrity, or user-facing state corruption issue.
- P1: Core resignation, approval, payroll, or F&F flow can produce incorrect state.
- P2: Important reliability, UX, scalability, or maintainability issue.
- P3: Cleanup or deferred improvement.

## Core Flow Summary

1. Employee opens the resignation self-service portal.
2. Frontend calls `GET /users-resignations/:userId/status`.
3. Backend checks pending or approved resignations in `User.resignations`.
4. If no active resignation exists, employee submits reason and proposed last working day.
5. Frontend posts to `POST /users-resignations/:userId/submit`.
6. Backend appends a `Pending` resignation subdocument to the user.
7. Backend sends an HR email.
8. Manager/admin opens resignation request list.
9. Frontend calls either `GET /users-resignations/manager/:userId` or `GET /users-resignations/admin/:userId`.
10. Backend flattens user resignation subdocuments into request rows.
11. Manager/admin approves or rejects a pending resignation.
12. Approval stores notice period days, approved last working day, approver id, and approval timestamp.
13. Rejection stores remarks, approver id, and rejection timestamp.
14. Backend sends approval/rejection email to the employee.
15. Final Settlement later initializes from employee data and the latest resignation record.
16. F&F confirmation eventually marks the employee inactive.

## Applicable Roles Reviewed

- Employee/staff: submit own resignation, withdraw own pending resignation, view own status.
- Manager: view subordinate resignations, approve/reject subordinate requests.
- Admin/HR: view all resignations, approve/reject, initiate F&F.
- Payroll/finance user: indirectly affected through payroll filters and F&F handoff.
- Unrelated authenticated user: reviewed because several APIs accept arbitrary user ids in path params.

## Primary Files Reviewed

Backend:

- `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts`
- `Zuno-hr-India-Api/src/services/user.service.ts`
- `Zuno-hr-India-Api/src/models/user.model.ts`
- `Zuno-hr-India-Api/src/middleware/auth.ts`
- `Zuno-hr-India-Api/src/services/final-settlement.service.ts`
- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India-Api/src/services/salary-statement.service.ts`

Frontend:

- `Zuno-hr-India/src/lib/services/api/user-resignation.ts`
- `Zuno-hr-India/src/lib/types/userResignation.ts`
- `Zuno-hr-India/src/lib/components/employee/resignation/Resignation.svelte`
- `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte`
- `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte`
- `Zuno-hr-India/src/routes/admin/final-settlement/[id]/+page.svelte`

## Important API Endpoints

- `POST /users-resignations/:userId/submit`
- `PUT /users-resignations/:userId/withdraw`
- `PUT /users-resignations/:userId/approve`
- `PUT /users-resignations/:userId/reject`
- `GET /users-resignations/:userId/status`
- `GET /users-resignations/admin/:userId`
- `GET /users-resignations/manager/:userId`
- `GET /final-settlement/initialize/:employeeId`
- `POST /final-settlement/confirm/:employeeId`

## Positive Observations

- Resignation state is stored in a structured `resignations` subdocument array rather than only free-text employee fields.
- Service prevents a second active pending resignation.
- Service prevents applying again while an active approved resignation exists.
- Withdraw only allows an active pending resignation.
- Approval records approver id, approval timestamp, notice period days, and approved last working day.
- Rejection records rejection timestamp and approver id.
- Manager list is intended to filter by `managerId`.
- Admin list is intended to provide all resignation requests with status filtering.
- Frontend employee portal prevents normal UI submission without reason and proposed last working day.
- Frontend employee portal displays requested LWD, approved LWD, notice period, remarks, and reason.
- F&F initialization already knows how to consume resignation submitted date, approved LWD, and reason.

## Async and Task Handling Assessment

The current resignation flow performs notification emails synchronously inside user-facing API requests:

- Submit saves the resignation, then awaits HR email.
- Approval saves the approved state, then awaits employee email.
- Rejection saves the rejected state, then awaits employee email.

This is not safe for a core HR lifecycle flow. Email delivery is a side effect and should not determine whether the business action succeeds after the database state has already changed.

Recommended async model:

- Persist resignation state first using an atomic/conditional update.
- Write a notification job/outbox record in the same transaction when possible.
- Return success once business state and job intent are stored.
- Process emails in a worker with retry and delivery status.
- Track notification state such as `EmailPending`, `EmailSent`, `EmailFailed`.
- Make email jobs idempotent by resignation id and event type, for example `resignation.submitted`, `resignation.approved`, `resignation.rejected`.
- Add reconciliation for approved resignations missing F&F readiness state or payroll exit fields.

## Findings

### P0 - Normal Submit and Approval Can Save Data Then Return Failure

Evidence:

- Submit route schema accepts `preferredLastWorkingDay` as a date-time string: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:50`
- Frontend submits `preferredLastWorkingDay` as an ISO string: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:91`
- Service saves the user before sending email: `Zuno-hr-India-Api/src/services/user.service.ts:1331`
- Service then calls `.toDateString()` on `data.preferredLastWorkingDay`: `Zuno-hr-India-Api/src/services/user.service.ts:1338`
- Approval route schema accepts `approvedLastWorkingDay` as a date-time string: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:161`
- Frontend submits `approvedLastWorkingDay` as an ISO string: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:171`
- Service saves approval before sending email: `Zuno-hr-India-Api/src/services/user.service.ts:1414`
- Service then calls `.toDateString()` on `data.approvedLastWorkingDay`: `Zuno-hr-India-Api/src/services/user.service.ts:1422`

Issue:

JSON request bodies provide strings, not `Date` instances. Both submit and approve can persist the resignation state, then throw when email template data is prepared.

Impact:

- Employee can see "failed to submit" while the resignation was actually created.
- Manager/admin can see "failed to approve" while the resignation was actually approved.
- Users may retry and hit duplicate/pending/approved errors.
- HR/payroll state can change while the UI reports failure.
- Email may not be sent even though the business state changed.

Recommendation:

- Convert date strings to `Date` objects before validation and before save.
- Validate date parse success.
- Prepare email data before save only if still synchronous, or preferably enqueue async email after save.
- Return business success even if email job enqueue is the only notification side effect.
- Add tests for ISO string date payloads from the current frontend.

### P0 - Resignation APIs Trust Path User IDs Instead of Authenticated User

Evidence:

- Submit accepts `/:userId/submit`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:28`
- Withdraw accepts `/:userId/withdraw`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:104`
- Status accepts `/:userId/status`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:236`
- Approve accepts `/:userId/approve`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:139`
- Reject accepts `/:userId/reject`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:191`
- Auth middleware provides `request.user._id`: `Zuno-hr-India-Api/src/middleware/auth.ts:200`
- Routes pass path params to service for target user without ownership checks: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:88`

Issue:

The API is authenticated, but core employee actions are not bound to the authenticated user's own id. Any logged-in user can potentially submit, withdraw, or view resignation status for another user by changing the path id.

Impact:

- A user can submit a resignation on behalf of another employee.
- A user can withdraw another employee's pending resignation.
- A user can read another employee's resignation reason, remarks, LWD, and status.
- Inactive or unrelated target employee records can be mutated.

Recommendation:

- For employee self-service endpoints, derive `userId` from `request.user._id`.
- If apply-on-behalf is needed, create separate admin-only endpoints with audit logging.
- Return `403` when path id does not match authenticated user for self-service APIs.
- Add API tests for employee A attempting employee B submit/withdraw/status.

### P0 - Approve and Reject Do Not Enforce Manager/Admin Authorization

Evidence:

- Approve route comment says Manager/Admin only, but only `authenticate` is attached: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:134`
- Reject route comment says Manager/Admin only, but only `authenticate` is attached: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:186`
- `approveResignation` does not verify approver role or target employee relationship: `Zuno-hr-India-Api/src/services/user.service.ts:1375`
- `rejectResignation` does not verify approver role or target employee relationship: `Zuno-hr-India-Api/src/services/user.service.ts:1440`

Issue:

Any authenticated user can potentially approve or reject any pending resignation if they know the employee id.

Impact:

- Unauthorized approvals can trigger exit process.
- Unauthorized rejections can block an employee's valid resignation.
- Audit trail records the wrong user as approver but does not prove they had authority.
- Payroll/F&F can consume unauthorized approval state.

Recommendation:

- Enforce route/service authorization using `request.user`.
- Allow admin/HR roles to approve all.
- Allow managers to approve only direct or configured subordinate resignations.
- Block self-approval unless a separately audited superadmin override exists.
- Add tests for staff, unrelated manager, direct manager, admin, and self-approval cases.

### P0 - Admin and Manager List Endpoints Can Be Spoofed by URL User ID

Evidence:

- Admin list accepts `/admin/:userId`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:273`
- Manager list accepts `/manager/:userId`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:317`
- Admin service verifies the role of the URL user id: `Zuno-hr-India-Api/src/services/user.service.ts:1568`
- Manager service verifies the role of the URL user id: `Zuno-hr-India-Api/src/services/user.service.ts:1642`
- Authenticated user identity is available on `request.user`, but not used for these checks: `Zuno-hr-India-Api/src/middleware/auth.ts:200`

Issue:

The service validates whether the path user id belongs to an admin/manager, not whether the caller is that admin/manager.

Impact:

- A logged-in user who knows an admin id can potentially list all resignations.
- A logged-in user who knows a manager id can potentially list that manager's team resignations.
- Resignation reasons, emails, roles, joining dates, remarks, and LWD data can leak.

Recommendation:

- Remove `:userId` from list endpoints or ignore it.
- Use `request.user._id` and `request.user.role` for authorization.
- For manager list, derive `managerId` from the authenticated manager.
- For admin list, require authenticated role admin/HR.
- Return `403`, not `400`, for authorization failures.

### P1 - Email Failure Can Make Completed Business Actions Look Failed

Evidence:

- Submit awaits `emailService.sendEmail` after save: `Zuno-hr-India-Api/src/services/user.service.ts:1343`
- Approval awaits `emailService.sendEmail` after save: `Zuno-hr-India-Api/src/services/user.service.ts:1428`
- Rejection awaits `emailService.sendEmail` after save: `Zuno-hr-India-Api/src/services/user.service.ts:1472`
- Route catch blocks return failure for any thrown error: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:93`

Issue:

Notification delivery is coupled to the API response after database mutation.

Impact:

- SMTP/provider outage can produce false API failures.
- Users can retry actions that already succeeded.
- Duplicate attempts and support confusion are likely.
- There is no retry or delivery audit.

Recommendation:

- Move emails to a queue/outbox.
- Store notification events with retry count and last error.
- Keep resignation action response independent from email provider availability.
- Surface email delivery state to admins only if needed.

### P1 - Approved Resignation Does Not Update Payroll Exit Fields

Evidence:

- User model has `separationDate`: `Zuno-hr-India-Api/src/models/user.model.ts:396`
- User model has `employmentStatus`: `Zuno-hr-India-Api/src/models/user.model.ts:367`
- Approval only updates the resignation subdocument: `Zuno-hr-India-Api/src/services/user.service.ts:1406`
- Salary statement logic depends on `active` and `separationDate`: `Zuno-hr-India-Api/src/services/salary-statement.service.ts:335`
- Payroll filters classify resigned/on-hold employees from resignation subdocuments and root final settlement flags: `Zuno-hr-India-Api/src/services/payroll.service.ts:672`

Issue:

Approval stores approved LWD only inside `resignations`, but payroll and salary statement flows also rely on root lifecycle fields such as `separationDate`, `employmentStatus`, and `active`.

Impact:

- Approved leavers can continue appearing as normal active employees.
- Virtual salary statements may not prorate correctly by approved LWD.
- Payroll/F&F handoff depends on different source-of-truth fields.
- HR may need manual profile edits to keep payroll correct.

Recommendation:

- On approval, set a clear exit lifecycle state, for example `employmentStatus = Resigned` or `Notice Period`.
- Set `separationDate` to approved LWD, or create a scheduled transition if policy requires future effective change.
- Keep `active` true until actual exit or final settlement policy point, but make payroll aware of `separationDate`.
- Add reconciliation to find approved resignations where `separationDate` does not match approved LWD.

### P1 - Final Settlement Can Initialize from Non-Approved or Missing Resignation Data

Evidence:

- F&F initialization takes the latest resignation regardless of status: `Zuno-hr-India-Api/src/services/final-settlement.service.ts:701`
- If no resignation dates exist, it falls back to today: `Zuno-hr-India-Api/src/services/final-settlement.service.ts:713`
- It then fills `resignationSubmittedOn`, `leavingDate`, and `leavingReason`: `Zuno-hr-India-Api/src/services/final-settlement.service.ts:842`

Issue:

F&F initialization does not require an approved active resignation before creating settlement data.

Impact:

- F&F can be started for rejected, withdrawn, pending, or missing resignations.
- Notice period recovery and unpaid salary can be calculated from fallback today dates.
- HR may confirm an exit settlement without a valid approved resignation.

Recommendation:

- Require an active approved resignation for normal F&F initialization.
- Allow no-resignation/manual termination only through a separate admin-only reason-coded flow.
- Show a blocking validation message when resignation approval is missing.
- Store the resignation subdocument id used for F&F to avoid "latest array element" ambiguity.

### P1 - Final Settlement Confirmation Updates the Wrong Settlement Done Field

Evidence:

- Resignation subdocument contains `finalSettlementDone`: `Zuno-hr-India-Api/src/models/user.model.ts:475`
- F&F confirmation sets root `finalSettlementDone`: `Zuno-hr-India-Api/src/services/final-settlement.service.ts:2417`
- Payroll filter checks root `finalSettlementDone`: `Zuno-hr-India-Api/src/services/payroll.service.ts:695`
- Root `finalSettlementDone` is not defined in the reviewed `User` schema.

Issue:

The app has two different implied places for final settlement completion. The schema defines it inside `resignations`, while F&F confirmation and payroll status filtering use a root field.

Impact:

- Settlement done state may not persist as intended if Mongoose strips unknown root paths.
- The approved resignation may continue showing `finalSettlementDone: false`.
- Payroll "Resigned" filter can be wrong.
- Exit lifecycle reporting becomes inconsistent.

Recommendation:

- Decide the canonical field.
- If root-level settlement state is needed, add it explicitly to the `User` schema.
- Also update the active approved resignation subdocument when F&F is confirmed.
- Use a transaction for settlement confirmation, employee lifecycle update, and resignation subdocument update.

### P1 - Resignation Actions Are Not Atomic Under Concurrent Requests

Evidence:

- Submit loads user, checks existing resignations in memory, pushes a new subdocument, then saves: `Zuno-hr-India-Api/src/services/user.service.ts:1294`
- Withdraw loads user, finds pending resignation in memory, mutates, then saves: `Zuno-hr-India-Api/src/services/user.service.ts:1355`
- Approval and rejection load user, find pending resignation in memory, mutate, then save: `Zuno-hr-India-Api/src/services/user.service.ts:1384`

Issue:

Concurrent submit, approve, reject, or withdraw requests can race because state transitions are not conditional atomic updates.

Impact:

- Duplicate pending resignations can be created.
- Approve and reject can both run on the same resignation.
- Multiple emails can be sent for conflicting states.
- Last-write-wins behavior can hide the earlier transition.

Recommendation:

- Use conditional `findOneAndUpdate` with filters like active pending resignation id/status.
- Use Mongo transactions where multiple documents or side effects are involved.
- Add idempotency keys for approval/rejection.
- Store and operate on a resignation subdocument id rather than "first active pending" only.

### P1 - Backend Does Not Validate Core Resignation Dates and Reason Strongly Enough

Evidence:

- Submit schema requires only `summary`: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:43`
- Backend does not require `preferredLastWorkingDay`: `Zuno-hr-India-Api/src/services/user.service.ts:1319`
- Frontend enforces proposed LWD at least 7 days away: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:80`
- Backend approval validates approved LWD is future: `Zuno-hr-India-Api/src/services/user.service.ts:1398`
- Backend does not validate approved LWD against resignation submission date, employee notice policy, or preferred LWD.

Issue:

Important business rules are either frontend-only or missing.

Impact:

- Direct API calls can submit empty/whitespace/oversized reasons.
- Direct API calls can submit without a requested LWD.
- Approval can use an LWD that does not satisfy policy.
- Notice period recovery can be calculated from bad date inputs.

Recommendation:

- Trim and validate reason length server-side.
- Require and validate preferred LWD unless HR policy explicitly allows open-ended resignation.
- Validate approved LWD after submitted date.
- Validate notice period days against employee policy or require an audited override reason.
- Validate rejection remarks server-side.

### P1 - F&F and Payroll Exit Timing Are Not Explicitly Modeled

Evidence:

- Approval keeps employee active and only writes resignation subdocument: `Zuno-hr-India-Api/src/services/user.service.ts:1412`
- F&F confirmation later marks employee inactive: `Zuno-hr-India-Api/src/services/final-settlement.service.ts:2418`
- Salary statement includes inactive users only when `separationDate` falls in the month: `Zuno-hr-India-Api/src/services/salary-statement.service.ts:341`

Issue:

The lifecycle has no explicit state machine for `Pending Resignation`, `Notice Period`, `Exited Pending F&F`, `F&F Confirmed`, and `Inactive`.

Impact:

- Payroll can include or exclude employees inconsistently depending on when F&F is confirmed.
- Salary statements can miss an exited employee if `active` is false but `separationDate` is absent.
- HR cannot clearly see which employees are serving notice versus fully exited.

Recommendation:

- Introduce explicit lifecycle statuses.
- Set `separationDate` from approved LWD.
- Use scheduled/background tasks to move employees from notice period to exited on LWD.
- Keep payroll and salary statement filters aligned with lifecycle state.

### P2 - Frontend Validation Errors Are Computed But Not Displayed in Employee Submit Modal

Evidence:

- Employee submit sets `reasonError` and `lwdError`: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:70`
- Modal template does not render those error variables: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:318`
- Date input does not have `required`: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:340`

Issue:

The frontend blocks invalid submit attempts but does not show the calculated error messages.

Impact:

- Employee may click submit and see nothing happen.
- Required LWD failure can be unclear.
- This increases support friction for a sensitive employee action.

Recommendation:

- Render inline errors below reason and LWD fields.
- Add `required` to date input.
- Disable submit while invalid or show toast plus inline errors.

### P2 - Manager/Admin Approval UX Allows Invalid or Confusing States

Evidence:

- UI allows approved LWD minimum of today: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:478`
- Backend requires approved LWD to be future, not today: `Zuno-hr-India-Api/src/services/user.service.ts:1401`
- Modal title always says `Approve Resignation`: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:417`
- Catch block logs failure but does not show toast: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:195`

Issue:

The UI can guide managers/admins into values the backend rejects and does not clearly report failures.

Impact:

- Approval attempts can silently fail from the user's perspective.
- Reject modal can appear as an approve action.
- Managers/admins may retry or leave requests unresolved.

Recommendation:

- Align min date with backend rule.
- Show backend error messages via toast and inline modal errors.
- Use dynamic modal title and submit label for approve versus reject.
- Disable double-submit while action is in progress.

### P2 - Manager/Admin List Pagination Counts Users, Not Resignation Rows

Evidence:

- Admin service queries users with resignations and counts users: `Zuno-hr-India-Api/src/services/user.service.ts:1582`
- It then flattens resignation subdocuments into rows: `Zuno-hr-India-Api/src/services/user.service.ts:1592`
- Manager service follows the same pattern: `Zuno-hr-India-Api/src/services/user.service.ts:1658`

Issue:

Pagination is applied before flattening resignation rows.

Impact:

- `total`, `totalPages`, and page content can be wrong if employees have multiple resignation records.
- Some resignation records can appear on unexpected pages.
- Admin review queue may miss historical rows during paging.

Recommendation:

- Use an aggregation pipeline with `$unwind`, `$match`, `$sort`, `$skip`, `$limit`, and `$count`.
- Count resignation records, not users, for this list view.

### P2 - Manager/Admin List Defaults to One Item Per Page

Evidence:

- Frontend meta default uses `limit: 1`: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:64`

Issue:

The request queue displays one resignation per page by default.

Impact:

- Managers/admins need many page clicks for routine review.
- More API requests are required than necessary.
- Approval queue feels incomplete or slow.

Recommendation:

- Default to 10 or 20 rows per page.
- Add a page-size selector if needed.

### P2 - Auth Store Timing Can Prevent Manager/Admin Data From Loading

Evidence:

- `ResignationRequestsView` reads `let user = $auth.user` once: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:34`
- `loadResignationData` exits if `user?._id` is absent: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationRequestsView.svelte:78`

Issue:

If auth data is not available at component initialization, the manager/admin list can remain empty because `user` is not reactive.

Impact:

- Users may see an empty or stuck loading state depending on timing.
- Refreshes can behave differently from navigation.

Recommendation:

- Make `user` reactive from `$auth.user`.
- Trigger data load when the authenticated user becomes available.
- Guard against duplicate loads.

### P2 - Resignation Notifications Are Not Sent to the Actual Manager

Evidence:

- Submit email goes to `process.env.HR_EMAIL` or `hr@company.com`: `Zuno-hr-India-Api/src/services/user.service.ts:1332`
- User model has `managerId` and `managerName`: `Zuno-hr-India-Api/src/models/user.model.ts:261`

Issue:

The resignation submit notification does not derive and notify the reporting manager, even though the manager has a review queue.

Impact:

- Manager may not know a direct report resigned.
- Pending resignations can sit without review.
- HR-only notification may not match the approval workflow.

Recommendation:

- Notify reporting manager and HR/admin group through async notification jobs.
- If HR is the only approver, hide or change manager queue behavior accordingly.
- Store notification recipients for audit.

### P2 - Error Status Codes Do Not Distinguish Validation From Authorization

Evidence:

- Route catch blocks return `400` for all service errors: `Zuno-hr-India-Api/src/routes/user-resignation.routes.ts:93`
- Service throws authorization errors as generic `Error`: `Zuno-hr-India-Api/src/services/user.service.ts:1570`

Issue:

Unauthorized access and invalid input are both returned as bad requests.

Impact:

- Frontend cannot reliably handle access denied versus form validation.
- Security monitoring cannot easily detect authorization violations.
- API behavior is inconsistent with expected semantics.

Recommendation:

- Return `401` for unauthenticated, `403` for unauthorized, `400` for validation, `404` for missing target, and `409` for state conflicts.
- Use typed/domain errors or Fastify error helpers.

### P2 - No Audit Log for Sensitive Exit Decisions

Evidence:

- Approval records `approvedBy` and timestamp in the resignation subdocument: `Zuno-hr-India-Api/src/services/user.service.ts:1408`
- There is no separate audit event for submit/withdraw/approve/reject transitions in the reviewed resignation service.

Issue:

The module records limited final state but lacks append-only audit events.

Impact:

- Harder to investigate who changed what and from where.
- Concurrent or unauthorized transitions are harder to reconstruct.
- Exit decisions are sensitive HR events and need stronger traceability.

Recommendation:

- Add audit events for submit, withdraw, approve, reject, F&F initialized, F&F confirmed, and lifecycle status changes.
- Include actor id, target employee id, previous state, next state, timestamp, source IP/request id, and remarks.

### P3 - Minor Frontend Display Issues

Evidence:

- Reason tooltip uses `group-hover` but parent lacks `group`: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:240`
- HR contact email can render from missing `VITE_ADMIN_MAIL`: `Zuno-hr-India/src/lib/components/employee/resignation/ResignationPortal.svelte:19`

Issue:

Some non-blocking display details can reduce clarity.

Impact:

- Long reason/remark tooltip may not display as intended.
- Contact instruction can show blank/undefined HR email.

Recommendation:

- Add correct `group` class or use a standard tooltip component.
- Provide a fallback HR contact label or hide the line if config is missing.

## Recommended Fix Order

1. Fix date parsing before save/email for submit and approve.
2. Enforce authenticated-user ownership for self-service status/submit/withdraw.
3. Enforce manager/admin role and reporting relationship for approve/reject.
4. Replace admin/manager list path-id authorization with `request.user`.
5. Move resignation emails to an async queue/outbox.
6. Add atomic state transitions for submit, withdraw, approve, and reject.
7. Align approved resignation with lifecycle fields: `separationDate`, `employmentStatus`, and F&F readiness.
8. Require approved active resignation for normal F&F initialization.
9. Fix final settlement done field consistency between root user and resignation subdocument.
10. Improve frontend validation display and manager/admin error handling.

## Minimum Test Coverage Needed

- Employee can submit only own resignation.
- Employee cannot submit/withdraw/view another user's resignation.
- Staff cannot approve or reject any resignation.
- Manager can approve/reject only direct subordinate resignation.
- Manager cannot approve own resignation.
- Admin/HR can approve/reject according to configured role policy.
- Submit with ISO `preferredLastWorkingDay` succeeds and sends/enqueues email.
- Approval with ISO `approvedLastWorkingDay` succeeds and sends/enqueues email.
- Email provider failure does not flip successful business action into failed API response.
- Concurrent double submit creates only one active pending resignation.
- Concurrent approve/reject results in only one final transition.
- F&F initialization is blocked without active approved resignation.
- Approved resignation sets or reconciles payroll lifecycle fields.
- F&F confirmation marks the correct settlement done field(s).
- Manager/admin list pagination counts resignation records correctly.
- Frontend shows validation and API errors clearly.

## Suggested Core Flow Contract

The module should ideally follow this contract:

1. Employee resignation submission creates one active pending resignation owned by authenticated user.
2. Submission enqueues notifications to reporting manager and HR.
3. Manager/admin list is derived from authenticated actor only.
4. Approval/rejection requires role and reporting authority.
5. Approval converts resignation into notice-period/exit lifecycle state and stores approved LWD as the payroll source of truth.
6. F&F initialization requires an approved active resignation or an explicit admin-only termination/manual exit mode.
7. Final settlement confirmation updates settlement, resignation, employee lifecycle, payroll side effects, documents, and notifications in a consistent transaction/job workflow.
8. Emails and heavy downstream effects are retryable async jobs, not fragile synchronous side effects.

## Overall Status

The Resignation / Exit Initiation module has the visible pieces of the expected HR flow, but the current implementation is not production-safe for core HRMS use.

The main blockers are authorization, date handling after save, synchronous email side effects, missing lifecycle field synchronization, and weak F&F handoff validation. These should be fixed before relying on resignation approval as the source for payroll and final settlement.
