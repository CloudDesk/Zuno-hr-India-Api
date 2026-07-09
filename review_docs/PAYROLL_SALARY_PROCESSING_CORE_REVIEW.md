# Payroll & Salary Processing - Core Flow Review

## Module

Payroll & Salary Processing

## Review Scope

This review focuses only on major functionality in the core HRMS flow:

- Salary structure setup
- Salary assignment and salary history
- Payroll initiation and monthly calculation
- Attendance, leave, overtime, tax, and deduction inputs used by payroll
- Payroll review, export, status transition, payment confirmation, and retry flow
- Salary statement generation
- Custom payroll components
- Payslip generation, payslip send/release, and employee payslip access
- Async/task handling for payroll, payslip PDF generation, email, Excel import/export, and side effects

Items such as debug log cleanup, minor visual polish, icon consistency, and broad refactoring are treated as deferred unless they directly affect the core payroll or payslip flow.

## Confidence

These findings are based on direct source-code review across the frontend and backend payroll, salary setup, salary assignment, payslip, document-backed payslip, and salary statement flows. They are valid code-level gaps. Runtime/API testing against a seeded database is still recommended before release, especially for role-based authorization, tax side effects, payslip visibility, and month-close payment flows.

## Core Flow Summary

1. Salary structures are created in setup and define fixed earning percentages plus statutory deduction configuration.
2. Salary assignments link an employee to a salary structure, monthly gross salary, effective dates, allowances, insurance, and voluntary PF.
3. Payroll initiation accepts `monthYear` and either selected users or filters. The backend resolves employee IDs, reads salary assignments, attendance, approved leaves, overtime, holiday/weekend data, and tax declaration deductions, then inserts draft payroll records.
4. Payroll review fetches payroll summaries and exportable payment data. Admin/finance users move records from `Draft` to `PendingApproval`, then `InPayment`, then `Completed` or `Failed`.
5. Payment confirmation can be done by direct status update or Excel import/confirmation. Completed payroll requires a UTR number.
6. Payslip generation currently runs from completed payroll records and creates PDF documents uploaded to GCP, stored as `Document` records with type `Payslip`.
7. Payslip send emails document-backed payslip URLs to employees and marks documents as sent/exported.
8. Employee payslip view reads document-backed payslip data and displays the PDF plus summary values.
9. Payroll deletion/reversal attempts to reset tax flags, delete payslip documents/files, and delete payroll records.

## Core Flow Findings

### 1. Payroll admin APIs are only authenticated, not role-protected

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, HR, Finance, Manager, Staff

**Finding:**  
Most payroll admin APIs require login but do not enforce admin, HR, or finance roles. This includes payroll generation, payroll summary/export data, user payroll status lookup, status update, payment import, Excel confirmation, salary statement download, payroll deletion, single-record deletion, and custom component updates.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/payroll.routes.ts`
- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India/src/lib/services/api/payroll.ts`

**Impact:**  
Any authenticated user may be able to initiate payroll, view salary and bank data, update payment status, export salary statements, mutate payroll adjustments, or delete payroll records by calling APIs directly.

**Recommendation:**  
Add backend role and permission middleware to all payroll mutation and sensitive read routes. Use backend-derived authorization only. Suggested split:

- HR/Admin: initiate payroll, salary setup, employee payroll setup.
- Finance/Admin: export payment data, import/confirm payments, salary statements.
- Admin-only: delete/reverse payroll, modify custom components after review rules.
- Staff: no access to admin payroll APIs.

---

### 2. Payslip document APIs expose private payslips

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, HR, Staff

**Finding:**  
The active employee payslip flow uses document-backed endpoints. Both `/documents/my/payslips` and `/documents/payslip/search` have authentication disabled/commented and accept arbitrary `userId` or `userIds`.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/document.routes.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India/src/routes/my/payslips/+page.svelte`
- `Zuno-hr-India/src/lib/services/api/documents.ts`

**Impact:**  
A caller can fetch another employee's payslip document URL and salary summary by changing request parameters. This is a direct payroll confidentiality issue.

**Recommendation:**  
Authenticate these endpoints and scope access:

- Staff can fetch only their own payslips using `request.user._id`; ignore client-provided `userId`.
- Admin/HR can search payslips only through an explicit admin route.
- Signed/private file URLs should be short-lived or access-checked before download.

---

### 3. Salary setup APIs are not sufficiently protected

**Priority:** Core blocker  
**Area:** Backend security/business logic  
**Roles affected:** Admin, HR, Staff

**Finding:**  
Salary structure and salary assignment create/update/list/detail routes use only authentication. Salary assignment delete routes do not apply authentication. These APIs control payroll setup and can expose or mutate salary data.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/salary-structure.ts`
- `Zuno-hr-India-Api/src/routes/salary-assignment.ts`
- `Zuno-hr-India-Api/src/services/salary-structure.service.ts`
- `Zuno-hr-India-Api/src/services/salary-assignment.service.ts`

