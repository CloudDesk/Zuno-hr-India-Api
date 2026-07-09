# Tax Declaration & Compliance - Core Flow Review

## Module

Tax Declaration & Compliance

## Review Scope

This review focuses only on major functionality in the core HRMS flow:

- Tax slab setup
- Employee tax regime selection
- Tax declaration creation and update
- Annual gross, professional tax, tax liability, and monthly TDS deduction plan calculation
- Proof of investment upload and admin review
- Submission window enable/lock flow
- Form 12B upload, approval, and TDS adjustment
- Form 12BB generation and preview/release flow
- Form 16 ZIP upload
- Bulk declaration creation, Form 12B enablement, and migration adjustment
- Async/task handling for document generation, ZIP/Excel processing, GCP uploads, recalculation, and employee notifications

Items such as debug logging cleanup, minor visual polish, icon consistency, and broad refactoring are treated as deferred unless they directly affect tax accuracy, compliance documents, payroll deductions, employee data privacy, or core admin workflows.

## Confidence

These findings are based on direct source-code review across frontend and backend tax declaration, tax slab, document, Form 12B, Form 12BB, Form 16, salary assignment side effects, and payroll-facing tax deduction flows. They are valid code-level gaps. Runtime/API testing against seeded data is still recommended before release, especially for role-based access, document upload/review flows, tax recalculation, and payroll deduction side effects.

## Core Flow Summary

1. Admin configures tax slabs for the current financial year and regime.
2. Employee selects old or new tax regime from the self-service tax declaration page.
3. Backend creates one tax declaration per employee and financial year, calculates annual gross from salary assignments, applies standard deduction and professional tax, calculates initial tax, and creates a month-wise deduction plan.
4. For old regime, employee enters deductions such as HRA, 80C, 80D, 80GG, 80CCD(2), and house property income/loss.
5. Backend recalculates tax using declared deduction amounts and redistributes remaining tax across unprocessed monthly deductions.
6. Employee uploads proof of investment documents. Backend uploads files to GCP, stores embedded document metadata in the tax declaration, and upserts separate `Document` records.
7. Admin reviews declarations, approves or rejects proofs, and backend recalculates tax using verified amounts.
8. If Form 12B applies, employee uploads previous employer details and proof. Admin verifies/rejects it. Verified Form 12B TDS reduces remaining tax.
9. Admin can generate Form 12BB from verified tax declaration data and later enable preview.
10. Admin can upload Form 16 ZIP files, matched by PAN, to store employee Form 16 documents.
11. Admin can run bulk tax declaration creation, bulk Form 12B enablement, and migration adjustment from Excel.
12. Payroll reads the month-wise tax deduction plan from tax declaration and applies tax deduction during monthly payroll calculation.

## Core Flow Findings

### 1. Tax declaration APIs are not properly role or ownership protected

**Priority:** Core blocker  
**Area:** Backend security/access control  
**Roles affected:** Admin, HR, Finance, Staff

**Finding:**  
Most tax declaration routes require authentication only. The backend does not consistently enforce whether the current user is an admin/HR user or the owner of the declaration. This affects both sensitive reads and high-impact mutations.

Examples include:

- `GET /tax-declaration`
- `POST /tax-declaration`
- `PUT /tax-declaration/:id`
- `GET /tax-declaration/user/:userId/current-fy`
- `GET /tax-declaration/hra-context/:employeeId`
- `POST /tax-declaration/:id/update-documents`
- `POST /tax-declaration/:id/review`
- `POST /tax-declaration/bulk-create`
- `POST /tax-declaration/bulk-enable-form12b`
- migration template/preview/confirm
- initialize migration
- toggle submissions
- bulk reject proofs

**Evidence:**

