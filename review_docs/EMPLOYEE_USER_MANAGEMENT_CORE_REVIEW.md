# Employee/User Management - Core Flow Review

## Module

Employee/User Management

## Review Scope

This review focuses only on major functionality in the core HRMS flow:

- Employee creation and onboarding
- Employee profile/detail access
- Employee update and deactivation
- Manager/subordinate mapping
- Role and portal access behavior
- Payroll employee lookup dependency
- Current-user/profile bootstrap
- Employee list filtering and sorting

Items such as debug logging, minor UI polish, test notification routes, broad response cleanup, and non-blocking performance improvements are treated as deferred unless they directly affect the core employee flow.

## Confidence

These findings are based on direct source-code review across the frontend and backend. They are valid code-level gaps. Runtime testing is still recommended before release to confirm exact deployed behavior and user-facing impact.

## Core Flow Findings

### 1. Employee create/update/delete APIs are not role-protected

**Priority:** Core blocker  
**Area:** Backend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Employee creation, update, and delete routes only require authentication. They do not clearly enforce admin-only access. The update service accepts a broad payload and applies it directly to the user document, which means protected fields such as role, manager, active status, portal access, bank details, and employee classification can potentially be changed by a non-admin API caller.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/user.routes.ts`
- `Zuno-hr-India-Api/src/services/user.service.ts`

**Impact:**  
Unauthorized users could potentially create employees, deactivate users, edit employee records, change reporting structure, or alter role/portal-related data by bypassing the UI and calling APIs directly.

**Recommendation:**  
Add backend role middleware for employee write operations. Restrict create/delete to admin. For update, use role-based field allowlists:

- Admin: full employee update.
- Manager: only allowed team-level fields, if required by business.
- Staff: only self-editable profile fields.

---

### 2. Employee detail API can expose any employee by ID

**Priority:** High business/security risk  
**Area:** Backend + Frontend  
**Roles affected:** Manager, Staff

**Finding:**  
The employee detail endpoint fetches a user by ID without enforcing admin/self/manager-hierarchy scope. Manager and My Employees detail pages both call this raw ID endpoint directly.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/user.routes.ts`
- `Zuno-hr-India-Api/src/services/user.service.ts`
- `Zuno-hr-India/src/routes/manager/employees/[id]/+page.ts`
- `Zuno-hr-India/src/routes/my/employees/[id]/+page.ts`

**Impact:**  
A logged-in user may be able to access another employee's full profile by changing the URL or calling the API with another employee ID.

**Recommendation:**  
Create a scoped backend helper for employee access:

- Admin can access all employees.
- Manager can access recursive subordinates only.
- Staff can access only self, unless business rules allow assigned external users.

Use this helper for `GET /users/:id`, update routes, document/profile routes, and any employee-linked modules.

---

### 3. Payroll employee list endpoint exposes broad employee data