**Impact:**  
Non-HR users may be able to read salary structures, inspect another employee's salary assignment, change salary setup, or delete assignments. This can corrupt payroll, tax declarations, and employee salary history.

**Recommendation:**  
Protect salary setup with admin/HR-only authorization. For employee self-service salary views, expose a separate read-only endpoint scoped to the current user with only safe fields.

---

### 4. Payroll and employee payslip screens default to the wrong month

**Priority:** Core UX/business flow issue  
**Area:** Frontend state management  
**Roles affected:** Admin, HR, Finance, Staff

**Finding:**  
Payroll initiate/review/generate/send screens build the default month with `now.getMonth() + 0`. The employee payslip page uses `currentDate.getMonth()` directly. JavaScript months are zero-based, while the APIs and dropdowns use `1-12`.

**Evidence:**

- `Zuno-hr-India/src/lib/components/payroll/payrollInitiate.svelte`
- `Zuno-hr-India/src/lib/components/payroll/payrollReview.svelte`
- `Zuno-hr-India/src/lib/components/payroll/payslipGenerate.svelte`
- `Zuno-hr-India/src/lib/components/payroll/payslipSend.svelte`
- `Zuno-hr-India/src/routes/my/payslips/+page.svelte`

**Impact:**  
Users can accidentally process, review, generate, send, or view payslips for the previous month. In January, the employee payslip page can request month `0`, which is invalid.

**Recommendation:**  
Use `new Date().getMonth() + 1` everywhere month values are sent to APIs. Add a small shared utility for payroll month defaults to prevent future drift.

---

### 5. Payroll calculation mutates tax state before payroll is durably committed

**Priority:** Core data consistency risk  
**Area:** Backend database interaction/business logic  
**Roles affected:** Admin, HR, Finance, Staff

**Finding:**  
Payroll calculation calls `calculateIncomeTax`, which marks a tax declaration monthly deduction as processed during calculation. Payroll records are inserted later via `Payroll.insertMany`. These operations are not in one transaction. There is also an apparent month-name mismatch: the lookup uses the short month name, while the update filter uses the full month name.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India-Api/src/models/tax-declaration`

**Impact:**  
If payroll generation fails after tax mutation, tax declarations can show deductions as processed without corresponding payroll records. If the month-name mismatch prevents updates, payroll can repeatedly include a tax deduction that should have been marked processed.

**Recommendation:**  
Do not mutate tax declaration state during preview/calculation. Mark monthly deductions as processed only after payroll records are successfully persisted, ideally in a MongoDB transaction. Use consistent month codes (`Jan`, `Feb`, etc.) and add idempotency checks per employee/month.

---

### 6. ESI employee deduction is calculated but not deducted from net salary

**Priority:** Core payroll calculation issue  
**Area:** Backend business logic/statutory deduction  
**Roles affected:** India payroll employees, HR, Finance

**Finding:**  
For India employees, `esiEmployee` is calculated when gross salary is within the ESI applicability limit. However, `totalDeductions` excludes `esiEmployee`; it sums EPF, professional tax, income tax, TDS, and leave deduction only.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India-Api/src/models/payrolls.model.ts`

**Impact:**  
Net salary can be overstated for ESI-applicable employees, and payroll reports/payslips can show inconsistent statutory values.

**Recommendation:**  
Confirm business intent. If ESI employee contribution should be deducted, include it in `totalDeductions` and net salary. If it is intentionally informational, rename/display it accordingly and document why.

---

### 7. Payslip generate/send filter contract rejects country filter from UI

**Priority:** Core API contract issue  
**Area:** Frontend + Backend API contract  
**Roles affected:** Admin, HR

