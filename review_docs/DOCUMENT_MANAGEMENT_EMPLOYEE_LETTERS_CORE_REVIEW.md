# Document Management & Employee Letters Core Review

Review date: 2026-07-03  
Scope: Core document flows only. This review focuses on sensitive employee documents, payslips, tax documents, certificates, admin uploads, attendance files, offer letters, hike letters, storage/download behavior, and async side effects.

## Module Summary

The Document Management module acts as the shared storage and access layer for HRMS documents. It stores document records in the `Document` collection and stores files in GCP Cloud Storage through `uploadFileToGCP`. The frontend usually receives direct `filePath` URLs and opens them directly from the browser.

Core flows covered:

- Employee self-service document access: payslips, Form16/Form12B/Form12BB, certificates, timesheets, and attendance files.
- Admin/HR document operations: payslip generation, payslip upload, Form16 ZIP upload, admin document upload/update/delete, attendance upload, certificate verification.
- Employee lifecycle letters: offer letter dispatch, hike letter preview, hike letter generation and email dispatch.
- Cross-module document records: tax proof documents and FNF settlement letters.

Primary backend files reviewed:

- `Zuno-hr-India-Api/src/routes/document.routes.ts`
- `Zuno-hr-India-Api/src/services/document.service.ts`
- `Zuno-hr-India-Api/src/models/document.model.ts`
- `Zuno-hr-India-Api/src/services/email.service.ts`
- `Zuno-hr-India-Api/src/services/hike-letter-puppeteer.helper.ts`
- `Zuno-hr-India-Api/src/utilis/gcpStorage.ts`

Primary frontend files reviewed:

- `Zuno-hr-India/src/lib/services/api/documents.ts`
- `Zuno-hr-India/src/routes/my/document-hub/+page.svelte`
- `Zuno-hr-India/src/routes/my/payslips/+page.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/DocumentViewer.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/AdminDocumentUpload.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/Form16Upload.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/PayslipUploadForm.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/BulkPayslipUploadForm.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/DocumentCommunicationModal.svelte`
- `Zuno-hr-India/src/lib/components/documentCenter/DocumentCommunicationDashboard.svelte`
- `Zuno-hr-India/src/lib/components/employee/EmployeeDocument.svelte`

## Core Flow

### Employee Document Access

1. Employee opens Document Hub or My Payslip.
2. Frontend calls either:
   - `GET /documents?access=own...`
   - `GET /documents/my/payslips?month=&year=&userId=`
3. Backend returns document metadata and direct `filePath`.
4. Frontend opens/downloads `filePath` directly.

Expected behavior:

- Employee should only access their own documents.
- Direct file access should be authorized or use short-lived signed URLs.
- Unreleased payslips and non-preview Form12BB documents should not be visible.

Actual risks:

- Some payslip endpoints are unauthenticated.
- Direct document-by-ID does not enforce ownership.
- Direct GCP URLs are exposed to the frontend.

### Admin Document Operations

1. Admin uploads generic employee documents, payslips, attendance files, or Form16 ZIP.
2. Backend validates input, stores file temporarily, uploads to GCP, then creates/updates `Document`.
3. Frontend lists documents and opens direct `filePath`.

Expected behavior:

- Admin-only actions should enforce admin role on every route.
- Upload and DB save should be consistent.
- Re-upload should upload the replacement file before updating the DB.
- Delete should remove both DB row and storage object.

Actual risks:

- Several admin-named routes only require authentication, not admin role.
- Admin re-upload saves a GCP URL without uploading the replacement file.
- Admin delete removes only DB record and leaves GCP file behind.

### Tax Document Flow

1. Employee submits Form12B document.
2. Admin reviews Form12B and updates status.
3. Admin generates Form12BB from tax declaration.
4. Admin enables Form12BB preview for employee.
5. Employee views tax docs through Document Hub.

Expected behavior:

- Form12B submit should require authenticated employee/admin context.
- Form12B approval should require admin role.
- Form12BB generation should be admin-only and schema-valid.
- Preview status should be admin-only.

Actual risks:

- Form12B upload and approval routes have authentication disabled or missing.
- Form12B routes use a hardcoded fallback user ID.
- Form12BB metadata validation expects `employeeId`, but service does not save it.
- Form12BB preview toggle has no role check.

