# Asset Management System (AMS) – Scope Document

## 1. Purpose

This document defines the scope of the Asset Management System (AMS).

It identifies:

- What the AMS must cover
- What business capabilities are included
- What user roles are covered
- What workflows and controls must be supported

This scope document does not introduce capabilities beyond the approved AMS design.

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
- Reporting, operational monitoring, and search visibility

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
- Dependent picklists
- Asset control classification as `Trackable` or `Consumable`
- Serial number applicability rules
- Branch applicability rules where needed
- Service applicability rules
- Reservation applicability rules
- Approval applicability by asset type
- SLA or aging threshold definition where needed
- Default valuation or reference value rules where needed

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
- Operational hold or lock mechanism to prevent conflicting parallel actions during sensitive workflows
- Reference value capture where governed assets require it

Identity rules:

- Internal asset ID is mandatory
- Internal asset ID is organization-wide unique and must never change, even if the asset moves across branches
- Internal asset ID remains the primary identity
- Internal asset ID must remain unchanged across transfers
- Asset transfer must not create a new identity or reset uniqueness
- External identifiers follow asset-type-specific uniqueness rules
- Uniqueness policy must be defined by identifier type at asset-type level
- Movable assets must not depend on branch-only uniqueness where transfer can create identity conflict

### 4.3 Asset Control, Condition & Ownership

The AMS must support:

- Asset control classification as `Trackable` or `Consumable`
- Controlled condition values for trackable assets such as `New`, `Good`, `Usable`, `Damaged`, and `Critical`
- Condition-driven service, reassignment, recovery, and scrap decisions
- Consumable issue through stock receipt and stock issue
- Reduced lifecycle handling for consumables by default
- One active ownership or custody layer at a time

Custody layers covered:

- Organization stock
- Branch stock
- Sub-location stock
- Employee custody
- Service custody
- Transit custody
- Scrap or disposal holding

### 4.4 Lifecycle & State Control

The AMS must support a controlled lifecycle with the following core states:

1. Procured / Added
2. Available
3. Reserved
4. Assigned
5. Under Service
6. Returned
7. Idle
8. Transferred
9. Scrapped

This area includes:

- Controlled state transitions
- Validation before state changes
- Prevention of invalid actions
- Distinction between state, status, and sub-status
- Operational hold or lock control during sensitive workflows
- Prevention of conflicting parallel actions on the same asset

Lifecycle control must support:

- State as the primary controlled lifecycle stage
- Status as the operational business condition within a state
- Sub-status as finer workflow progress detail for service, transfer, or approval-driven activities

### 4.5 Allocation, Reservation & Recovery

The AMS must support:

- Admin-driven assignment
- Onboarding assignment
- Request-based assignment
- Reservation before handover
- Reservation expiry, release, and notification handling
- Bulk allocation
- Asset return processing
- Partial return handling
- Missing component accountability
- Reallocation after recovery
- Offboarding asset recovery

### 4.6 Request & Approval Handling

The AMS must support:

- New asset requests
- Additional accessory requests
- Replacement requests
- Repair or service requests
- Return requests
- Lost or damaged asset declarations
- Approval routing
- Approval aging visibility
- Exception handling
- Closure tracking with outcome history

### 4.7 Service & Backup Handling

The AMS must support:

- Service intake and tracking
- Service provider or service location capture
- Service status tracking
- Service SLA tracking
- SLA-based notification and escalation handling
- Temporary backup asset issue
- Backup asset recovery
- Reassignment after service outcome
- Separation of backup handling from the main lifecycle
- Backup handling as an operational process, not a separate lifecycle state
- Temporary and permanent backup allocations must be distinguishable
- Backup stock must remain visible separately from regular available stock

### 4.8 Transfer & Movement

The AMS must support:

- Inter-branch transfer
- Intra-branch location movement
- Bulk transfer
- Receipt confirmation
- Transfer approval where required
- Transfer aging visibility
- Transfer sub-status visibility such as `Initiated`, `Dispatched`, `In Transit`, and `Received`

### 4.9 Loss, Damage & Recovery Accountability

The AMS must support:

- Lost asset reporting
- Damaged asset reporting
- Responsibility verification
- Recovery reference value and final recovery amount recording
- Penalty or recovery tracking
- Blocking uncontrolled reuse of affected assets
- Distinction between monetary recovery and physical asset recovery

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

- Role-based eligibility
- Department-based eligibility
- Branch-specific entitlement
- Branch-specific restrictions
- Maximum quantity by asset type
- Approval requirement by asset value or asset type
- Replacement eligibility
- Backup issue priority
- Return requirement during offboarding
- Reservation eligibility and duration
- Override eligibility for policy exceptions

The AMS must also support policy precedence in the following order:

1. Organization or global restriction
2. Branch or local restriction
3. Role or department entitlement
4. Request-specific approved exception

### 4.12 Reporting, Search & Visibility

The AMS must support visibility of:

- Branch stock
- Reserved stock
- Assigned assets
- Assigned assets by employee
- Assigned assets by branch
- Idle assets
- Backup stock
- Assets under service
- Assets in transit
- Lost assets
- Damaged assets
- Scrapped assets
- Aging views for asset, approval, transfer, and service operations
- Utilization and failure trends

The AMS must also support search by:

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
- Raise service, loss, and damage declarations
- Track request status
- Confirm receipt where applicable
- Return assets

### 5.4 Optional Governance Roles

Included if business chooses to enable them:

- Approver
- Service Coordinator
- Auditor or Compliance User

---

## 6. Core Workflows

The following end-to-end workflows are covered:

1. Asset procurement or asset addition to inventory
2. Onboarding asset reservation and assignment
3. Admin manual assignment
4. Employee request-based asset issue or replacement
5. Fault reporting and service processing
6. Backup asset issue and recovery
7. Asset return and validation
8. Offboarding recovery
9. Branch transfer
10. Intra-branch location movement
11. Scrap approval and disposal
12. Valuation and recovery amount handling
13. Bulk operations
14. SLA, aging, notification, and escalation monitoring
15. Inventory audit and reconciliation
16. Loss and damage accountability closure

---

## 7. Business Controls

The AMS must enforce the following business controls:

- No asset assignment outside allowed lifecycle conditions
- No conflicting active custody
- No transfer of assigned or under-service assets
- No scrapping of assets with unresolved accountability
- No deletion of governed operational history
- No reuse of lost or scrapped assets without proper business closure
- No conflicting parallel actions where an operational hold applies
- Approval, exception, and override traceability
- Policy-based eligibility and quantity controls
- Reservation expiry and release control
- Uniqueness control for identity values according to asset type

---

## 8. Business Events

The AMS includes event-based business history for major actions, including:

- `AssetCreated`
- `AssetReserved`
- `AssetAssigned`
- `AssetReturned`
- `AssetSentForService`
- `AssetServiceUpdated`
- `BackupAssetIssued`
- `BackupAssetRecovered`
- `AssetTransferred`
- `TransferReceived`
- `LossReported`
- `DamageReported`
- `RecoveryAmountRecorded`
- `AssetFoundAfterLoss`
- `AssetScrapped`
- `AssetArchived`

These events are treated as business records and audit drivers. This document does not define their technical storage or processing architecture.

---

## 9. Scope Constraints

The AMS is defined with the following boundaries:

- The AMS is designed for one organization with multiple branches
- Asset handling is primarily centered on individually controlled assets
- Consumable support exists, but consumables do not drive the core lifecycle model
- Bundling is not part of the current scope
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
- Support real operational use without changing the approved AMS business model