**Finding:**  
The payslip generate and send UIs include `country` in bulk filter payloads. The backend `/documents/payslip/generate` and `/documents/payslip/send` filter schemas allow department, role, status, and search, but not country, with `additionalProperties: false`.

**Evidence:**

- `Zuno-hr-India/src/lib/components/payroll/payslipGenerate.svelte`
- `Zuno-hr-India/src/lib/components/payroll/payslipSend.svelte`
- `Zuno-hr-India-Api/src/routes/document.routes.ts`

**Impact:**  
Bulk generate/send by filter can fail validation or fail to scope by country. This is especially risky because payroll itself has India/UAE country filtering.

**Recommendation:**  
Add `country` to backend payslip filter schemas and pass it into `getUserIdsByFilters`, or remove country from UI payloads and enforce country scope another way.

---

### 8. Payslip send can report success even when email delivery fails

**Priority:** Core notification/release issue  
**Area:** Backend side effects/error handling  
**Roles affected:** Admin, HR, Staff

**Finding:**  
`sendPayslipDocuments` sends email for each recipient. If `emailService.sendPayslipEmails` returns an unsuccessful result without throwing, the document is not marked as sent, but the recipient result is still returned as `success`.

**Evidence:**

- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India-Api/src/services/email.service.ts`

**Impact:**  
The UI may tell HR that payslips were sent successfully even when employees did not receive them. Reconciliation becomes difficult because failed delivery is not reliably recorded per document.

**Recommendation:**  
Treat unsuccessful email results as failed recipient results. Store email history for both success and failure, including message ID or error. Return accurate success/failed counts to the UI.

---

### 9. Payroll deletion/reversal is not transactional and can delete completed payroll

**Priority:** Core data consistency/audit risk  
**Area:** Backend database interaction/reversal workflow  
**Roles affected:** Admin, HR, Finance, Staff

**Finding:**  
Payroll delete flows revert tax flags, delete payslip documents/files, and then delete payroll records. These steps are not transactional, and errors in tax/doc cleanup are caught and logged while deletion can continue. Single-record deletion allows `Completed` payroll records to be deleted through safe-reverse logic.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/payroll.routes.ts`
- `Zuno-hr-India-Api/src/services/payroll.service.ts`

**Impact:**  
Payroll records, tax declarations, and payslip documents can become inconsistent. Deleting completed payroll can also remove audit-critical financial history if called accidentally or by an unauthorized user.

**Recommendation:**  
Restrict deletion to draft/cancelled records unless a formal reversal workflow is used. For completed payroll, create a reversal record or reversal status instead of physical deletion. Use transactions where possible, and record who reversed what, when, and why.

---

### 10. Salary assignment and structure validation relies too much on frontend

**Priority:** Core setup integrity risk  
**Area:** Backend validation/business logic  
**Roles affected:** Admin, HR, Finance

**Finding:**  
The frontend applies several salary setup rules, but backend validation is incomplete for salary-affecting fields. Examples include missing minimum validations on monthly gross, reimbursement, annual insurance, and limited backend checks for country consistency between employee and salary structure. Salary changes can also recalculate tax declarations synchronously without checking whether payroll already exists for affected periods.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/salary-assignment.ts`
- `Zuno-hr-India-Api/src/models/salary-assignments.model.ts`
- `Zuno-hr-India-Api/src/services/salary-assignment.service.ts`
- `Zuno-hr-India/src/lib/components/employee/salary/SalaryDetails.svelte`

**Impact:**  
Direct API calls can create invalid or inconsistent salary setup. Salary edits after payroll generation can make salary history, tax plans, and payroll records disagree.

**Recommendation:**  
Move all critical salary validations to the backend:

- Monthly gross must be greater than zero.
- Monetary fields cannot be negative.
- Salary structure country must match employee country.
- Effective dates must be valid and non-overlapping.
- Salary-affecting changes should be blocked or versioned safely when payroll exists for affected months.

---

### 11. Half-day and fractional payroll values can be corrupted across save paths

**Priority:** Core calculation consistency risk  
**Area:** Backend model persistence/business logic  
**Roles affected:** Staff, HR, Finance

**Finding:**  
Payroll calculation supports fractional values from half-day leave/attendance. The payroll model pre-save hook floors non-monetary fields such as `presentDays`, `LOPDays`, `payableDays`, and `overtimeHours`. Payroll initiation uses `insertMany`, while later operations such as custom component updates use document `save`.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India-Api/src/models/payrolls.model.ts`