**Priority:** High business/security risk  
**Area:** Backend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The payroll employee list endpoint is authenticated but not clearly admin-restricted. It calls a payroll-focused user lookup that fetches broad user records without role scope or field selection.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/user.routes.ts`
- `Zuno-hr-India-Api/src/services/user.service.ts`
- `Zuno-hr-India/src/lib/services/api/employees.ts`

**Impact:**  
Unauthorized users may be able to access payroll-relevant employee lists and sensitive employee fields.

**Recommendation:**  
Restrict `/users/payroll` to admin/payroll-authorized roles only. Return a minimal field set required for payroll screens instead of full user documents.

---

### 4. Manager hierarchy is not fully validated on backend

**Priority:** Core blocker  
**Area:** Backend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The backend checks that `managerId` is present, but does not clearly validate whether the manager exists, is active, has an allowed role, is not the same employee, or would create a circular reporting chain.

**Evidence:**

- `Zuno-hr-India-Api/src/services/user.service.ts`
- `Zuno-hr-India-Api/src/models/user.model.ts`
- `Zuno-hr-India-Api/src/utilis/userHierarchy.ts`

**Impact:**  
Incorrect manager mapping can break approvals, manager dashboards, leave routing, attendance ownership, subordinate lists, and employee visibility.

**Recommendation:**  
Add backend hierarchy validation during employee create/update:

- Manager must exist and be active.
- Manager role must be valid for the employee role.
- Employee cannot report to self.
- Reporting change cannot create cycles.
- External employee mapping rules should be explicit.

---

### 5. Current-user API contract can corrupt frontend auth/profile state

**Priority:** Core flow issue  
**Area:** Frontend + Backend API contract  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The frontend expects the current-user call to return a single user object, but the backend `/users?my=true` flow returns the user inside an array.

**Evidence:**

- `Zuno-hr-India/src/lib/services/api/employees.ts`
- `Zuno-hr-India/src/routes/+layout.ts`
- `Zuno-hr-India-Api/src/routes/user.routes.ts`

**Impact:**  
After refresh, frontend auth/profile state can be populated with the wrong data shape. This can break role detection, profile display, sidebar decisions, and employee module behavior.

**Recommendation:**  
Add a dedicated `/auth/me` or `/users/me` endpoint that returns one sanitized user object. Update frontend bootstrap and profile flows to use it consistently.

---

### 6. New employees are onboarded with a universal default password

**Priority:** High business/security risk  
**Area:** Frontend + Backend  
**Roles affected:** Admin, New Employees

**Finding:**  
The frontend sets every newly created employee password to `123456`. The backend welcome email flow can include that default password.

**Evidence:**

- `Zuno-hr-India/src/lib/components/employee/EmployeeForm.svelte`
- `Zuno-hr-India-Api/src/services/user.service.ts`

**Impact:**  
All newly created portal users may share the same initial credential. This creates account takeover risk, especially if users do not immediately reset their password.

**Recommendation:**  
Replace default-password onboarding with one of these flows:

- Send invite/reset-password link.
- Generate a one-time random temporary password.
- Force password change on first login.

Do not use a universal static password.

---

### 7. Employee table sorting likely does not work correctly

**Priority:** Core UX issue  
**Area:** Frontend + Backend API contract  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Frontend employee list pages send `sortBy`, but the backend user list endpoint expects `sort`. Sortable columns are shown in the UI, but the selected sort field may not actually reach the backend.

**Evidence:**

- `Zuno-hr-India/src/routes/admin/employees/+page.ts`
- `Zuno-hr-India/src/routes/manager/employees/+page.ts`
- `Zuno-hr-India/src/routes/my/employees/+page.ts`
- `Zuno-hr-India-Api/src/routes/user.routes.ts`

**Impact:**  
Users may think employee lists are sorted by a selected column while backend results remain sorted by the default field. This affects admin/manager usability in larger employee lists.

**Recommendation:**  
Normalize the API contract. Either change frontend to send `sort`, or update backend to accept `sortBy` as an alias. Also whitelist allowed sort fields.

## Async, Tasks, and Side-Effect Findings

### A1. Employee welcome email is synchronous but failure is ignored

**Priority:** High business risk  
**Area:** Backend async/side effect  
**Roles affected:** Admin, New Employees

**Finding:**  
The employee creation flow saves the employee first, then awaits the welcome email. If email delivery fails, the error is logged and the API still succeeds. There is no queued notification, retry, resend state, or visible onboarding-email status.

**Evidence:**

- `Zuno-hr-India-Api/src/services/user.service.ts`
- `Zuno-hr-India-Api/src/services/email.service.ts`

**Impact:**  
An admin may believe the employee has been onboarded successfully while the employee never receives access instructions. The request still waits on SMTP even though delivery failure is ignored, which adds latency without reliability.

**Recommendation:**  
Move welcome email delivery to a durable notification job/outbox. Return employee creation success after the employee is saved and the welcome-email job is persisted. Expose resend/status controls for admins.

---

### A2. Resignation email side effects can make persisted state and API response disagree

**Priority:** High consistency risk  
**Area:** Backend async/side effect  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Resignation apply/approve/reject flows save resignation state and then await email notifications. Some email paths are not isolated with a reliable task pattern, so an email failure can cause the API to report failure after the core state has already changed.

**Evidence:**

- `Zuno-hr-India-Api/src/services/user.service.ts`

**Impact:**  
A user or admin may retry the action because the API failed, even though the resignation status was already persisted. This can create duplicate attempts, confused UI state, and support ambiguity.

**Recommendation:**  
Persist the resignation state and enqueue notifications after commit. If email must remain in-process temporarily, catch the notification failure and return a clear `notificationStatus` instead of failing the saved business action.

---

### A3. FCM token update performs unrelated notification work

**Priority:** Medium  
**Area:** Backend async/task placement  
**Roles affected:** Admin

**Finding:**  
The FCM token update endpoint also runs visa-expiry notification checks for admins. A device-token registration request should not trigger unrelated HR notification logic.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/user.routes.ts`

**Impact:**  
Repeated token updates can create unnecessary latency and duplicate notification attempts. This also makes a simple device registration API responsible for business notification scheduling.

**Recommendation:**  
Keep the FCM token endpoint limited to storing the token. Move visa-expiry notifications to a scheduled job or notification worker with idempotency and delivery tracking.

## Deferred Work

The following items were found during review but are not part of the immediate core-flow fix list:

- Remove excessive debug logging from employee forms, routes, and services.
- Harden response field selection across all user APIs.
- Review and remove unauthenticated/dev-only FCM test routes.
- Clean up `user-profile` routes, which appear incomplete and are not used by the current profile page.
- Normalize boolean handling for `active`, which is sometimes sent as a string from the frontend.
- Improve minor employee form UX and validation messaging.
- Review broad LOV loading in employee forms for performance.

## Suggested Fix Order

1. Add backend role protection for employee create/update/delete.
2. Add scoped access checks for `GET /users/:id` and all employee-linked detail routes.
3. Restrict `/users/payroll` and return only payroll-required fields.
4. Add manager hierarchy validation for create/update.
5. Add a proper `/auth/me` or `/users/me` endpoint and fix frontend bootstrap.
6. Replace universal default password onboarding.
7. Fix employee list sorting contract.

## Recommended Verification Scenarios

- Call employee create/update/delete APIs as staff and manager users and confirm unauthorized requests return 403.
- Try reading another employee's profile as staff, as an unrelated manager, and as the assigned manager.
- Create employees with valid, inactive, self, and circular manager assignments to confirm backend hierarchy validation.
- Create a portal-enabled employee while SMTP is unavailable and confirm onboarding email failure is visible or queued for retry.
- Verify employee list sorting sends the expected backend parameter and returns correctly ordered data.
- Submit resignation apply/approve/reject while email delivery fails and confirm persisted status and API response do not disagree.