### Offer Letter and Hike Letter Flow

1. HR uploads or generates letter.
2. Backend stores/generated PDF in GCP.
3. Backend creates `Document` record as `Sent`.
4. Backend sends email with attachment.
5. Frontend shows sent logs through `GET /documents?access=global&type=OfferLetter/HikeLetter`.

Expected behavior:

- Only admins/HR should send employee/candidate letters.
- Email dispatch should be async or outbox-backed.
- Document status should reflect real delivery state.

Actual risks:

- Letter routes require login only, not admin role.
- Offer and hike letters are saved as `Sent` before email delivery succeeds.
- Hike letter batch processing is synchronous and partially recoverable only in the HTTP response, not as durable job state.

## Role Coverage

### Employee

Expected:

- Can view own released payslips.
- Can upload own skill/certificate documents.
- Can view own tax documents only when allowed.
- Cannot read or delete other employees' documents.

Issues:

- `GET /documents/my/payslips` accepts arbitrary `userId` and has authentication commented out.
- `GET /documents/:id` returns any document by ID after login without owner checks.
- Own skill delete action is likely hidden because the frontend checks `skill` while backend stores `Skill`.

### Manager

Expected:

- Can view team documents only for assigned subordinates.
- Should not use admin upload, Form16, payslip generation, or letter dispatch flows unless explicitly authorized.

Issues:

- Many admin-named routes do not enforce admin role, so any authenticated manager or staff account may be able to use them if reachable.

### Admin or HR

Expected:

- Can upload/generate/send documents.
- Can verify employee certificates.
- Can generate and release tax documents.
- Can dispatch offer/hike letters.

Issues:

- Some admin operations are not actually admin-restricted.
- Some flows report success or `Sent` state before side effects are complete.
- Admin re-upload and delete can desynchronize DB and storage.

## Findings

### P0 - Payslip APIs Expose Sensitive Salary Documents Without Authentication

Affected areas:

- `GET /documents/my/payslips`
- `POST /documents/payslip/search`
- Frontend `documentsApi.getMyPayslips`
- Frontend `documentsApi.getUserPayslipStatus`

Evidence:

- `GET /documents/my/payslips` has `onRequest: [authenticate]` commented out and requires a query `userId`.
- The route calls `getPayslipDocumentsForUsers`, which returns payslip URL and salary metadata.
- `POST /documents/payslip/search` is also used for payroll status checks and has authentication commented out.

Impact:

- Anyone who can call the API can request another employee's payslip metadata and file URL if they know or guess the user ID.
- Payroll privacy and salary confidentiality are at direct risk.

Recommendation:

- Restore authentication immediately.
- Ignore client-provided `userId` for self-service endpoint and derive employee ID from `request.user`.
- Keep bulk search admin-only.
- Return signed/proxied download URLs instead of raw storage URLs.

Priority: P0

### P0 - Form16 Upload Is Unauthenticated and Enables PAN/Employee Enumeration

Affected area:

- `POST /documents/form16/upload`

Evidence:

- Route uses only `preHandler: [zipFileUpload]`, not `authenticate`.
- It validates PDF filenames as PAN numbers.
- It queries identity proof documents by PAN.
- It returns matched user name and email in `validFiles` or `processed`.

Impact:

- Unauthenticated caller can test PAN values and receive employee identity details.
- Unauthenticated caller can upload or replace Form16 documents.
- This is a serious privacy and compliance risk.

Recommendation:

- Add authentication and admin-only authorization.
- Do not return PAN and employee PII in validation errors unless admin role is verified.
- Rate-limit and audit Form16 upload attempts.
- Process ZIP uploads through a background job with per-file result records.

Priority: P0

### P0 - Form12B Submission and Approval Are Not Properly Protected

Affected areas:

- `POST /documents/form12b`
- `PUT /documents/form12b/:id/status`

Evidence:

- Form12B upload route uses only `filesUpload`, not authentication.
- Form12B approval route has `preHandler: [authenticate]` commented out.
- Both routes use fallback actor ID `68355851969275367d77b3bc`.

Impact:

- Unauthenticated users can submit Form12B data for an employee if they know IDs.
- Unauthenticated users can approve, reject, or request resubmission.
- Audit logs can show the hardcoded fallback user instead of the actual actor.
- TDS processing can be triggered from an untrusted route.

Recommendation:

- Require authentication for upload and status update.
- Upload should allow only the owning employee or admin.
- Status update should be admin-only.
- Remove hardcoded fallback user ID.
- Wrap Form12B status update and tax declaration TDS update in a transaction or compensating job.

Priority: P0

### P0 - Direct Document Fetch by ID Lacks Ownership or Role Authorization

Affected area:

- `GET /documents/:id`
- `documentService.getByIdDocuments`

Evidence:

- Route authenticates the request.
- Service fetches document by `_id` and returns it with populated employee and uploader data.
- No check confirms owner, manager-subordinate relation, or admin role.

Impact:

- Any authenticated user with a document ID can fetch document metadata, `filePath`, audit log, and employee details.
- Since frontend opens raw `filePath`, this can lead to document file exposure too.

Recommendation:

- Centralize document access checks in service layer.
- Enforce:
  - owner access for own documents,
  - manager access only for direct/allowed team,
  - admin access for global documents,
  - category/type-specific visibility rules.
- Add tests for cross-user document access denial.

Priority: P0

### P1 - Admin-Named Document Routes Are Only Authenticated, Not Admin-Authorized

Affected areas:

- `POST /documents/payslip/generate`
- `POST /documents/payslip/send`
- `POST /documents/payslip/admin/upload`
- `POST /documents/payslip/admin/upload/year`
- `POST /documents/admin/upload`
- `GET /documents/admin/uploads`
- `PUT /documents/admin/uploads/:id`
- `PUT /documents/admin/uploads/:id/file`
- `GET /documents/admin/uploads/:id/debug`
- `DELETE /documents/admin/uploads/:id`
- `POST /documents/offer-letter/send`
- `POST /documents/hike-letter/preview`
- `POST /documents/hike-letter/generate-send`

Impact:

- Any logged-in user may be able to upload, list, update, delete, generate, or send sensitive documents if the UI or API is reachable.
- This includes payroll, candidate offers, salary hike letters, and employee lifecycle documents.

Recommendation:

- Add explicit admin or HR role checks to every admin/HR document route.
- Remove temporary debug endpoint or make it admin-only and environment-gated.
- Add route-level tests for staff/manager denial.

Priority: P1

### P1 - Payslip Send Reports Success Even When Email Result Is False

Affected area:

- `documentService.sendPayslipDocuments`

Evidence:

- Service sends email through `emailService.sendPayslipEmails`.
- If `emailResult.success` is false but no exception is thrown, the function still returns recipient status `success`.

Impact:

- Payroll admin can believe payslips were sent when they were not.
- Employees may not receive payslips, while admin sees successful result.

Recommendation:

- Treat `emailResult.success === false` as failed recipient result.
- Persist `emailHistory` with `Sent` or `Failed`.
- Do not mark document `Sent` or `isExport=true` unless email was actually sent.
- Move payslip sending to async job/outbox with retry.

Priority: P1

### P1 - Admin Re-upload Flow Is Broken

Affected areas:

- Frontend `documentsApi.updateAdminDocumentWithFile`
- Backend `PUT /documents/admin/uploads/:id/file`
- `documentService.updateAdminDocumentWithFile`

Evidence:

- Frontend file update calls `/documents/admin/uploads/:id`, but backend file route is `/documents/admin/uploads/:id/file`.
- Backend service constructs a GCP URL and updates `filePath`, but does not call `uploadFileToGCP`.

Impact:

- Re-upload can appear successful while stored file URL points to a non-existent object.
- User may lose trust in document records.
- Old file may remain accessible while DB points to a broken replacement.

Recommendation:

- Fix frontend endpoint path.
- Backend must save temp file, upload to GCP, verify upload result, then update DB.
- Delete old GCP object after new upload and DB update succeeds, or use a safe two-phase replacement flow.

Priority: P1

### P1 - Admin Delete Removes DB Row but Leaves File in GCP

Affected area:

- `DELETE /documents/admin/uploads/:id`

Evidence:

- Route deletes `Document` row.
- GCP deletion is commented out.

Impact:

- Deleted documents may still be accessible by anyone who has the old URL.
- Storage cleanup and compliance deletion expectations are not met.

Recommendation:

- Delete storage object and DB row consistently.
- Prefer soft delete with audit trail for sensitive HR documents, then storage retention policy if required.
- If hard delete is used, do DB and storage cleanup through a controlled service method.

Priority: P1

### P1 - Offer and Hike Letters Are Marked Sent Before Email Delivery Completes

Affected areas:

- `documentService.sendOfferLetter`
- `documentService.generateAndSendHikeLetter`
- `POST /documents/offer-letter/send`
- `POST /documents/hike-letter/generate-send`

Evidence:

- Offer letter creates `Document` with status `Sent`, saves it, then sends email.
- Hike letter generates PDF, creates `Document` with status `Sent`, saves it, then fetches PDF and sends email.
- Hike batch route catches per-employee errors, but already-created DB rows can remain as `Sent`.

Impact:

- DB status can say sent even when email fails.
- Partial batch failures are not durable beyond response payload.
- Retry behavior is manual and ambiguous.

Recommendation:

- Use statuses such as `Generated`, `Queued`, `Sending`, `Sent`, `Failed`.
- Persist each dispatch attempt and message ID.
- Use background job/outbox for email dispatch.
- Make generate/send idempotent using dispatch ID plus employee ID.

Priority: P1

### P1 - Heavy Document Generation and Email Work Runs Synchronously

Affected areas:

- Payslip generation
- Payslip email sending
- Form16 ZIP processing
- Form12BB DOCX to PDF conversion
- Hike letter PDF generation
- Offer/hike email dispatch

Impact:

- Large batches can time out.
- Request threads are occupied by PDF rendering, GCP upload, and SMTP calls.
- Failures are hard to retry safely.
- User cannot reliably resume or inspect progress for batch jobs.

Recommendation:

- Introduce background jobs or an outbox table for:
  - bulk payslip generation,
  - bulk email sending,
  - Form16 ZIP processing,
  - hike letter batch generation,
  - Form12BB generation.
- API should return a job ID.
- Frontend should poll job status or subscribe to progress.
- Persist per-item status and retry metadata.

Priority: P1

### P1 - Form12BB Model Validator and Service Payload Do Not Match

Affected areas:

- `document.model.ts`
- `documentService.generateForm12BB`

Evidence:

- Model validator requires `metadata.form12BB.employeeId`.
- Service saves `metadata.form12BB` without `employeeId`.

Impact:

- Form12BB generation can fail after PDF generation and GCP upload.
- Orphaned PDFs can be created.
- Admin sees generation failure even though storage already has output.

Recommendation:

- Either remove `metadata.form12BB.employeeId` requirement from validator or write it consistently.
- Validate model payload before uploading PDF where possible.
- Clean up GCP object if DB save fails.

Priority: P1

### P1 - Form12BB Preview Toggle Has No Admin Role Check

Affected area:

- `PUT /documents/form12bb/:id/preview-status`

Impact:

- Any authenticated user may toggle whether a Form12BB is visible to employees, if they know document ID.

Recommendation:

- Admin-only authorization.
- Ensure document belongs to the intended employee or scope.
- Audit actor and previous/new preview value.

Priority: P1

### P1 - FNF Settlement Documents Are Not Properly Integrated in Document Contracts

Affected areas:

- `IDocumentQuery`
- `GET /documents/:id` schema
- `Document` model
- `documentService.deleteDocument`

Evidence:

- Model supports type `FNF Letter` and category `Settlement`.
- Route query interface omits `FNF Letter` and `Settlement`.
- Delete service treats Settlement as deletable but does not require admin role or owner check.

Impact:

- FNF letters may not appear correctly in document hub or admin document queries.
- Any authenticated user may delete settlement documents if they know the ID.

Recommendation:

- Add `FNF Letter` and `Settlement` to query contracts where intended.
- Restrict settlement document deletion to admin-only or settlement workflow only.
- Prefer downloading FNF through the final settlement backend streaming endpoint, not direct document file URL.

Priority: P1

### P2 - Certificate Verification Role Check Is Case-Sensitive

Affected area:

- `PATCH /documents/certifications/:id/verify`

Evidence:

- Route checks `adminUser?.role !== 'admin'`.
- Other route checks often normalize with `.toLowerCase()`.

Impact:

- Admin verification can fail if role is stored as `ADMIN`.

Recommendation:

- Normalize role comparisons consistently.
- Add tests for role casing.

Priority: P2

### P2 - Employee Skill Certificate Delete Action Is Hidden

Affected area:

- `getCertificateActions`

Evidence:

- Frontend checks `certificateType === "skill"`.
- Backend stores certificate type as `Skill`.

Impact:

- Employees may not see the delete action for their own skill certificates.

Recommendation:

- Match enum casing or normalize before comparison.

Priority: P2

### P2 - My Payslip Default Month Is Zero-Based

Affected area:

- `routes/my/payslips/+page.svelte`

Evidence:

- `selectedMonth = currentDate.getMonth()`
- API expects month `1-12`.

Impact:

- The page can load the wrong month by default.
- In January, it can request month `0`.

Recommendation:

- Use `new Date().getMonth() + 1`.
- Add a defensive frontend/backend month validation message.

Priority: P2

### P2 - Document Hub Calls Missing API Method

Affected area:

- `routes/my/document-hub/+page.svelte`

Evidence:

- Calls `documentsApi.getDocumentById(docId)`.
- API wrapper exposes `getById`, not `getDocumentById`.

Impact:

- Preview/edit flow can break on this page.

Recommendation:

- Use `documentsApi.getById`.
- Add component-level smoke test for preview/edit path.

Priority: P2

## Security Recommendations

Immediate:

- Restore authentication on all unauthenticated document routes.
- Add admin or HR role checks to all admin/letter/tax release routes.
- Enforce owner/team/admin authorization in `GET /documents/:id`.
- Remove hardcoded fallback user IDs.
- Remove or restrict debug endpoints.

Near-term:

- Stop returning raw permanent GCP URLs for sensitive HR documents.
- Use backend download proxy or signed short-lived URLs.
- Add audit logs for view/download, not only upload/send.
- Add route tests for cross-user document access.

## Async and Task Handling Recommendations

Move these workflows to background jobs or outbox processing:

- Bulk payslip generation.
- Payslip email dispatch.
- Form16 ZIP upload and per-PDF processing.
- Form12BB PDF generation.
- Offer letter dispatch.
- Hike letter preview/generation/email dispatch.

Expected job behavior:

- API returns `jobId`.
- Job stores item-level status: pending, processing, success, failed.
- Email dispatch stores message ID, retry count, last error.
- Document status should transition only after side effects complete.
- Re-running a job should be idempotent by employee, document type, period, and dispatch ID.

## Storage and File Handling Recommendations

- Upload file before updating DB references.
- Delete old storage object only after new DB state is saved.
- On DB save failure after upload, clean up newly uploaded file.
- On delete, remove or revoke the storage object.
- Avoid permanent public URLs for payroll, tax, identity, offer, hike, and FNF documents.

## UX Recommendations

- Show job progress for long-running ZIP/PDF/email tasks.
- For partial success, show per-employee or per-file results from durable backend state.
- Avoid success toasts for placeholder or unimplemented actions.
- Show clear status badges: Generated, Queued, Sent, Failed, Preview Enabled.
- Do not expose raw file path text in admin UI unless needed for debugging and restricted.

## Deferred Cleanup

These are worth fixing but are less urgent than the core issues above:

- Remove excessive debug `console.log` output from document routes and services.
- Normalize response shapes across document APIs.
- Consolidate duplicate document helper methods.
- Clean up stale comments and route documentation blocks.
- Align frontend TypeScript document enums with backend model enums.

## Recommended Fix Order

1. Lock down P0 routes: payslip access, Form16 upload, Form12B upload/approval.
2. Add authorization to `GET /documents/:id` and all admin-named routes.
3. Replace direct permanent file URL access for sensitive documents.
4. Fix admin re-upload path and actual GCP upload behavior.
5. Fix email/send state handling for payslips, offer letters, and hike letters.
6. Add async job/outbox handling for bulk document generation and email.
7. Fix Form12BB schema mismatch and preview authorization.
8. Integrate FNF documents into query contracts safely.
9. Address frontend UX mismatches.