**Impact:**  
Fractional attendance/payable days can be preserved during one path and later rounded down during another path, causing payroll and payslip values to shift unexpectedly.

**Recommendation:**  
Define which fields are allowed to be decimal. Do not floor payable/present/LOP days if half-day leave is supported. Normalize consistently in calculation before persistence, not opportunistically in model hooks.

---

### 12. Employee payslip screen and document metadata do not share a complete data contract

**Priority:** Core UX/data contract issue  
**Area:** Frontend + Backend API contract  
**Roles affected:** Staff

**Finding:**  
Generated document payslips store only summary fields such as gross, net, deductions, bonus, and reimbursement. The employee payslip screen expects additional detailed fields like EPF, professional tax, income tax, CTC, and component-level values. Some helper methods also expect detailed fields inside `paySummary`, but the generated metadata does not store them.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payslip-pdf.service.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India/src/routes/my/payslips/+page.svelte`

**Impact:**  
The PDF can be correct while the on-screen salary breakdown is missing or shows zero values. Employees may see inconsistent payroll information between screen and PDF.

**Recommendation:**  
Define one payslip DTO for the employee screen. Either store the required detailed fields in `Document.metadata.payslip` at generation time or populate them from the referenced payroll record when serving employee payslips.

---

### 13. Excel payment confirmation path does not fully mirror direct status update

**Priority:** Core payment workflow consistency issue  
**Area:** Backend status management  
**Roles affected:** Finance, Admin

**Finding:**  
Direct status update clears failure reason and retry count when moving to `Completed`. The Excel batch update path sets UTR and payment confirmation date, but does not fully clear stale failure metadata.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India-Api/src/routes/payroll.routes.ts`
- `Zuno-hr-India/src/lib/components/payroll/payrollReview.svelte`

**Impact:**  
A record can be completed but still carry previous failure metadata, leading to confusing reports and inaccurate status history interpretation.

**Recommendation:**  
Use a single status transition service for both direct and Excel paths. Ensure all side effects for `Completed`, `Failed`, and `RetryPending` are identical.

---

### 14. Payroll summary totals can differ from record-level payable days

**Priority:** Secondary calculation/reporting issue  
**Area:** Backend aggregation/reporting  
**Roles affected:** HR, Finance

**Finding:**  
Payroll summary aggregates `totalPayableDays` as `totalDaysInMonth - LOPDays`, while exported record details use each record's `payableDays`. If payable days are capped, fractional, or adjusted by special rules, dashboard totals can differ from row totals.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payroll.service.ts`

**Impact:**  
Summary totals and exported details can disagree during review, especially for half-day leave, corrected attendance, or special adjustments.

**Recommendation:**  
Aggregate `payableDays` directly from payroll records. Add tests for half-day and corrected attendance cases.

## Async, Tasks, and Side-Effect Findings

### A1. Payroll initiation should be a background job

**Priority:** High reliability/scalability risk  
**Area:** Backend async/task handling  
**Roles affected:** Admin, HR, Finance

**Finding:**  
Payroll initiation performs employee lookup, salary assignment lookup, attendance aggregation, leave calculation, overtime lookup, tax calculation, and bulk insert in one HTTP request.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/payroll.routes.ts`
- `Zuno-hr-India-Api/src/services/payroll.service.ts`

**Impact:**  
Large payroll runs can time out, partially mutate tax state, and leave the user without a durable job status. Retrying the request can create inconsistent behavior.

**Recommendation:**  
Convert payroll initiation to a durable job:

- API creates a payroll run job and returns `jobId`.
- Worker processes employees in batches.
- Store per-employee status, errors, and generated payroll IDs.
- Mark tax deductions only after each employee payroll record is committed.
- UI polls job status and displays partial failures.

---

### A2. Payslip PDF generation and GCP upload should be queued

**Priority:** High reliability/scalability risk  
**Area:** Backend async/task handling  
**Roles affected:** HR, Staff

**Finding:**  
Payslip generation renders PDFs and uploads them to GCP inside the request. The newer document-backed generator handles per-employee errors better than the older service, but it is still synchronous.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/document.routes.ts`
- `Zuno-hr-India-Api/src/services/payslip-pdf.service.ts`
- `Zuno-hr-India-Api/src/services/payslip.service.ts`