- `Zuno-hr-India-Api/src/routes/tax-declaration.ts`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`

**Impact:**  
Any authenticated user may be able to list tax declarations, read another employee's annual salary/tax data, create or update another employee's tax declaration, upload proof against another declaration, review proofs, enable Form 12B, toggle submission windows, or run migration-related tax changes by calling APIs directly.

**Recommendation:**  
Add backend authorization rules before every tax route:

- Staff can read/update/upload only their own active/current FY declaration.
- Staff cannot pass arbitrary `employeeId` or `userId`; derive it from `request.user._id`.
- Admin/HR/Finance can read and manage employees according to explicit permission rules.
- Review, bulk create, Form 12B enablement, migration, submission toggle, and bulk rejection should be admin/HR/finance-only depending on business ownership.
- Return 403 for unauthorized access, not 400.

---

### 2. `PUT /tax-declaration/:id` ignores the URL id and trusts body `_id`

**Priority:** Core blocker  
**Area:** Backend API contract/security  
**Roles affected:** Admin, HR, Staff

**Finding:**  
The update route accepts `/:id`, but the route handler passes only `request.body` to the service. The service updates the declaration using `data._id`. The URL id is not validated, compared, or used.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/tax-declaration.ts`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India/src/lib/services/api/taxDeclaration.ts`

**Impact:**  
A caller can send a request to one declaration URL while putting another declaration `_id` in the body. Combined with missing ownership checks, this can update another employee's declaration and tax plan.

**Recommendation:**  
Use the URL id as the source of truth. Reject requests where body `_id` is present and does not match the URL id. For staff routes, also verify the target declaration belongs to `request.user._id`.

---

### 3. Tax slab APIs are only authenticated and backend validation is weak

**Priority:** Core blocker  
**Area:** Backend security/business logic  
**Roles affected:** Admin, HR, Finance, Staff, Payroll

**Finding:**  
Tax slab CRUD routes are authentication-only. Tax slabs control every employee's tax calculation, but any authenticated user may be able to create, edit, or delete slab configuration if they call the APIs. The backend also does not fully validate slab shape.

Missing backend validations include:

- financial year format and consecutive years
- non-negative cess and standard deduction rules
- non-negative tax rates
- contiguous slab ranges
- no overlapping slabs
- exactly one open-ended final slab
- only one active slab per financial year and regime

**Evidence:**

- `Zuno-hr-India-Api/src/routes/tax-slab.routes.ts`
- `Zuno-hr-India-Api/src/services/tax-slab.service.ts`
- `Zuno-hr-India-Api/src/models/tax-slab.model.ts`
- `Zuno-hr-India/src/lib/components/setup/TaxSlabManagement.svelte`
- `Zuno-hr-India/src/lib/components/setup/tax-slab/TaxSlabForm.svelte`

**Impact:**  
Bad or unauthorized slab changes can silently corrupt tax liability, payroll TDS deductions, Form 12BB values, and compliance outputs for all employees.

**Recommendation:**  
Make tax slab create/update/delete admin/finance-only. Move the frontend slab validation rules into backend service/model validation. Add a unique active constraint or transactional activation workflow for financial year plus regime.

---

### 4. Form 16 and Form 12B compliance routes miss authentication/authorization

**Priority:** Core blocker  
**Area:** Backend security/compliance  
**Roles affected:** Admin, HR, Finance, Staff

**Finding:**  
Several sensitive document routes are not properly authenticated or authorized:

- Form 16 ZIP upload uses only `zipFileUpload`, not `authenticate`.
- Form 12B upload uses only `filesUpload`, not `authenticate`.
- Form 12B status update has authentication commented out.
- Form 12B status update also has the admin role check commented out.
- Form 12B upload/status fallback to a hardcoded user id when `request.user` is missing.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/document.routes.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`

**Impact:**  
Unauthenticated or unauthorized callers may be able to upload Form 16 ZIPs, submit Form 12B for an employee, or approve/reject Form 12B. This can expose compliance documents and directly alter employee tax deduction through Form 12B TDS adjustment.

**Recommendation:**  
Require `authenticate` for all Form 16/Form 12B mutation routes. Enforce:

- Form 16 ZIP upload: admin/finance-only.
- Form 12B upload: employee self only or admin on behalf with audit.
- Form 12B status update: admin/finance-only.
- Remove hardcoded fallback user ids.
- Include audit logs with real `request.user._id`.

---

### 5. Tax declaration update trusts client-submitted declaration limits

**Priority:** Core tax integrity issue  
**Area:** Backend validation/business logic  
**Roles affected:** Staff, Admin, Payroll

