# Asset Management System (AMS) – Business Design v3

## 1. Purpose

Design a business-complete Asset Management System (AMS) that manages company assets across branches from procurement to final disposal, with strict lifecycle control, operational accountability, and audit-ready governance.

This design focuses only on:

- Business workflows
- Business modules and features
- User roles and responsibilities
- System behavior and business rules

This design does not cover:

- Database design
- API design
- Technical architecture
- Low-level implementation details

---

## 2. Business Objectives

The AMS must enable the organization to:

- Maintain a single source of truth for all assets across branches
- Track every asset throughout its full lifecycle
- Control allocation, recovery, service, transfer, and disposal operations
- Enforce role-based policies and approval workflows
- Provide real-time branch-wise stock visibility
- Preserve complete history with no loss of operational traceability
- Support accountability for loss, damage, misuse, and non-return
- Remain scalable as asset types, branches, policies, and users increase

---

## 3. Business Principles

The system should operate on the following principles:

1. Every asset must be trackable, even if it has no manufacturer serial number.
2. Asset type and asset instance must always remain distinct.
3. Every asset must have one valid current state at any time.
4. Every operational action must follow an allowed workflow.
5. Every asset must have only one active owner or custodian at a time.
6. Every branch must have real-time inventory visibility.
7. Every approval-sensitive action must be governed and auditable.
8. Asset history must be permanent and never reset due to service, transfer, return, or reuse.

---

## 4. Core Business Design

### 4.1 Asset Type vs Asset Instance

This is a critical design separation.

#### Asset Type

Asset Type represents the reusable business definition of an asset category.

Examples:

- Laptop
- Mobile
- CPU
- Monitor
- Access Card
- Mouse
- Headset
- Charger

Asset Type configuration should define:

- Asset name
- Category
- Asset control classification: Trackable or Consumable
- Whether item is individually trackable
- Whether serial number is expected, optional, or not applicable
- Configurable attributes
- Picklists and dependent picklists
- Eligibility rules
- Approval rules
- Service applicability
- Scrap/disposal requirements
- Reservation applicability
- SLA rules where applicable
- Default valuation/reference rules where applicable

#### Asset Instance

Asset Instance represents an actual physical item.

Examples:

- Dell Latitude Laptop assigned to Employee A
- Samsung Mobile in Branch Chennai stock
- Monitor transferred from Bangalore branch to Hyderabad branch

Each asset instance must carry:

- Unique internal asset ID
- Asset type reference
- Current branch/location
- Current owner/custodian
- Current lifecycle state
- Condition
- Condition history where business audit requires it
- Purchase cost or reference value where business requires it
- Allocation and movement history

This separation solves the gap:

- No confusion between asset identity and asset type

---

## 5. Module Breakdown

### 5.1 Asset Master & Configuration

Purpose:
Define reusable business structure for all assets.

Capabilities:

- Create and manage asset categories
- Create and manage asset types
- Define asset control classification by asset type
- Define custom attributes by asset type
- Configure mandatory and optional fields
- Configure dependent picklists
- Define whether serial number is required, optional, or not applicable
- Define whether an asset type is serviceable
- Define whether an asset type requires approval for allocation, transfer, or scrap
- Define branch applicability if some asset types are location-specific
- Define whether reservation is allowed for the asset type
- Define SLA or aging thresholds where business needs them

Examples:

- Laptop: Serial No, RAM, Processor, Brand, Warranty
- Mobile: IMEI, OS, SIM Type
- Monitor: Size, Resolution
- Access Card: Card No, Access Zone
- Mouse: Model, Type, Condition

Key business rule:

- Asset structure is configured once and reused everywhere
- Asset names do not determine control level by themselves; the configured asset type behavior does

### 5.2 Asset Inventory

Purpose:
Maintain the live register of all physical assets.

Capabilities:

- Add procured assets
- Add existing assets migrated from legacy records
- Support bulk asset intake
- Generate system asset IDs
- Capture identity details and current branch ownership
- Track condition and stock classification
- Track operational hold or lock status where actions are temporarily blocked
- Track reference value for governed assets where required
- Maintain stock by branch/location

Key business rule:

- Every physical asset that the company wants to control must exist as an asset instance in inventory

### 5.3 Asset Lifecycle Engine

Purpose:
Control valid state transitions and prevent inconsistent actions.

