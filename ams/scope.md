# Asset Management System (AMS) – Scope Document

## 1. Purpose

This document defines the scope of the Asset Management System (AMS).

It identifies:

- What the AMS must cover
- What business capabilities are included
- What user roles are covered
- What workflows and controls must be supported

This scope document does not introduce capabilities beyond the current AMS scope definition.

---

## 2. Scope Objective

The AMS scope is to provide a controlled business system for managing company assets across branches through their full operational lifecycle, including:

- Asset setup and configuration
- Asset intake and stock visibility
- Employee assignment and recovery
- Service and temporary replacement handling
- Branch and location movement
- Loss, damage, and recovery accountability
- Approval, audit, and policy enforcement
- Dashboard metrics and operational visibility

The system is intended for one organization operating across multiple branches and locations.

---

## 3. Business Principles

The AMS scope is governed by the following business principles:

1. Every asset must be trackable, even if it has no manufacturer serial number.
2. Asset type and asset instance must always remain distinct.
3. Every asset must have one valid current state at any time.
4. Every operational action must follow an allowed workflow.
5. Every asset must have only one active owner or custodian at a time.
6. Every branch must have real-time inventory visibility.
7. Every approval-sensitive action must be governed and auditable.
8. Asset history must be permanent and never reset due to service, transfer, return, or reuse.

---

## 4. Business Areas

### 4.1 Asset Master & Configuration

The AMS must support:

- Asset category definition
- Asset type definition
- Configurable attributes per asset type
- Mandatory and optional fields
- Custom field types as `Text`, `Number`, `Date`, and `Picklist`
- Condition applicability as a system-controlled setting
- Service applicability rules
- SLA or aging threshold definition where needed

### 4.2 Asset Inventory & Identity

The AMS must support:

- Creation of asset instances from procurement or existing stock
- System-generated internal asset ID
- Asset identity capture such as serial number, IMEI, card number, vendor code, barcode, or QR code where applicable
- Ability to track assets even when no manufacturer serial number exists
- Branch and location ownership
- Condition tracking
- Condition history where required
- Stock classification visibility

Identity rules:

- Internal asset ID is mandatory
- Internal asset ID is organization-wide unique and must never change, even if the asset moves across branches
- Internal asset ID remains the primary identity
- Internal asset ID must remain unchanged across transfers
- Asset transfer must not create a new identity or reset uniqueness
- External identifier is system-managed and not user-configurable
- Asset identity cannot be edited after creation

### 4.3 Asset Control, Condition & Ownership

The AMS must support:

- Controlled condition values such as `New`, `Good`, `Usable`, `Damaged`, and `Critical`
- Condition-driven service, reassignment, recovery, and scrap decisions
- One active ownership or custody layer at a time

Custody layers covered:

- Employee custody
- Service custody
- Transit custody
- Stock custody in `Available`

### 4.4 Lifecycle & State Control

The AMS must support a controlled lifecycle with the following core states:

1. `Available`
2. `Assigned`
3. `Service`
4. `Transfer`
5. `Scrapped`
6. `Lost`
7. `Archive`

This area includes:

- Controlled state transitions
- Validation before state changes
- Prevention of invalid actions
- Distinction between state and status
- Prevention of invalid state override

Lifecycle control must support:

- State as the primary controlled lifecycle stage
- Status as the current business condition or progress marker within a state
- Service flow of `Assigned` -> `Service` -> `Assigned` or `Available`

State meaning:

- `Available` means the asset is ready for allocation.
- `Assigned` means the asset is currently issued to an employee.
- `Service` means the asset is under repair or service in service custody.
- `Transfer` means the asset is in branch transfer movement.
- `Scrapped` means the asset is permanently retired from use.
- `Lost` means the asset is marked lost and cannot re-enter the active lifecycle after recovery is completed.
- `Archive` means the asset is retained for history and should not appear as active allocatable stock.

Examples:

- State: `Service`
- Status: `Approved for Service`, `Sent to Vendor`, `Repair In Progress`, `Ready for Return`
- State: `Transfer`
- Status: `Initiated`, `Dispatched`, `In Transit`, `Received`

### 4.5 Allocation & Recovery

The AMS must support:

- Admin-driven assignment
- Employee acceptance after assignment as receipt confirmation
- Asset return processing
- Reallocation after recovery
- Post-return state handling into `Available`

Current scope clarification:

- Reservation logic is not required in the current phase
- Offboarding is not handled in the current scope
- Asset bundling is not part of the current scope
- Employee acceptance is a workflow confirmation and not a separate lifecycle state

### 4.6 Request & Approval Handling

The AMS must support:

- Asset requests by employee
- Repair or service requests
- Lost or damaged asset declarations
- Requested asset type or specification capture
- Admin review and assignment against request
- Approval routing
- Single-level approval
- Role-based approval routing
- Transfer approval
- Scrap approval
- Automatic closure of asset request after assignment
- Automatic closure of rejected requests
- Rejected requests cannot be reopened

Current scope clarification:

- Other approval flows are not needed for now

### 4.7 Service & Backup Handling

The AMS must support:

- Service intake and tracking
- Service status tracking against the service ticket
- Service custody while the asset is under service
- Service history updates by admin
- Temporary backup asset issue
- Temporary backup asset issue when employee forgets the assigned asset
- Backup asset recovery
- Return of serviced asset to `Available` after validation
- Reassignment of serviced asset to employee where required

Current scope clarification:

- Temporary backup issue is an operational process and not a separate lifecycle state
- The original assigned asset remains unchanged when temporary backup is issued
- Temporary backup can be issued for short-term operational use and must be recovered after use

### 4.8 Transfer & Movement

The AMS must support:

- Inter-branch transfer
- Receipt confirmation
- Transfer approval
- Transfer aging visibility
- Transit custody during transfer

### 4.9 Loss, Damage & Recovery Accountability

The AMS must support:

- Lost asset reporting
- Damaged asset reporting
- Responsibility verification
- Recovery reference value and final recovery amount recording
- Penalty or recovery tracking
- Blocking uncontrolled reuse of affected assets
- Distinction between monetary recovery and physical asset recovery
- Proof or document attachment for recovery handling
- Closure of lost ticket as `Found` if the asset is found before recovery completion
- Cancellation of recovery process if the asset is found before recovery completion
- Return of found asset to `Available` or `Assigned` after admin verification

### 4.10 Governance, Audit & Compliance

The AMS must support:

- Approval logs
- Action logs
- State transition history
- Ownership history
- Scrap or disposal approval trace
- Policy compliance monitoring
- Exception tracking
- Override tracking with reason capture
- Correction handling without deleting governed history, while retaining original value, corrected value, actor, timestamp, and reason in audit history
- Notification and escalation visibility
- Business event-based history tracking

### 4.11 Policy & Rule Control

The AMS must support policy-driven business control for:

- Recovery policy
- Eligibility rules
- SLA rules
- Override eligibility for policy exceptions

### 4.12 Reporting, Dashboard & Visibility

The AMS must support dashboard metrics and visibility of:

- Available assets
- Assigned assets
- Lost or damaged assets
- Assets in `Service`
- Assets in `Transfer`

The AMS must also support additional views for:

- Branch-wise assets
- Employee-wise assets
- Aging reports

The AMS may support search visibility for:

- Branch stock
- Assigned assets
- Backup stock
- Lost assets
- Damaged assets
- Scrapped assets

Search keys:

- Asset ID
- Serial number or IMEI
- Employee
- Branch or location
- Asset type
- Status
- Request or service reference where applicable

### 4.13 Inventory Audit & Reconciliation

The AMS must support:

- Scheduled physical audit
- Ad hoc physical audit
- Verification against system stock
- Mismatch detection
- Condition mismatch tracking
- Controlled reconciliation or adjustment with approval
- Retention of audit history

### 4.14 Archive & Scrap Control

The AMS must support:

- Scrap workflow for permanently retired assets
- Archive concept for non-operational but historically retained assets
- Separation between archived assets and scrapped assets
- Archived assets must not appear as normal allocatable stock
- Archive preserves long-term history without treating the asset as operationally active
- Scrapped assets must never return to active stock
- Prevention of reactivation of scrapped assets

---

## 5. User Roles

Roles in the AMS are dynamically created and managed based on business needs and access control requirements.

### 5.1 Super Admin

Responsibilities:

- Global configuration
- Policy definition
- Approval rule setup
- Lifecycle rule setup
- Cross-branch visibility
- Governance monitoring

### 5.2 Branch Admin

Responsibilities:

- Asset intake and receiving
- Assignment and recovery
- Request handling
- Service handling
- Transfer handling
- Branch stock monitoring
- Physical verification participation

### 5.3 Employee

Responsibilities:

- View assigned assets
- Raise requests
- Raise asset request with needed type or specification
- Raise service, loss, and damage declarations
- Track request status
- Confirm receipt and acceptance of assigned asset
- Return assets

---

## 6. Core Workflows

The following end-to-end workflows are covered:

1. Asset procurement or asset addition to inventory
2. Admin manual assignment and employee acceptance
3. Employee asset request, assignment, and ticket closure
4. Fault reporting and service processing
5. Temporary backup asset issue and recovery
6. Asset return and validation
7. Branch transfer
8. Scrap approval and disposal
9. Valuation and recovery amount handling
10. Bulk operations
11. SLA, aging, notification, and escalation monitoring
12. Inventory audit and reconciliation
13. Loss and damage accountability closure

---

## 7. Business Controls

The AMS must enforce the following business controls:

- No asset assignment outside allowed lifecycle conditions
- No conflicting active custody
- No transfer of assigned or assets in `Service` state
- No scrapping of assets with unresolved accountability
- No deletion of governed operational history
- No reuse of lost or scrapped assets without proper business closure
- Approval, exception, and override traceability
- Policy-based eligibility and quantity controls
- Uniqueness control for identity values according to asset type

---

## 8. Business Events

The AMS includes event-based business history for major actions, including:

- `AssetCreated`
- `AssetAssigned`
- `AssetSentForService`
- `AssetServiceUpdated`
- `BackupAssetIssued`
- `BackupAssetRecovered`
- `AssetTransferred`
- `TransferReceived`
- `LossReported`
- `DamageReported`
- `RecoveryAmountRecorded`
- `AssetScrapped`
- `AssetArchived`

These events are treated as business records and audit drivers. This document does not define their technical storage or processing architecture.

---

## 9. Scope Constraints

The AMS is defined with the following boundaries:

- The AMS is designed for one organization with multiple branches
- Asset handling is primarily centered on individually controlled assets
- Bundling is not part of the current scope
- Reservation logic is not part of the current scope
- Offboarding workflow handling is not part of the current scope
- Database design, API design, technical architecture, and low-level implementation details are handled separately
- Background processing, locking mechanisms, search indexing, and integration implementation are handled separately
- Multi-company operation, formal asset bundle model, and finance-module behavior are not part of this scope document

---

## 10. Expected Outcome

If the AMS is built within this scope, the business should be able to:

- Define and control asset structures centrally
- Track assets consistently across branches
- Assign, recover, service, transfer, and retire assets through governed workflows
- Apply approval and policy control to sensitive operations
- Hold employees or administrators accountable for loss and damage
- Maintain full auditability and business history
- Monitor branch-wise stock and operational aging
- Support real operational use without changing the current AMS business model