**Finding:**  
The frontend validates deduction limits, but the backend calculation uses `declaration.maxLimit` from the request data when capping declared amounts. A manipulated API request can send inflated or missing `maxLimit` values.

**Evidence:**

- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India-Api/src/constants/tax-deduction-sections.ts`
- `Zuno-hr-India/src/lib/components/taxDeclaration/ITDeclarationSection.svelte`

**Impact:**  
Employees can potentially claim deductions above allowed limits by bypassing the UI. This can understate taxable income and payroll TDS.

**Recommendation:**  
Treat server-side deduction configuration as the source of truth. On update:

- Recompute all limits from `deductionSections`, salary/HRA context, and statutory rules.
- Ignore client-supplied `maxLimit`.
- Validate section/subsection IDs against backend config.
- Reject negative or impossible values except for explicit house property income/loss semantics.

---

### 6. Form 12B verification can leave document and tax states inconsistent

**Priority:** Core data consistency risk  
**Area:** Backend database interaction/business logic  
**Roles affected:** Admin, Finance, Staff, Payroll

**Finding:**  
When Form 12B is verified, the service updates tax declaration TDS and monthly deduction plan before saving the Form 12B document status. There is no database transaction across document status and tax declaration mutation.

**Evidence:**

- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`

**Impact:**  
If tax declaration save succeeds but document save fails, payroll can deduct lower tax while the Form 12B document still appears unverified. If document save succeeds but later logic fails, the inverse inconsistency is also possible.

**Recommendation:**  
Wrap Form 12B status update and tax declaration recalculation in one MongoDB transaction where possible. If file/document storage makes full transaction impossible, use an explicit state machine:

- `VerificationPending`
- `TaxAdjustmentPending`
- `Verified`
- `AdjustmentFailed`

Then retry failed adjustment safely.

---

### 7. Proof upload has no ownership check and can create partial storage state

**Priority:** Core security/data consistency risk  
**Area:** Backend access control + file storage  
**Roles affected:** Staff, Admin, HR

**Finding:**  
The proof upload service checks whether submissions are enabled, but it does not verify that the logged-in user owns the tax declaration. It uploads files to GCP, mutates embedded declaration documents, and then tries to upsert a separate `Document` record. If the `Document` upsert fails, the request still succeeds with only embedded metadata saved.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/tax-declaration.ts`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India/src/lib/components/taxDeclaration/InvestmentProofUploader.svelte`

**Impact:**  
A caller may upload or replace proof files for another employee's declaration. The app can also end up with embedded proof metadata without a corresponding `Document` record, breaking document center/audit consistency.

**Recommendation:**  
Before accepting files:

- Staff upload only if declaration `employeeId` equals `request.user._id`.
- Admin/HR upload on behalf only with explicit audit.
- Validate file types and sizes server-side.
- Treat GCP upload plus DB metadata updates as one recoverable operation.
- Do not silently ignore `Document` upsert failure; return an error or queue a repair task.

---

### 8. Form 12B upload allows broad re-upload and lacks ownership/submission-window enforcement

**Priority:** Core compliance issue  
**Area:** Backend validation/business logic  
**Roles affected:** Staff, Admin, Finance

**Finding:**  
The Form 12B upload service validates employee id, financial year, applicability, tax declaration id, and employment period. However, it does not enforce that the current user owns `formData.employeeId`. Re-upload restrictions are commented out, and there is no clear submission window/lock check in the Form 12B upload path.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/document.routes.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India/src/lib/components/taxDeclaration/Form12BSection.svelte`
- `Zuno-hr-India/src/lib/components/taxDeclaration/Form12BCreate.svelte`

**Impact:**  
An employee can potentially submit/re-upload Form 12B data for another employee by changing request payload. A user may also overwrite a pending or processed Form 12B outside the intended resubmission rules.

**Recommendation:**  
Enforce ownership and state transitions:

- Staff can upload only their own Form 12B.
- Admin upload on behalf requires explicit mode and audit.
- Re-upload only when status is `ResubmissionRequested` or when admin resets it.
- Block upload when tax submission window is closed unless admin override is used.

---

### 9. Form 12BB generation does not match the active declaration model

**Priority:** Core compliance accuracy issue  
**Area:** Backend business logic/document generation  
**Roles affected:** Admin, Finance, Staff

**Finding:**  
Form 12BB generation maps several fields incorrectly or incompletely:

- HRA is read from `80GG` rent paid instead of `10_13A` HRA.
- Landlord name, landlord address, landlord PAN, lender name, lender address, lender PAN, and lender type are hardcoded blank.
- The generator references sections such as `10(5)`, `24(b)`, `80TTA`, and `other_income`, but the active deduction config does not include those section IDs.
- It stores `deductions` using `totalDeclaredAmount`, not necessarily verified deduction amount.
- It stores `taxPayable` from `initialTaxBreakdown.finalTaxWithCess`, which may not represent final verified tax after all review/migration/Form 12B adjustments in every case.

**Evidence:**

- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India-Api/src/constants/tax-deduction-sections.ts`
- `Zuno-hr-India/src/lib/components/taxDeclaration/Form12BBGenerate.svelte`