Capabilities:

- Enforce allowed lifecycle stages
- Block invalid transitions
- Trigger required validations before status changes
- Preserve traceable state history

This solves the gap:

- No lifecycle/state management

### 5.4 Allocation & Recovery Management

Purpose:
Manage assignment of assets to employees and return of assets back to stock.

Capabilities:

- Admin-driven allocation
- Policy-based allocation
- Onboarding allocation
- Request-based allocation
- Reservation before handover where applicable
- Bulk allocation
- Return and recovery processing
- Partial return and missing-component handling
- Reallocation after return

### 5.5 Request & Approval Management

Purpose:
Control employee requests and approval-led asset operations.

Capabilities:

- Raise asset requests
- Raise issue/repair requests
- Raise replacement requests
- Raise return requests
- Raise loss/damage declarations
- Route approvals based on rules
- Track request aging and approval SLA status
- Track request progress end-to-end

This solves the gaps:

- No approval and audit control
- No allocation policy rules

### 5.6 Service & Replacement Management

Purpose:
Manage faulty assets, repairs, vendor servicing, and temporary replacement handling.

Capabilities:

- Send asset for service
- Record service provider/location
- Track service status
- Track service aging and service SLA status
- Allocate backup asset
- Recover backup after original asset returns
- Reassign original or replacement asset based on outcome

### 5.7 Asset Movement Management

Purpose:
Handle branch and location movement while preserving identity and history.

Capabilities:

- Inter-branch transfer
- Intra-branch location movement
- Bulk transfer
- Transit tracking
- Transfer approvals
- Track transfer aging and receipt delays
- Receipt confirmation at destination

This solves the gap:

- No stock visibility per branch when assets move

### 5.8 Loss, Damage & Accountability

Purpose:
Ensure responsibility is captured when assets are lost, damaged, or not returned.

Capabilities:

- Report lost asset
- Report damaged asset
- Verify responsibility
- Record accountable party
- Record recovery reference value and final recovery amount
- Track penalty/recovery process
- Prevent uncontrolled reuse

This solves the gap:

- No loss/damage accountability

### 5.9 Governance, Audit & Compliance

Purpose:
Provide operational control, traceability, and policy enforcement.

Capabilities:

- Approval logs
- Action logs
- State transition history
- Ownership history
- Exception tracking
- Policy compliance monitoring
- Scrap/disposal approval trace
- Override history with mandatory reason capture
- Notification and escalation rules
- Correction history for erroneous entries without deleting audit trail

### 5.10 Reporting & Operational Visibility

Purpose:
Give decision-makers and branch operators real-time visibility.

Capabilities:

- Stock by branch
- Assigned assets by employee
- Idle assets
- Backup stock
- Assets in service
- Assets in transit
- Lost/damaged assets
- Scrap summary
- Asset aging
- Approval aging
- Transfer aging
- Utilization trends
- Failure/service trends
- Search by asset ID, serial/IMEI, employee, branch, and status

---

## 6. User Roles & Responsibilities

### 6.1 Super Admin

Responsibilities:

- Define global asset structure
- Configure categories, types, attributes, and picklists
- Define lifecycle rules
- Define policy rules and approval rules
- Define branch access boundaries
- Monitor organization-wide inventory and compliance
- Approve sensitive actions where required
- Review audit and exception reports

Access scope:

- Full system visibility across all branches

### 6.2 Branch Admin

Responsibilities:

- Add and receive branch assets
- Allocate and recover assets within branch scope
- Review and process employee requests
- Send assets for service
- Manage backup stock
- Initiate or receive branch transfers
- Update asset condition upon return/receipt
- Report stock shortages and discrepancies

Access scope:

- Only assets, employees, requests, and stock belonging to assigned branch or permitted locations

### 6.3 Employee

Responsibilities:

- View assigned assets
- View request history
- Raise asset requests
- Raise repair/replacement requests
- Declare lost or damaged assets
- Confirm receipt where required
- Return assets during transfer, replacement, or exit

Access scope:

- Only own assets and own requests

### 6.4 Optional Governance Roles

If the business requires tighter control, the following roles can be layered without changing core design:

- Approver: approves requests, transfers, or scrap actions
- Service Coordinator: manages repair/vendor flows
- Auditor/Compliance User: read-only access to history, logs, and policy exceptions

