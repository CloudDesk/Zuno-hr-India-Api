# AMS Functional Clarifications

This document captures requirement clarifications for the Asset Management System (AMS). These points are intended to reduce ambiguity in the scope and support further review and refinement.

---

## 1. Asset Identity and Identification

Each asset is uniquely identified by:

- A system-generated internal asset ID
- A system-managed external identifier

Business rules:

- The internal asset ID is the primary and immutable identity.
- The external identifier is managed at system level and is not user-configurable.
- Asset identity cannot be edited after creation.
- Asset identity must remain constant across assignment, transfer, service, and lifecycle transitions.

---

## 2. Asset Type Configuration

Asset types support dynamic field configuration.

Admin can:

- Define custom fields
- Configure field types as `Text`, `Number`, `Date`, or `Picklist`
- Mark fields as required or optional

Field structure rules:

- Field definitions can be extended.
- Fields already in use cannot be removed.

System control:

- `Condition Applicable` is a system-controlled `Yes/No` setting.
- If enabled, condition values must be captured.

Supported condition values:

- `New`
- `Good`
- `Usable`
- `Damaged`
- `Critical`

---

## 3. Lifecycle and State Control

Core asset states:

1. `Procured / Added`
2. `Available`
3. `Assigned`
4. `Under Service`
5. `Returned`
6. `Idle`
7. `Transferred`
8. `Scrapped`
9. `Lost`

State behavior:

- `Available` means ready for immediate allocation.
- `Idle` means available stock with lower allocation priority.

Service flow:

`Assigned` -> `Under Service` -> `Assigned` or `Available` or `Idle`

Control rules:

- State transitions must follow the defined workflow.
- Admin cannot force invalid state overrides.
- Every asset must always have one valid state.

---

## 4. Ownership and Custody

Ownership rules:

- Assets can be assigned only to employees.
- Asset location is derived from employee mapping.

Supported custody types:

- Employee custody
- Service custody
- Transit custody
- Stock custody in `Available` or `Idle`

Control rules:

- Only one active owner or custodian can exist at a time.
- Service custody is temporary and system-controlled.

---

## 5. Reservation

Reservation logic is not required in the current phase.

Clarification:

- Reservation is not needed for now.
- No reservation or concurrency-specific reservation flow is part of the current clarified scope.
- If reservation is needed later, the logic must be defined separately and the scope document can be updated based on that future clarification.

---

## 6. Allocation and Recovery

Allocation rules:

- One asset can be assigned to one employee.
- Asset bundling is not in scope.

Return rules:

- Condition capture is enforced based on policy.
- Post-return state must be either `Available` or `Idle`.

Scope boundary:

- Offboarding is not handled in the current scope.

---

## 7. Request and Approval

Supported request types:

- Service request
- Loss or damage declaration

Approval rules:

- Approval is single-level.
- Approval routing is role-based.
- Approval is required only for:
  - Repair or service request
  - Loss or damage declaration
  - Transfer approval
  - Scrap approval
- Other approval flows are not needed for now.

Rejection handling:

- Rejected requests are automatically closed.
- Rejected requests cannot be reopened.

---

## 8. Service and Backup Handling

Service rules:

- A serviced asset moves to `Under Service`.
- Custody shifts to system or service custody while under service.

Backup asset rules:

- Backup assignment is temporary only.
- Only one backup asset is allowed at a time.

Post-service outcomes:

- Reassign the original asset to the employee
- Move the asset to `Available`
- Move the asset to `Idle`
- Replace the asset if it is not repairable
- Convert the backup assignment to a permanent assignment

---

## 9. Transfer and Movement

Transfer rules:

- During transfer, custody moves to a system-controlled transit state.
- Transfer approval is in scope.

SLA handling:

- Delay in receipt must trigger an escalation notification.

---

## 10. Loss and Damage Handling

Lost asset rules:

- A lost asset moves to `Lost`.
- A lost asset cannot re-enter the active lifecycle.

Recovery support:

- One-time recovery
- Installment recovery

Evidence requirement:

- The system must support proof or document attachment.

---

## 11. Audit and Governance

The system must not allow editing of past records.

Correction rules:

- Corrections must be additive audit entries.
- Each correction must capture the old value, new value, actor, timestamp, and reason.

Override rule:

- Override is allowed only for `Super Admin`.

---

## 12. Policy Engine

Policies are UI-configurable.

Supported policy types:

- Recovery policy
- Eligibility rules
- SLA rules

Enforcement:

- Policy violations can be overridden only by `Super Admin`.

---

## 13. Notifications

Notification channel:

- Email only

Trigger events:

- Asset assignment
- Approval actions
- SLA breaches

---

## 14. Bulk Operations

Upload channel:

- Excel

Validation rules:

- If any row fails validation, the entire file is rejected.
- The system must display row-level error details.
- The user must re-upload a corrected file.

---

## 15. Reporting and Dashboard

Reporting in the current scope should be treated as dashboard metrics.

Dashboard metrics:

- Available assets
- Assigned assets
- Lost or damaged assets
- Assets under service
- Assets in transit

Additional dashboard views:

- Branch-wise assets
- Employee-wise assets
- Aging reports
