# Authentication & Navigation - Core Flow Review

## Module

Authentication & Navigation

## Review Scope

This review focuses only on major functionality in the core HRMS flow:

- Login and session handling
- Logout behavior
- Role-based navigation
- Role-based backend access
- User/session bootstrap after refresh
- Password reset flow

Items such as logging cleanup, token storage hardening, CORS/JWT defaults, sidebar polish, performance optimization, and minor UX/accessibility improvements are treated as deferred unless they directly affect the core flow.

## Confidence

These findings are based on direct source-code review across the frontend and backend. They are valid code-level gaps. Runtime testing is still recommended before release to confirm the exact user-facing behavior in the deployed environment.

## Core Flow Findings

### 1. Logout does not fully clear the backend session

**Priority:** Core blocker  
**Area:** Frontend + Backend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The sidebar logout flow clears browser localStorage and redirects to `/login`, but it does not call a backend logout endpoint or clear the HttpOnly `access_token` cookie. The frontend auth service has a `/auth/logout` method, but the backend auth routes do not expose a matching logout route.

**Evidence:**

- `Zuno-hr-India/src/lib/components/common/Sidebar.svelte`
- `Zuno-hr-India/src/lib/services/api/auth.ts`
- `Zuno-hr-India-Api/src/routes/auth.routes.ts`

**Impact:**  
A user may appear logged out in the UI while the backend session cookie can remain valid. This can cause inconsistent session behavior and creates risk when users share systems or switch accounts.

**Recommendation:**  
Implement a backend logout endpoint that clears the auth cookie. Update all logout paths to use the same frontend logout controller/service instead of clearing localStorage directly.

---

### 2. Backend role enforcement is inconsistent for core HRMS actions

**Priority:** High business/security risk  
**Area:** Backend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Navigation hides admin and manager functionality from lower roles, but some backend routes are protected only by basic authentication or appear to have no authentication. This means role restrictions can potentially be bypassed by calling APIs directly.

**Examples observed:**