---

## 7. Asset Identity & Tracking Rules

### 7.1 Identity Rules

Every asset instance must have:

- A mandatory system-generated internal asset ID
- A linked asset type

Optional or conditional identity values:

- Serial number
- IMEI
- Card number
- Vendor code
- Barcode or QR code

### 7.2 Asset Control Classification

Every asset type should be classified by business control behavior.

Supported classifications:

- Trackable: individually controlled through assignment, return, transfer, service, and audit
- Consumable: issued and monitored through stock control, but not necessarily through full return/service lifecycle

Controlled condition values for trackable assets should typically include:

- New
- Good
- Usable
- Damaged
- Critical

Examples:

- Laptop: Trackable
- Mobile: Trackable
- Access Card: Trackable
- Mouse: Trackable or Consumable depending on company policy
- Charger: Trackable or Consumable depending on company policy

Key business rules:

- The current core AMS scope remains centered on trackable assets such as laptops, mobiles, and access cards
- Consumable support should exist without requiring redesign
- Asset names alone must not force the lifecycle model
- Condition values should be controlled so service, reassignment, recovery, and scrap decisions remain consistent

### 7.3 Consumable Behavior

Consumable asset types should follow lighter operational control than trackable assets.

Expected business behavior:

- Consumables are controlled primarily through stock receipt and stock issue
- Consumables do not require full return, service, reassignment, or scrap lifecycle by default
- Consumable issue should reduce available stock with proper audit history
- If the business wants stricter control for a low-value item, that item should be configured as Trackable instead

### 7.4 Business Handling for Assets Without Serial Numbers

Some assets do not have a manufacturer serial number.

Examples:

- Mouse
- Keyboard
- Charger
- Headset

These assets must still be tracked using:

- Internal asset ID
- Asset type
- Branch ownership
- Condition
- Lifecycle state

Key business rule:

- Serial number is not the primary identity of an asset
- Internal asset ID is the primary identity

This solves the gap:

- No asset identity vs asset type clarity

---

## 8. Ownership & Custody Model

At any point, an asset must belong to exactly one active custody layer.

Possible custody states:

- Organization stock
- Branch stock
- Sub-location stock
- Employee custody
- Service custody
- Transit custody
- Scrap/disposal holding

Key business rule:

- An asset cannot have multiple active custodians at the same time

Examples:

- Available in branch stock: owned by Branch
- Assigned to employee: owned by Employee
- Sent for repair: held in Service custody
- Being transferred: held in Transit custody

---

## 9. Lifecycle Definition

Before defining lifecycle values, the AMS should distinguish clearly between state, status, and sub-status.

- State: the primary controlled lifecycle stage of the asset
- Status: the operational business condition of an asset or process within that state
- Sub-status: finer workflow progress detail inside a status-sensitive process such as transfer, service, or approval

Examples:

- State: `Transferred`
- Sub-status: `Initiated`, `Dispatched`, `In Transit`, `Received`
- State: `Under Service`
- Sub-status: `Sent to Vendor`, `In Repair`, `Ready for Return`, `Closed`

### 9.1 Standard Lifecycle States

The AMS should maintain a strict controlled lifecycle for every asset:

1. Procured / Added
2. Available (In Stock)
3. Reserved
4. Assigned
5. Under Service
6. Returned
7. Idle
8. Transferred
9. Scrapped

### 9.2 Business Meaning of Each State

#### Procured / Added

Asset has been created in the system but is not yet active for assignment until required validations are complete.

#### Available (In Stock)

Asset is ready and eligible for allocation in a branch/location.

Available stock may be further classified for operational visibility, such as:

- General available stock
- Backup reserved pool

#### Reserved

Asset is temporarily blocked for a known onboarding case, request fulfillment, or planned handover, but is not yet in employee custody.

#### Assigned

Asset is in employee custody and considered active.

#### Under Service

Asset has been removed from normal use and is under repair, inspection, or maintenance.

#### Returned

Asset has been received back from employee custody and is pending validation, quality check, or next action.

#### Idle

Asset is not allocated and not immediately in use, but is retained as stock, reserve stock, or temporary non-utilized inventory.

#### Transferred

Asset is moving between branches or locations and cannot be allocated during the transfer journey.

#### Scrapped

Asset is permanently retired and cannot re-enter inventory.