**Impact:**  
Large payslip batches can timeout or overload the PDF renderer. If the browser/PDF runtime or GCP upload fails mid-run, users need to rerun manually and infer which employees succeeded.

**Recommendation:**  
Queue payslip generation per payroll month/country. Store document generation state per employee: `Queued`, `Generating`, `Generated`, `Failed`, `Retried`. Allow retry of failed employees only.

---

### A3. Payslip email sending should use a notification outbox

**Priority:** High reliability risk  
**Area:** Backend async/task handling/email side effect  
**Roles affected:** HR, Staff

**Finding:**  
Payslip send calls the email service directly in the request. The document service sends recipients in parallel and relies on email service return values, but does not durably queue or retry delivery.

**Evidence:**

- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India-Api/src/services/payslip.service.ts`
- `Zuno-hr-India-Api/src/services/email.service.ts`

**Impact:**  
SMTP slowness affects API latency. Failed sends may not be retried or audited correctly. HR can receive misleading success feedback.

**Recommendation:**  
Use an outbox table/collection for payslip emails after payslip documents exist:

- One outbox row per employee/payslip.
- Track status, retry count, last error, message ID, sent timestamp.
- Update document status only when the outbox worker confirms delivery.

---

### A4. Excel import/export and salary statement generation need job or streaming controls

**Priority:** Medium scalability/security risk  
**Area:** Backend async/task handling/reporting  
**Roles affected:** Finance, Admin

**Finding:**  
Payment Excel import validation, salary statement generation, and payroll summary exports are handled directly through API requests. These reports include sensitive bank and salary data.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/payroll.routes.ts`
- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `Zuno-hr-India-Api/src/services/salary-statement.service.ts`
- `Zuno-hr-India/src/lib/components/payroll/payrollReview.svelte`

**Impact:**  
Large exports can consume server memory and block requests. Sensitive reports can be generated by any authenticated user unless role checks are added.

**Recommendation:**  
For small exports, stream files and enforce finance/admin roles. For large exports/imports, create report/import jobs with downloadable artifacts, expiry, audit logging, and row-level validation summaries.

---

### A5. Payroll reversal should be a controlled background workflow

**Priority:** High audit/reliability risk  
**Area:** Backend async/task handling/reversal side effects  
**Roles affected:** Admin, HR, Finance

**Finding:**  
Payroll deletion/reversal can reset tax flags, delete payslip documents, delete GCP files, and delete payroll records in one request. Failures in sub-steps are caught and logged.

**Evidence:**

- `Zuno-hr-India-Api/src/services/payroll.service.ts`

**Impact:**  
Reversal can partially complete. There is no durable reversal job showing which side effects succeeded or failed.

**Recommendation:**  
Implement reversal as an auditable workflow:

- Create reversal request with reason and actor.
- Validate status and permissions.
- Process tax reversal, document revocation, and payroll reversal in controlled steps.
- Store per-step status and retry failed cleanup.
- Prefer reversal records/status over physical deletion for completed payroll.

## Deferred Work

The following can be treated as later cleanup unless they start affecting core payroll behavior:

- Remove noisy `console.log` statements from payroll and payslip services.
- Consolidate older `/payslip/*` APIs with newer `/documents/payslip/*` APIs.
- Refine payroll review status label/color inconsistencies in the UI.
- Improve salary setup table layout and copy.
- Deduplicate salary calculation logic between payroll and salary statement preview.
- Add broader pagination/streaming optimizations after role and consistency issues are fixed.

## Recommended Fix Order

1. Add backend role checks and self-scope protections for payroll, salary setup, document payslip, and salary statement APIs.
2. Fix month defaults in all payroll and employee payslip screens.
3. Fix ESI deduction inclusion or explicitly mark it informational.
4. Make tax deduction processing idempotent and transaction-safe.
5. Move payroll initiation, payslip generation, and payslip email sending to durable jobs/outbox.
6. Align payslip document metadata with employee payslip UI needs.
7. Harden salary assignment validation and payroll-period locking.
8. Replace completed-payroll deletion with controlled reversal workflow.