**Impact:**  
Generated Form 12BB can be incomplete or inaccurate even when the tax declaration data is correct. This is a compliance document risk.

**Recommendation:**  
Rebuild Form 12BB generation from the current backend deduction config and verified declarations only. Add a mapping layer with tests for:

- HRA `10_13A`
- 80C grouped claims
- 80D grouped claims
- house property income/loss
- Form 12B TDS
- landlord/lender details and proof names

Only allow generation when required declarations are reviewed or explicitly marked as not applicable.

---

### 10. Annual gross and professional tax calculations count partial months as full months

**Priority:** Core tax accuracy issue  
**Area:** Backend business logic  
**Roles affected:** Staff, Admin, Payroll

**Finding:**  
Annual gross and professional tax count an overlapping salary assignment by whole months using month difference plus one. Mid-month joining, mid-month salary revisions, or mid-month exits are treated as full months.

**Evidence:**

- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India-Api/src/services/tax-salary-context.service.ts`
- `Zuno-hr-India-Api/src/services/salary-assignment.service.ts`

**Impact:**  
Annual gross can be overstated or understated for employees with mid-month changes. That affects tax liability, HRA calculation, monthly deduction plan, Form 12BB, and payroll TDS.

**Recommendation:**  
Decide the business rule:

- If salary is monthly and payroll always pays full month after any active assignment, document the rule.
- If salary is prorated, compute annual gross month-by-month using actual payroll/calendar proration.

Use the same proration approach in tax declaration, payroll, HRA context, and salary assignment side effects.

---

### 11. Salary assignment tax recalculation is not transactionally tied to salary changes

**Priority:** Core consistency risk  
**Area:** Backend cross-module side effect  
**Roles affected:** Admin, HR, Payroll, Staff

**Finding:**  
Salary assignment create/update/delete triggers tax declaration recalculation after salary assignment persistence. For update with versioning, salary assignment changes use a transaction, but tax declaration recalculation happens afterward. If tax recalculation fails, salary data changes remain committed while tax declaration remains stale.

**Evidence:**

- `Zuno-hr-India-Api/src/services/salary-assignment.service.ts`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`

**Impact:**  
Payroll may use stale tax deductions after salary changes. Employees may see old tax liability until someone manually recalculates or updates declarations again.

**Recommendation:**  
Use an outbox/task pattern for salary-change tax recalculation:

- Commit salary assignment change.
- Write a `TaxRecalculationPending` job/event in the same transaction.
- Process recalculation asynchronously with retry.
- Show admin warning if an employee has pending tax recalculation before payroll.

---

### 12. Monthly deduction plan handling has edge-case risks

**Priority:** Core payroll deduction risk  
**Area:** Backend business logic  
**Roles affected:** Payroll, Finance, Staff

**Finding:**  
The monthly deduction plan is generated from the current calendar month and redistributes unprocessed months. This design is reasonable, but there are important edge cases:

- Creating declarations late in the FY creates zero deductions for prior months without verifying whether payroll already processed those months.
- Salary changes and proof reviews rely on remaining-month calculations based on server date.
- Migration-adjusted records intentionally skip redistribution, which can leave annual tax and monthly plan different after later changes.
- Payroll-side month-code consistency must remain aligned with `Apr`, `May`, etc.

**Evidence:**

- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India-Api/src/services/payroll.service.ts`
- `PAYROLL_SALARY_PROCESSING_CORE_REVIEW.md`

**Impact:**  
Tax deduction can be skipped, duplicated, or distributed incorrectly if declarations are created late, payroll is rerun, months are processed out of order, or salary changes happen after migration.

**Recommendation:**  
Make monthly tax deduction idempotent per employee/month:

- Payroll should be the only flow that marks a monthly tax deduction as processed.
- Tax update should recalculate only unprocessed months after checking payroll status.
- Add explicit payroll month status checks before changing processed months.
- Add reconciliation reports for annual tax liability versus monthly plan total.

---

### 13. Heavy compliance and bulk operations run synchronously in request/response

**Priority:** Core scalability/reliability issue  
**Area:** Async/task handling/performance  
**Roles affected:** Admin, HR, Finance, Staff

**Finding:**  
Several heavy operations are executed synchronously inside API requests:

- Form 16 ZIP validation and upload loops.
- Form 12BB DOCX generation, PDF conversion, and GCP upload.
- Form 12B proof upload and GCP upload.
- Proof of investment file uploads and GCP upserts.
- Bulk tax declaration creation.
- Bulk Form 12B enablement.
- Migration Excel preview and confirm processing.
- Migration template generation with active employee reference data.

The backend dependencies include `node-cron`, but there is no queue library or visible job worker/outbox for these flows.

**Evidence:**

- `Zuno-hr-India-Api/src/routes/document.routes.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India-Api/src/routes/tax-declaration.ts`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India-Api/package.json`

**Impact:**  
Large ZIPs, Excel files, PDF conversion, GCP latency, or bulk employee counts can cause request timeouts and partial state. Retrying can duplicate work or overwrite files.

**Recommendation:**  
Introduce background jobs/outbox for heavy or external side-effect operations:

- Return `202 Accepted` with `jobId`.
- Store job status: queued, running, partial success, failed, complete.
- Make GCP uploads and document creation idempotent by employee/FY/type/version.
- Keep a failure report downloadable for ZIP/Excel bulk jobs.
- Process emails/notifications through an outbox with retry.

---

### 14. Employee notifications for tax state changes are missing or not durable

**Priority:** Core workflow gap  
**Area:** Async/task handling/UX  
**Roles affected:** Staff, Admin, HR, Finance

**Finding:**  
The tax module has frontend toast messages for the actor, but backend flows do not reliably notify affected employees for important tax events.

Important events that should notify employees include:

- tax declaration created by admin bulk flow
- submission window enabled or disabled
- proof rejected or resubmission requested
- proof verified or finally rejected
- Form 12B verified/rejected/resubmission requested
- Form 12BB generated and preview enabled
- Form 16 uploaded/released
- migration-adjusted tax plan applied

**Evidence:**

- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India/src/lib/components/taxDeclaration/*`

**Impact:**  
Employees may not know that they need to resubmit proofs, that Form 12B was rejected, or that tax documents are available. That can lead to missed deadlines and incorrect payroll deductions.

**Recommendation:**  
Add notification/email outbox events after successful core DB commits. Do not send emails inline in the request. Each event should be idempotent and retryable.

---

### 15. Migration UI success count is wrong

**Priority:** Core admin UX issue  
**Area:** Frontend/API contract  
**Roles affected:** Admin, HR, Finance

**Finding:**  
The migration confirm response returns `processed` and `failed`, but the UI success screen reads `$confirmationResult.count`, which is not returned by the backend.

**Evidence:**

- `Zuno-hr-India/src/lib/components/taxDeclaration/TaxMigration.svelte`
- `Zuno-hr-India-Api/src/services/tax-declaration.service.ts`

**Impact:**  
After a successful migration, the UI can show `0` records applied even though backend processed rows. Admins may retry or lose confidence in the operation.

**Recommendation:**  
Align the contract. Display `processed`, `failed`, and detailed row results. Keep the success modal open with a downloadable report.

---

### 16. Tax declaration frontend exposes API assumptions that backend does not support

**Priority:** Core API contract issue  
**Area:** Frontend/backend integration  
**Roles affected:** Admin, HR, Staff

**Finding:**  
The frontend `taxDeclarationApi` exposes `getById` and `delete`, and `list` accepts `employeeId`, but the backend tax declaration route file does not define `GET /tax-declaration/:id` or `DELETE /tax-declaration/:id`, and the list route does not read `employeeId`.

**Evidence:**

- `Zuno-hr-India/src/lib/services/api/taxDeclaration.ts`
- `Zuno-hr-India-Api/src/routes/tax-declaration.ts`

**Impact:**  
Any screen or future workflow relying on those frontend API functions will fail or behave unexpectedly. Admin filtering by employee may not work as intended.

**Recommendation:**  
Either remove unused frontend methods or implement secured backend routes. If `employeeId` filter is required for admin, add it with admin/HR-only access and ownership checks.

---

## Async/Task Handling Review

### What should be synchronous

These can remain synchronous if scoped and validated:

- Staff fetch own current FY tax declaration.
- Staff fetch own HRA context.
- Staff update declarations for own record while submission window is open.
- Admin review of a single employee if no file generation/email is performed inline.
- Admin toggles for one employee if notification is queued after commit.

### What should move to background jobs

These should be queued or handled via an outbox/task system:

- Form 16 ZIP processing and GCP upload.
- Form 12BB DOCX/PDF generation and GCP upload.
- Bulk declaration creation.
- Bulk Form 12B enablement.
- Migration preview for large Excel files.
- Migration confirmation.
- Bulk reject missing proofs.
- Employee notification emails.
- Salary-change tax recalculation after salary assignment updates.
- Repair/reconciliation for document metadata versus GCP upload failures.

### Suggested job model

Introduce a durable `Job` or `AsyncTask` model with:

- `type`
- `status`
- `createdBy`
- `startedAt`
- `completedAt`
- `inputHash`
- `targetEmployeeIds`
- `financialYear`
- `resultSummary`
- `rowErrors`
- `retryCount`
- `lastError`

For employee-facing notifications, use a separate `NotificationOutbox`:

- `eventType`
- `employeeId`
- `payload`
- `channel`
- `status`
- `dedupeKey`
- `attempts`
- `lastError`

This prevents email/GCP failures from corrupting tax state and gives admins a visible way to track long-running compliance work.

## Recommended Fix Order

1. **Lock down backend authorization first.** Tax declaration, tax slab, Form 16, Form 12B, Form 12BB, migration, and bulk routes need role and ownership enforcement.
2. **Fix critical API contracts.** Use URL id for update, remove hardcoded user ids, align frontend/backend methods.
3. **Move tax limit validation server-side.** Never trust client-supplied `maxLimit`.
4. **Fix Form 12B transaction consistency.** Document status and tax adjustment must commit together or use a retryable state machine.
5. **Correct Form 12BB mapping.** Generate from verified declaration data and current deduction config.
6. **Add async job/outbox foundation.** Start with Form 16 ZIP, Form 12BB generation, migration confirm, and notifications.
7. **Reconcile monthly tax deduction plan with payroll.** Ensure payroll is the only source that marks months processed.
8. **Handle salary-change recalculation reliably.** Use outbox and visible pending recalculation status.
9. **Add integration tests.** Cover staff self access, admin access, unauthorized access, tax update, proof upload, Form 12B verify, Form 12BB generation, and payroll tax deduction.

## Deferred Work

These are worth improving later but are not the first core blockers:

- Debug `console.log` cleanup across tax routes/services.
- Minor table layout and modal polish.
- Better copy around tax regimes and declarations.
- Reducing duplicated frontend tax config after backend `/sections` is fully trusted.
- More granular document-center filters.
- Better admin dashboard visualization of tax declaration progress.

## Overall Module Assessment

The tax declaration module has the right core pieces: regime selection, declaration creation, salary-driven annual gross, deduction entry, proof upload, review, Form 12B adjustment, Form 12BB generation, Form 16 upload, bulk creation, and migration support. The main problem is that these workflows are not yet protected or hardened enough for production payroll/compliance use.

The top risks are authorization, trusting client-provided tax limits, incomplete compliance document generation, missing transaction boundaries, and synchronous heavy operations. Fixing those first will make the module much safer before deeper polish or optimization.