### 9.3 Controlled Transition Rules

Allowed transitions should be governed through business rules such as:

- Procured / Added -> Available
- Available -> Reserved
- Reserved -> Assigned
- Reserved -> Available
- Available -> Assigned
- Assigned -> Under Service
- Assigned -> Returned
- Under Service -> Available
- Under Service -> Assigned
- Under Service -> Scrapped
- Available -> Transferred
- Transferred -> Available
- Returned -> Available
- Returned -> Idle
- Idle -> Available
- Available -> Scrapped

### 9.4 Mandatory Lifecycle Controls

The system must prevent:

- Allocation of assets that are not Available
- Assignment of assets that are already Reserved for another active workflow
- Transfer of assets that are assigned or under service
- Scrapping of assets that are still assigned or under unresolved accountability
- Direct skipping of mandatory steps
- Reuse of lost or scrapped assets
- Reserved assets remaining blocked indefinitely without release or expiry handling
- Parallel conflicting actions on the same asset when it is under an active operational hold

### 9.5 Operational Hold / Lock Control

To prevent conflicting business actions, the AMS should support temporary operational hold or lock behavior on assets during sensitive workflows.

Illustrative hold scenarios:

- Approval-sensitive allocation in progress
- Transfer initiation in progress
- Service intake or service closure processing
- Reconciliation adjustment under review

Business rules:

- A held asset cannot be processed through another conflicting action until the active workflow is resolved or released
- Operational hold should be visible to admins with reason and owner of the active workflow
- Hold behavior is a control mechanism, not a separate lifecycle state

This solves the gap:

- No lifecycle/state management

---

## 10. End-to-End Business Workflows

### 10.1 Procurement / Asset Addition Workflow

Business flow:

1. Asset is procured or manually added from existing stock
2. Branch/location ownership is assigned
3. Asset type details and configured attributes are recorded
4. Asset ID is generated
5. Identity details are validated
6. Asset enters `Procured / Added`
7. After validation, asset becomes `Available`

Business validations:

- Asset type must exist
- Mandatory attributes must be completed
- Duplicate unique identity values must be blocked where relevant
- Branch/location must be known
- If no serial or external identity exists, the system should still allow controlled creation using internal asset ID, while flagging suspicious duplicates for admin review where business signals overlap

### 10.2 Onboarding Allocation Workflow

Business flow:

1. Employee joins branch
2. System checks role/department-based eligibility
3. Branch Admin identifies required asset list
4. Assets are reserved from branch stock
5. Reservation is recorded for the employee or onboarding case
6. Employee receives handover
7. Asset state moves to `Assigned`

Business rules:

- Allocation should follow policy-defined eligibility
- If branch stock is insufficient, shortage must be visible
- High-value assets may require approval before issue
- Reserved assets must expire or be released if handover does not happen
- Reservation duration and expiry behavior should be configurable by business policy

### 10.3 Admin-Driven Manual Allocation Workflow

Business flow:

1. Branch Admin selects employee
2. Admin selects eligible available asset
3. System validates policy and duplicate ownership limits
4. Allocation is approved or directly completed depending on rules
5. Asset moves to `Assigned`, or `Reserved` first if handover is delayed

Use cases:

- Replacement due to promotion
- Asset upgrade
- Corrective reassignment

Reservation control rules:

- Reservation should store reservation owner, reason, start time, and expiry time
- The system should notify responsible users before reservation expiry where configured
- Expired reservations should be released automatically or through controlled admin review, based on policy

### 10.4 Employee Request-Based Allocation Workflow

Request types:

- New asset request
- Additional accessory request
- Replacement request
- Repair/service request
- Return request
- Lost/damaged declaration

Business flow:

1. Employee raises request
2. System validates open duplicate requests
3. Branch Admin reviews request
4. Approval is obtained if required
5. Admin fulfills request through issue, rejection, replacement, or service action
6. Request is closed with outcome history

Business rules:

- Same unresolved request type should not be repeatedly raised for the same asset unless exception is allowed
- Requests must be tied to branch and employee context
- Reason and supporting remarks should be captured for sensitive requests

### 10.5 Fault / Repair / Service Workflow

Business flow:

1. Employee or Admin reports issue
2. Admin verifies problem
3. Asset moves from `Assigned` to `Under Service`
4. Service provider or service location is assigned
5. Repair progress is tracked
6. Temporary backup may be issued
7. After service, asset is either:
   - returned to same employee
   - returned to stock
   - reassigned to another employee
   - marked for scrap if unusable

Business records required:

- Service ticket/reference
- Service location/vendor
- Service start date
- Expected return date
- Service status
- Service SLA status
- Repair outcome
- Cost/recovery remarks if business wants to track them

### 10.6 Backup Asset Workflow

Business flow:

1. Original asset becomes unusable
2. Backup stock availability is checked
3. Backup asset is issued temporarily
4. Backup asset is assigned through a linked temporary replacement transaction
5. Original asset outcome determines final closure:
   - original restored and returned
   - backup retained permanently and original reassigned or scrapped

Business rules:

- Backup asset must remain linked to the original issue
- Temporary and permanent allocations should be distinguishable
- Backup stock should remain visible separately from regular free stock
- Backup handling should not create a separate primary lifecycle state

### 10.7 Return Workflow

Return scenarios:

- Resignation/offboarding
- Asset replacement
- Transfer to another branch
- Temporary return after service backup
- Voluntary return of unused accessory
- Partial return of a linked issued set of assets or accessories

Business flow:

1. Asset is submitted back
2. Admin verifies physical receipt
3. Condition check is performed
4. Accountability exception is recorded if missing/damaged
5. Asset becomes `Returned`
6. Based on evaluation, asset moves to:
   - `Available`
   - `Idle`
   - `Under Service`
   - `Scrapped`

Business rules:

- Partial returns must record exactly what was received and what remains pending
- Missing dependent items such as charger, adapter, or access accessory must enter accountability tracking if they were part of the issued assets

### 10.8 Offboarding Recovery Workflow

Business flow:

1. Employee exit is initiated
2. System identifies all active assets under employee custody
3. Recovery list is generated
4. Assets are returned, verified, and condition-checked
5. Missing/damaged items enter accountability flow
6. Recovery is completed only after closure or approved exception

Business rules:

- Employee cannot be cleared if mandatory asset recovery is unresolved unless override approval exists
- Partial return must be explicitly tracked

### 10.9 Branch Transfer Workflow

Business flow:

1. Source branch initiates transfer request
2. Approval is obtained if policy requires
3. Asset moves to `Transferred`
4. Source branch dispatch is recorded
5. Destination branch receives asset
6. Destination confirms condition and receipt
7. Asset becomes `Available` in destination branch

Business rules:

- Only non-assigned eligible assets can be transferred
- Transfer should not reset asset history
- Transit duration and delayed receipt should be visible
- Transfer operations may use sub-status for clarity, such as Initiated, Dispatched, In Transit, and Received, without changing the primary lifecycle model

### 10.10 Intra-Branch Location Movement Workflow

Examples:

- Main stock room to floor storage
- Floor storage to IT room
- Office location to restricted custody area

Business rule:

- Movement history should still be preserved even if branch does not change

### 10.11 Scrap / Disposal Workflow

Business flow:

1. Asset is identified as non-repairable, obsolete, or uneconomical to maintain
2. Scrap request is initiated
3. Reason and evidence are recorded
4. Approval is obtained
5. Asset is marked `Scrapped`
6. Disposal action is recorded

Mandatory controls:

- Scrapped asset cannot be reactivated
- Scrap must preserve full asset history
- Branch stock must reduce only after approved scrap completion

### 10.12 Valuation & Recovery Reference Workflow

The AMS should support a lightweight value reference layer for business decisions without becoming a finance system.

Business data points:

- Purchase cost or reference cost
- Current recoverable value, if assessed
- Final recovery amount collected or approved
- Reason for value adjustment

Business rules:

- Purchase cost should act as a reference, not as the mandatory final recovery amount
- Admin should be allowed to adjust recovery amount based on condition, age, policy, or case facts
- If recovery amount differs materially from the reference value, reason capture and approval should be required according to policy
- Scrap and loss decisions may use reference value to support review and accountability
- Recovery of money for a lost or damaged asset should be treated as a recovery transaction or case outcome, not as the asset itself being physically recovered

### 10.13 Bulk Operations Workflow

The AMS should support controlled bulk operations for enterprise-scale use cases.

Bulk operation types:

- Bulk asset intake
- Bulk allocation
- Bulk transfer
- Bulk scrap/disposal

Business rules:

- Bulk operations must still validate each asset individually
- Approval-sensitive items in bulk actions must follow the same approval rules as single-item actions
- Invalid items should be rejected with item-level visibility instead of silently failing the whole action
- Audit history must remain asset-specific even when the action is initiated in bulk
- The model should remain practical for high-volume branches handling thousands of assets and frequent bulk actions
- If two or more admins attempt conflicting actions on the same asset, the first valid completed action should prevail and later conflicting actions must be blocked against the latest state

### 10.14 SLA, Aging, Notification & Escalation Workflow

The AMS should not behave as a passive register; it should actively surface aging operational items.

Time-based controls should cover:

- Pending approvals
- Service turnaround
- Transfer receipt delays
- Reserved assets awaiting handover
- Offboarding recoveries not completed in time

Business behavior:

- The system should identify aging items against configured SLA thresholds
- Relevant users should be notified when action is pending or overdue
- Unresolved items should escalate according to business rules
- Escalations should remain visible in audit and exception monitoring

Illustrative notification triggers:

- Asset assigned: notify employee and responsible branch admin if acknowledgment is required
- Reservation nearing expiry: notify responsible admin
- Pending approval aging: notify approver and escalate per policy
- Service delay: notify branch admin or service coordinator
- Transfer not received in time: notify source and destination admins
- Offboarding recovery overdue: notify branch admin and approver where required

### 10.15 Inventory Audit & Reconciliation Workflow

The AMS should support periodic physical verification of assets at branch or location level.

Business flow:

1. Audit cycle is initiated for a branch, location, or selected asset scope
2. Physical verification is performed against system stock
3. Matches, missing items, excess items, and condition differences are recorded
4. Mismatches are reviewed
5. Approved adjustments or accountability actions are completed
6. Audit outcome is closed with full traceability

Business rules:

- Physical audit should support both scheduled and ad hoc verification
- Stock mismatches must not be silently corrected without review
- Adjustment of inventory records should require controlled approval where discrepancy is material
- Reconciliation history should remain auditable for future review

---

## 11. Approval & Governance Rules

### 11.1 Approval-Relevant Actions

The AMS should support approvals for:

- New asset requests
- Additional asset requests
- High-value asset allocation
- Inter-branch transfers
- Loss declarations
- Damage declarations where accountability is disputed
- Scrap/disposal
- Policy exceptions

### 11.2 Approval Behavior

Approval logic should be configurable by:

- Asset type
- Asset value/category
- Request type
- Employee role/department
- Branch
- Exception severity

Possible outcomes:

- Approved
- Rejected
- Sent back for clarification
- Approved with exception note

### 11.3 Governance Controls

The system must enforce:

- Role-based operation boundaries
- Mandatory reason capture for sensitive actions
- Non-editable audit trail for approvals and state changes
- Exception visibility for unresolved operational risks
- Aging visibility for pending approvals, delayed transfers, overdue service, and pending recoveries
- Escalation rules for unresolved approval-sensitive actions
- Correction workflow for wrong entries while preserving audit trail

### 11.4 Override Governance

Override handling must be tightly controlled.

The system should define:

- Which roles can approve overrides
- Which actions are override-eligible
- Whether the override is one-time or time-bound
- Mandatory justification requirements

Key business rule:

- Overrides must resolve a controlled exception, not bypass the standard governance model

### 11.5 Correction Handling

The AMS should support correction of wrong business entries without hard deletion of operational history.

Business rules:

- Wrong entries should be corrected through controlled update or cancellation flow
- Original value, corrected value, actor, time, and reason should remain visible in audit history
- Deletion of operational records should be avoided for governed asset actions

This solves the gap:

- No approval and audit control

---

## 12. Policy & Rules Engine

Purpose:
Ensure asset distribution is consistent and not dependent on manual judgment alone.

### 12.1 Policy Types

The AMS should allow rules such as:

- Role-based eligibility
- Department-based eligibility
- Branch-specific asset entitlement
- Branch-specific restrictions
- Maximum quantity per asset type
- Approval requirement by asset value or asset type
- Replacement eligibility conditions
- Backup issue priority rules
- Return requirements during offboarding
- Reservation eligibility and duration
- Override eligibility for policy exceptions