- Payroll generation route is authenticated but not clearly admin-restricted.
- LOV create/update routes are authenticated but not clearly admin-restricted.
- Data migration export route is authenticated but not clearly admin-restricted.
- Reports routes appear to be exposed without authentication.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/payroll.routes.ts`
- `Zuno-hr-India-Api/src/routes/lov.routes.ts`
- `Zuno-hr-India-Api/src/routes/data-migration.routes.ts`
- `Zuno-hr-India-Api/src/routes/reports.routes.ts`

**Impact:**  
Staff or unauthorized users may be able to trigger or access sensitive HRMS operations if they bypass the UI and call APIs directly.

**Recommendation:**  
Add centralized backend role middleware, such as `requireRole("admin")` or `requireRole(["admin", "manager"])`, and apply it to every privileged route. Frontend navigation should remain only a UX layer, not the source of authorization.

---

### 3. Session refresh can corrupt frontend auth state

**Priority:** Core blocker  
**Area:** Frontend + Backend API contract  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The frontend expects the current-user refresh call to return a single user object, but the backend `/users?my=true` flow returns the current user inside an array. During layout bootstrap, this response can be stored as the authenticated user.

**Evidence:**

- `Zuno-hr-India/src/routes/+layout.ts`
- `Zuno-hr-India/src/lib/services/api/employees.ts`
- `Zuno-hr-India-Api/src/routes/user.routes.ts`

**Impact:**  
After a browser refresh, the frontend may store an array instead of a user object. This can break role detection, dashboard routing, sidebar decisions, and permission checks.

**Recommendation:**  
Add a dedicated `/auth/me` or `/users/me` endpoint that returns one sanitized user object. Update frontend bootstrap to use that endpoint consistently.

---

### 4. Password reset token validation is incomplete

**Priority:** Core flow issue  
**Area:** Frontend + Backend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The login/reset page contains token validation logic, but it is commented out. The frontend auth service also expects a reset-token validation API, but the backend does not expose the matching validation route.

**Evidence:**

- `Zuno-hr-India/src/routes/login/+page.svelte`
- `Zuno-hr-India/src/lib/services/api/auth.ts`
- `Zuno-hr-India-Api/src/services/auth.service.ts`
- `Zuno-hr-India-Api/src/routes/auth.routes.ts`

**Impact:**  
Users with expired or invalid reset links may only discover the issue after attempting to submit a new password. This creates a broken recovery experience and increases support friction.

**Recommendation:**  
Expose a backend reset-token validation endpoint and re-enable frontend token validation before showing or submitting the reset-password form.

---

### 5. Admin frontend route guard is missing or inconsistent

**Priority:** Core UX/access consistency issue  
**Area:** Frontend  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
Manager routes have a layout-level frontend role guard, but an equivalent admin layout guard was not found. Backend authorization must remain the source of truth, but frontend route guards are still needed for clean navigation behavior and predictable redirects.

**Evidence:**

- `Zuno-hr-India/src/routes/manager/+layout.ts`
- No equivalent admin layout guard found during review.

**Impact:**  
Wrong-role users may reach admin route shells or partial screens before backend/API failures occur. This can create confusing UX and inconsistent role behavior.

**Recommendation:**  
Add an admin route layout guard for frontend UX consistency while also fixing backend role enforcement.

## Async, Tasks, and Side-Effect Findings

### A1. Password reset email delivery is not reliable

**Priority:** Core flow issue  
**Area:** Backend async/side effect  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The forgot-password flow saves a reset token and then attempts to send the reset email. Email delivery is performed directly through the SMTP service and the password reset email helper catches email failures instead of failing the request or recording a retryable job.

**Evidence:**

- `Zuno-hr-India-Api/src/services/auth.service.ts`
- `Zuno-hr-India-Api/src/services/email.service.ts`
- `Zuno-hr-India-Api/src/routes/auth.routes.ts`

**Impact:**  
The API can tell the user that password reset instructions were sent even when the email was not delivered. The reset token may exist in the database, but the user has no way to receive or use it. There is also no retry, delivery status, or support-visible failure state.

**Recommendation:**  
For password reset, either keep email delivery synchronous and fail the request when email cannot be sent, or enqueue the email through a durable outbox/job system and return success only after the job is persisted. Store notification delivery status and retry failed sends.

---

### A2. Auth notifications use direct SMTP instead of a durable task pattern

**Priority:** Medium  
**Area:** Backend architecture  
**Roles affected:** Admin, Manager, Staff

**Finding:**  
The shared email service awaits `sendMail` directly inside request flows. There is no observable email queue, outbox table, retry worker, dead-letter handling, or delivery audit for auth-related notifications.

**Evidence:**

- `Zuno-hr-India-Api/src/services/email.service.ts`

**Impact:**  
Auth APIs that depend on email can become slow or unreliable when SMTP is degraded. Failures are handled differently across modules, which creates inconsistent user-facing behavior.

**Recommendation:**  
Introduce a common notification outbox pattern for all non-trivial emails. At minimum, record `queued`, `sent`, `failed`, retry count, last error, and related entity ID. Password reset should be treated as a high-priority notification.

## Deferred Work

The following items were found during review but are not part of the immediate core-flow fix list:

- Remove sensitive debug logging from auth and reset flows.
- Harden token/session storage strategy.
- Enforce production-safe CORS and JWT secret configuration.
- Improve sidebar collapse-state persistence.
- Reduce global LOV preloading on authenticated layout load.
- Clean up duplicate or inconsistent logout implementations.
- Improve password visibility button accessibility and icon consistency.

## Suggested Fix Order

1. Fix backend role enforcement for privileged APIs.
2. Implement proper backend logout and update frontend logout usage.
3. Add a dedicated current-user endpoint and fix frontend session bootstrap.
4. Complete reset-token validation flow.
5. Add admin frontend route guard.

## Recommended Verification Scenarios

- Login as admin, manager, and staff, then refresh the browser and confirm the user object, role, and sidebar state remain correct.
- Logout and confirm the HttpOnly auth cookie is cleared and protected APIs fail afterward.
- Call privileged APIs directly as staff and manager users to confirm backend role enforcement returns 403.
- Request password reset with SMTP disabled or failing and confirm the API response does not falsely guarantee delivery.
- Open invalid and expired password reset links and confirm the frontend blocks submission before reset.