### 12.2 Example Policies

- Manager gets laptop and mobile
- Intern gets laptop only
- Employee cannot hold more than one active laptop
- Access card allocation requires local branch approval
- Backup laptops are issued only for service cases above a defined duration
- Scrap approval is mandatory for all computing devices

### 12.3 Policy Outcomes

Policies should influence:

- What an employee can request
- What an admin can allocate directly
- Which requests require approval
- Which assets can be transferred
- Which assets can be scrapped

### 12.4 Policy Precedence and Override Rules

To avoid policy conflicts, the AMS should resolve rules in the following order:

1. Organization or global restriction
2. Branch or local restriction
3. Role or department entitlement
4. Request-specific approved exception

Business rules:

- Restriction rules must override entitlement rules unless an approved exception exists
- Exception approvals must be explicit, time-bound where needed, and auditable
- Override actions must capture approver, reason, and scope of exception

This solves the gap:

- No allocation policy rules

---

## 13. Stock Visibility & Inventory Control

The AMS must give real-time stock visibility by branch and location.

### 13.1 Required Stock Views

- Available assets by branch
- Reserved assets by branch
- Assigned assets by branch
- Assigned assets by employee
- Backup stock
- Idle stock
- Assets under service
- Assets in transit
- Lost assets
- Damaged assets
- Scrapped assets

### 13.2 Search & Discoverability

Admins should be able to quickly locate assets and operational records using business-friendly search criteria.

Required search dimensions:

- Asset ID
- Serial number or IMEI
- Employee
- Branch or location
- Asset type
- Status
- Request or service reference where applicable

### 13.3 Business Benefits

- Prevent stock shortages from being hidden
- Avoid over-allocation
- Support onboarding readiness
- Enable better branch planning
- Reduce unnecessary procurement

This solves the gap:

- No stock visibility per branch

---

## 14. History & Audit Tracking

Every important action must create permanent history.

### 14.1 Business Event Model

The AMS should treat business events as the source of truth for asset history, accountability, and auditability.

This means:

- Every important asset action should create a business event
- Current asset state should always be explainable through prior recorded events
- History, audit, and operational review should derive from these business events without losing sequence or responsibility

Illustrative events:

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

### 14.2 History Events to Capture

- Asset creation
- Attribute updates affecting business identity
- Allocation
- Reservation
- Handover acknowledgment if used
- Return
- Service send/receive
- Backup issue/recovery
- Transfer dispatch/receipt
- Loss declaration
- Damage declaration
- Policy exception
- Scrap approval and disposal

### 14.3 History Questions the System Must Always Answer

- Who had this asset at any given time?
- Which branch owned it before and after transfer?
- How many times was it serviced?
- Was it ever lost or damaged?
- Why was it scrapped?
- Which approvals were used during its lifecycle?

Key business rule:

- No business action should erase prior history

### 14.4 Uniqueness & Identity Control

The AMS should apply uniqueness rules by identifier type, not treat all identifiers the same.

Core rules:

- Internal asset ID must be organization-wide unique and must never change, even if the asset moves across branches
- Asset transfer must not create a new identity or reset uniqueness
- Manufacturer or external identifiers should follow asset-type-specific uniqueness rules

Illustrative guidance:

- IMEI: normally organization-wide unique
- Laptop serial number: normally organization-wide unique
- Access card number: may follow company-defined or branch-defined uniqueness depending on business policy

Business rule:

- Uniqueness policy for each external identifier must be defined at asset-type level, but movable assets should not rely on branch-only uniqueness where that would create identity collisions after transfer

---

## 15. Loss / Damage Accountability

### 15.1 Loss Handling Workflow

Business flow:

1. Employee or Admin reports asset as lost
2. Verification review is conducted
3. Responsibility is assigned
4. Recovery/penalty action is recorded if applicable
5. Asset is blocked from normal use
6. Case is closed through recovery, write-off, or exception approval

### 15.2 Damage Handling Workflow

Business flow:

1. Damage is reported during use or return
2. Admin verifies condition
3. Responsibility is classified:
   - normal wear and tear
   - accidental damage
   - negligence/misuse
4. Outcome is determined:
   - repair
   - employee recovery
   - scrap
   - approved exception

### 15.3 Accountability Data Points

The business design should support capture of:

- Reported by
- Verified by
- Accountable party
- Incident date
- Incident reason
- Evidence/remarks
- Recovery/penalty status
- Recovery amount recorded or collected, where applicable
- Final closure decision

### 15.4 Archive vs Scrap

The AMS should distinguish clearly between archived assets and scrapped assets.

- Archived: asset is no longer active for normal operations but is retained for business reference, audit, or historical review
- Scrapped: asset is permanently retired from usable inventory due to disposal, damage, or end-of-life decision

Business rules:

- Archived assets must not appear as normal allocatable stock
- Scrapped assets must never return to active stock
- Archive should preserve long-term history without treating the asset as operationally active

This solves the gap:

- No loss/damage accountability

---

## 16. Edge Cases & Exception Handling

The business design must explicitly prevent or manage the following cases:

- Same asset allocated to two employees
- Same asset reserved and assigned through conflicting workflows
- Asset requested again while already assigned
- Asset under service being allocated
- Asset transferred while still in employee custody
- Asset scrapped without approval
- Asset returned in damaged condition without accountability review
- Duplicate serial/IMEI recorded where uniqueness is expected
- Employee exits without returning all assets
- Backup asset never recovered after original asset returns
- Transfer dispatched but not received by destination
- Request raised repeatedly for the same unresolved issue
- Asset declared lost and later found
- Access card or low-value items treated as untracked and disappearing from visibility
- Reserved asset never handed over and never released

Recommended business behavior for found-later lost assets:

- Asset should not directly become available
- Verification and closure review should happen first

---

## 17. Operational Rules for Scalability

To remain practical at enterprise scale, the AMS should be run with these design rules:

1. Configuration-driven asset setup
2. Central lifecycle control
3. Branch-scoped operations with global visibility
4. Policy-driven allocation and approval
5. Immutable history and audit trail
6. Clear distinction between stock, custody, service, transit, and disposal
7. Reuse of asset master definitions across all branches
8. Standardized workflows for onboarding, service, transfer, return, and offboarding
9. Bulk operations with item-level validation, approval, and audit trace
10. Time-based operational monitoring through SLA, aging, notification, and escalation controls

---

## 18. Minimum Business Outcomes the System Must Deliver

If the AMS is implemented correctly from this design, the business should always be able to:

- Know how many assets exist and where they are
- Know who currently holds any asset
- Know which branch has shortage or surplus
- Know which assets are available, idle, in service, or in transit
- Know which assets are reserved and pending handover
- Allocate assets consistently by policy
- Recover assets reliably during exit or replacement
- Trace service, transfer, and disposal history
- Hold users accountable for loss or damage
- Prove approvals and actions through audit records

---

## 19. Gap Closure Against Critical Requirements

### 19.1 No Asset Identity vs Asset Type Clarity

Solved by:

- Strict separation of Asset Type and Asset Instance
- Mandatory system-generated asset ID
- Serial number treated as optional/conditional identity

### 19.2 No Lifecycle / State Management

Solved by:

- Defined lifecycle states
- Controlled state transition rules
- Action blocking for invalid operations
- Reservation control before handover

### 19.3 No Approval & Audit Control

Solved by:

- Approval-driven request, transfer, and scrap workflows
- Immutable history and action logging
- Role-based governance boundaries
- Aging, escalation, and override visibility

### 19.4 No Loss / Damage Accountability

Solved by:

- Loss and damage workflows
- Responsibility assignment
- Penalty/recovery tracking support

### 19.5 No Stock Visibility Per Branch

Solved by:

- Branch-wise stock visibility
- State-wise asset visibility
- Transfer and transit tracking

### 19.6 No Allocation Policy Rules

Solved by:

- Policy engine for role, department, quantity, and approval eligibility
- Policy precedence and override rules

---

## 20. Final Business Conclusion

This AMS design is complete from a business perspective because it covers:

- Asset definition
- Asset identity
- Inventory ownership
- Controlled lifecycle
- Allocation and request handling
- Service and backup processes
- Reservation, SLA, and escalation behavior
- Movement and branch transfer
- Return and offboarding recovery
- Scrap/disposal governance
- Audit and accountability
- Policy-based operational control

It is practical for real-world enterprise use because it prevents operational ambiguity, supports branch-level execution, and maintains organization-wide governance and traceability without depending on manual memory or disconnected tracking methods.
