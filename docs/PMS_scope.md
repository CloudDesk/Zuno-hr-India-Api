# Zuno HRMS - Performance Management System (PMS) Scope

## 1. Objective

Design and implement a configurable Performance Management System (PMS) module for Zuno HRMS that supports the full employee performance cycle from goal setting to final evaluation.

The module must enable:

- Configurable performance templates and forms
- Role-based access and field-level permissions
- Employee goal setting and progress updates
- Self-assessment and manager assessment
- Storage of both employee and manager ratings
- Review, revision, and acceptance workflows
- Final rating confirmation and freeze
- Auditability, transparency, and controlled overrides

## 2. Business Outcome

The PMS module should provide a structured and collaborative process where:

- HR/Admin configures templates, cycles, and permissions
- Employees define and submit goals
- Managers review goals and evaluations
- Both employee and manager inputs are preserved
- Final ratings are confirmed through a controlled approval process
- All actions are traceable through audit history

## 3. In Scope

This scope covers:

- Template and form builder for PMS
- Template versioning
- Performance cycle configuration
- Employee-to-manager assignment for cycles
- Goal planning workflow
- Mid-cycle or end-cycle self-review workflow
- Manager review and rating workflow
- Dual rating storage
- Final review and acceptance flow
- HR override and escalation controls
- Notifications and reminders
- Audit trail and reporting-ready data structures

## 4. Actors and Roles

### 4.1 Employee

The employee can:

- View assigned performance cycle
- Create and update goals during allowed stages
- Submit goals for manager review
- Update progress during review windows
- Complete self-evaluation
- Enter self-ratings and comments
- Review manager evaluation
- Accept final evaluation or raise comments before finalization

### 4.2 Manager

The manager can:

- Review goals submitted by direct or assigned employees
- Approve goals or return them for revision
- Review employee self-assessment
- Add manager ratings and comments
- Accept employee-entered ratings or provide manager ratings independently
- Submit final manager evaluation
- Review employee disagreement comments
- Re-submit final evaluation where applicable

### 4.3 HR/Admin

HR/Admin can:

- Create and manage PMS templates
- Configure rating scales and field rules
- Launch performance cycles
- Assign or reassign employees and managers
- Configure permissions and workflow rules
- Monitor cycle progress
- Reopen, close, or override reviews under controlled rules
- Handle escalations and exceptional closure scenarios
- Perform bulk operational actions for eligible assignments

## 5. Core Functional Requirements

### 5.1 Template and Form Builder

HR/Admin must be able to create configurable performance templates.

Each template should support:

- Template name
- Template code or unique key
- Description
- Active or inactive status
- Versioning
- Effective date or applicability controls

Each template should contain one or more sections such as:

- Goals
- Competencies
- KPIs
- Behavioural traits
- Development plan
- Overall feedback

Each section should support:

- Section title
- Section description
- Display order
- Optional weightage
- Visibility rules by role and stage
- Repeatable or non-repeatable configuration if needed

Each field should support:

- Field key
- Field label
- Field type
- Required or optional flag
- Placeholder or help text
- Validation rules
- Default value
- Weightage where applicable
- Editable stages
- Visible roles
- Read-only roles
- Scoring participation flag

Supported field types for initial release:

- Short text
- Long text
- Numeric input
- Dropdown or select
- Radio buttons
- Checkbox
- Date
- Rating scale
- Weighted score
- Comment box

### 5.2 Template Versioning

Template versioning is mandatory.

Rules:

- A template may have multiple versions
- Only one version can be active for new assignments at a time
- Once a performance form is created for a cycle, the linked template version must be locked for that form
- Changes to template structure must create a new template version
- Existing cycle records must continue using the original assigned template version

### 5.3 Performance Cycle Management

HR/Admin must be able to define performance cycles.

Each cycle should include:

- Cycle name
- Cycle code
- Description
- Start date
- End date
- Status
- Template version mapping
- Eligible employee population

Each cycle should also define milestone windows:

- Goal setting start date
- Goal setting end date
- Goal approval end date
- Self-review start date
- Self-review end date
- Manager review end date
- Employee acceptance end date
- Final closure date

Operational capabilities for cycle management should also support:

- Bulk assignment of employees into a cycle
- Bulk reminder triggering for pending actions
- Bulk close for eligible assignments by authorized HR/Admin users

Cycle statuses:

- `DRAFT`
- `SCHEDULED`
- `ACTIVE`
- `CLOSED`
- `ARCHIVED`
- `CANCELLED`

### 5.4 Assignment Logic

Employees must be assigned into a cycle with an associated manager and template version.

Assignment options:

- Automatic assignment from reporting hierarchy
- Manual assignment by HR/Admin
- Bulk assignment by HR/Admin

Assignment must store:

- Employee
- Manager
- Cycle
- Template version
- Assignment status
- Assignment source
- Assignment timestamp

Rules:

- Manager should default from reporting hierarchy at the time of assignment
- HR/Admin may reassign the manager if required
- Reassignment must be audited
- Historical review actions must preserve the original actor for prior submissions

## 6. Workflow Design

### 6.1 Workflow Overview

The PMS workflow must support controlled transitions across goal planning, self-review, manager review, acceptance, and finalization.

### 6.2 Assignment-Level State Machine

Each employee-cycle assignment should move through the following states:

- `DRAFT`
- `GOAL_SETTING`
- `GOAL_SUBMITTED`
- `GOAL_REVISION_REQUIRED`
- `GOAL_APPROVED`
- `SELF_REVIEW_OPEN`
- `SELF_REVIEW_SUBMITTED`
- `MANAGER_REVIEW_OPEN`
- `MANAGER_SUBMITTED`
- `EMPLOYEE_ACCEPTANCE_PENDING`
- `EMPLOYEE_COMMENTED`
- `HR_ESCALATED`
- `FINALIZED`
- `REOPENED_BY_HR`
- `CLOSED_BY_HR`

### 6.3 State Transition Rules

Allowed transition examples:

- `DRAFT` -> `GOAL_SETTING`
- `GOAL_SETTING` -> `GOAL_SUBMITTED`
- `GOAL_SUBMITTED` -> `GOAL_APPROVED`
- `GOAL_SUBMITTED` -> `GOAL_REVISION_REQUIRED`
- `GOAL_REVISION_REQUIRED` -> `GOAL_SETTING`
- `GOAL_APPROVED` -> `SELF_REVIEW_OPEN`
- `SELF_REVIEW_OPEN` -> `SELF_REVIEW_SUBMITTED`
- `SELF_REVIEW_SUBMITTED` -> `MANAGER_REVIEW_OPEN`
- `MANAGER_REVIEW_OPEN` -> `MANAGER_SUBMITTED`
- `MANAGER_SUBMITTED` -> `EMPLOYEE_ACCEPTANCE_PENDING`
- `EMPLOYEE_ACCEPTANCE_PENDING` -> `FINALIZED`
- `EMPLOYEE_ACCEPTANCE_PENDING` -> `EMPLOYEE_COMMENTED`
- `EMPLOYEE_COMMENTED` -> `MANAGER_REVIEW_OPEN`
- `EMPLOYEE_COMMENTED` -> `HR_ESCALATED`
- `HR_ESCALATED` -> `MANAGER_REVIEW_OPEN`
- `HR_ESCALATED` -> `FINALIZED`
- `FINALIZED` -> `REOPENED_BY_HR` by authorized HR action only
- `REOPENED_BY_HR` -> `MANAGER_REVIEW_OPEN`
- `REOPENED_BY_HR` -> `FINALIZED`
- Any non-finalized state -> `CLOSED_BY_HR` by authorized HR action

No direct transitions should be allowed from `FINALIZED` except through the controlled HR reopen path.

## 7. Detailed Functional Workflow

### 7.1 Goal Setting Stage

At the start of the cycle:

- The employee receives the assigned PMS form
- The employee enters one or more goals
- Each goal may include target value, description, weightage, due date, and success criteria
- The employee submits goals to the manager

Manager actions:

- Approve goals
- Return goals for revision with comments

Rules:

- Employee may edit goals only during `GOAL_SETTING` or `GOAL_REVISION_REQUIRED`
- After submission, goals become read-only until returned
- Manager approval locks the goal plan for the next stage unless HR reopens it

### 7.2 Self-Review Stage

During self-review:

- The employee updates progress against approved goals
- The employee enters self-ratings where applicable
- The employee adds self-comments and achievements
- The employee submits the self-review

Rules:

- Users may save in-progress responses as draft before final submission
- Self-review is editable only within the self-review window
- Submission timestamp must be stored
- Late submission handling should follow cycle policy or HR override

### 7.2.1 Partial Submission and Draft Handling

The system must distinguish between draft save and final submit.

Draft behavior:

- Users may save partially completed goals or review responses as draft
- Draft save should allow incomplete required fields
- Draft data should remain editable while the assignment is in an editable state
- Draft status should not trigger workflow transition

Submit behavior:

- Final submit must validate all required fields for the active stage
- Final submit must validate rating scale compliance and mandatory comments where configured
- Final submit should fail if stage-specific validation rules are not satisfied
- Only a successful submit should move the workflow to the next state

### 7.3 Manager Review Stage

During manager review:

- The manager reviews goals, progress, self-ratings, and employee comments
- The manager may agree with the employee's input or provide separate ratings
- The manager adds manager comments and final observations
- The manager submits the manager review

Rules:

- The manager must only review assigned employees unless HR override is used
- Manager actions must record actor, timestamp, and change history
- Manager may modify manager-rating fields only, unless template rules explicitly allow manager edits on additional fields

### 7.4 Employee Acceptance Stage

After manager submission:

- The employee reviews the manager evaluation
- The employee may accept the evaluation
- The employee may add comments if they disagree or want to record additional contributions

Rules:

- Employee comments after manager submission must not overwrite manager entries
- If the employee comments instead of accepting, the record returns to manager review or HR escalation depending on policy

### 7.5 Finalization Stage

The review is finalized when:

- The employee accepts the evaluation, or
- HR closes the review through an approved override process

Once finalized:

- The form becomes read-only
- Final ratings are frozen
- Final comments remain visible but not editable
- No field changes are permitted through standard user actions

### 7.6 Reopen Capability After Finalization

The system should support an optional controlled reopen process after finalization.

This should be limited to HR/Admin only and used for exceptional cases such as:

- Correction after internal or external audit
- Legal or compliance-driven update
- Material review correction approved by policy

Rules:

- Reopen must move the assignment from `FINALIZED` to `REOPENED_BY_HR`
- Reopen reason is mandatory
- Reopen actor and timestamp must be audited
- The system should record the previous finalized snapshot before reopening
- Reopened records must return only to approved downstream review stages, not to unrestricted editing
- The assignment may be finalized again after the corrective flow is completed

## 8. Dual Rating Model

The PMS module must preserve both employee and manager input.

For rating-enabled fields, the system should support:

- Employee rating value
- Manager rating value
- Final rating value where applicable

Rules:

- Employee rating and manager rating must be stored separately
- Final rating may be derived from manager rating, calculated by scoring rules, or set through override depending on template configuration
- The source of final rating must be traceable
- Changes to any rating must be auditable

## 9. Rating and Scoring

### 9.1 Rating Scale Configuration

The system should support configurable rating scales such as:

- Numeric scale, for example 1 to 5
- Numeric scale, for example 1 to 10
- Text scale, for example Poor to Excellent
- Custom label-based scales

Each rating scale should support:

- Scale name
- Display labels
- Stored values
- Sort order
- Active flag

### 9.2 Scoring Options

The system should support both:

- Weighted score calculation
- Manual final rating

Weighted score examples:

- Goal section contributes 60 percent
- Competency section contributes 40 percent

Rules:

- Weightage validation should ensure expected total where scoring is enabled
- Formula logic must be versioned with the template
- Manual override of final score by manager or HR must capture override reason

## 10. Access Control and Permissions

### 10.1 Access Control Principles

Access control must be based on:

- User role
- Assignment relationship
- Workflow state
- Field-level permissions

### 10.2 Role and Stage Permissions

#### Employee

- Can edit goals only in goal-editable states
- Can edit self-review only in self-review state
- Can view manager ratings only after manager submission if the policy allows visibility
- Cannot edit manager-only fields
- Cannot modify finalized records

#### Manager

- Can access only assigned employees or direct reports within scope
- Can approve or return goals
- Can enter manager ratings and comments during manager-review states
- Cannot modify template structure
- Cannot alter finalized records through normal flow

#### HR/Admin

- Can manage templates, cycles, assignments, and overrides
- Can reassign managers
- Can close records exceptionally
- Can override ratings only with mandatory reason capture
- Can access audit history and reporting views

### 10.3 Field-Level Permissions

Each field should allow configuration for:

- Visibility by role
- Editability by role
- Editability by workflow stage
- Mandatory or optional status by stage
- Inclusion or exclusion from scoring

## 11. Data Model - High Level Design

The following logical entities are recommended.

### 11.1 Master and Configuration Entities

- `users`
- `templates`
- `template_versions`
- `template_sections`
- `template_fields`
- `rating_scales`
- `rating_scale_values`
- `performance_cycles`
- `cycle_stage_rules`

### 11.2 Transactional Entities

- `performance_assignments`
- `goal_items`
- `performance_forms`
- `review_submissions`
- `review_responses`
- `review_comments`
- `approval_actions`
- `override_actions`
- `notifications`
- `audit_logs`

### 11.3 Minimum Data Expectations

#### `performance_assignments`

- assignment id
- employee id
- manager id
- cycle id
- template version id
- current status
- assigned at
- assigned by

#### `goal_items`

- goal id
- assignment id
- title
- description
- target metric
- target date
- weightage
- progress value
- employee comment
- manager comment
- status

#### `performance_forms`

- form id
- assignment id
- template version id
- current stage
- submitted timestamps by stage
- finalized at
- finalized by

#### `review_responses`

- response id
- form id
- field id
- subject entity type
- subject entity id
- employee value
- manager value
- final value
- final value source
- last modified by
- last modified at

#### `approval_actions`

- action id
- assignment id
- action type
- from status
- to status
- actor id
- remarks
- acted at

#### `audit_logs`

- audit id
- entity type
- entity id
- action
- old value snapshot
- new value snapshot
- actor id
- actor role
- timestamp

## 12. Validation Rules

The system should enforce the following:

- Required fields must be completed before submission
- Rating fields must comply with the configured scale
- Weightage must remain within allowed limits
- Stage submissions must be blocked outside active windows unless overridden by HR/Admin
- Only allowed state transitions should be accepted
- Finalized records must reject all standard edits
- Manager reassignment must not erase prior audit ownership

## 13. Notifications and Reminders

The PMS module should trigger notifications for:

- Cycle assignment created
- Goal submission pending
- Goal approval pending
- Goals returned for revision
- Self-review window opened
- Self-review overdue
- Manager review pending
- Manager review overdue
- Employee acceptance pending
- HR escalation raised
- Finalized review completed

Notifications may be delivered through:

- In-app alerts
- Email

Reminder rules should be configurable by HR/Admin.

## 14. Audit and Compliance

The system must maintain a complete audit trail for:

- Goal creation and updates
- Field value changes
- Rating changes
- Approval and rejection actions
- Return-for-revision actions
- Override actions
- Reassignment actions
- Finalization events

Audit data should preserve:

- Who performed the action
- What changed
- Previous value
- New value
- When it changed
- Why it changed where reason capture is required

## 15. Dashboards and Views

### 15.1 HR/Admin Dashboard

Should support:

- Template management
- Cycle launch and monitoring
- Assignment tracking
- Bulk assignment tools
- Bulk reminder tools
- Bulk close tools for eligible records
- Overdue reviews
- Escalations
- Finalization summary

### 15.2 Employee View

Should support:

- Current cycle overview
- Goal entry and updates
- Self-review submission
- Manager feedback visibility
- Final review acceptance
- Historical finalized reviews if enabled by policy

### 15.3 Manager View

Should support:

- Team review queue
- Goal approval queue
- Self-review review queue
- Pending employee acceptance items
- Finalized outcomes for direct reports

### 15.4 Bulk Actions

The system should support controlled bulk actions for HR/Admin users.

Initial bulk operations should include:

- Bulk assign employees to a cycle
- Bulk send reminders for pending goal submission, self-review, manager review, or acceptance
- Bulk close eligible assignments based on configured rules

Rules:

- Bulk actions must support filtering by cycle, manager, department, location, status, or due state
- The system should show a preview count before execution
- Failures should be reported per record where partial processing occurs
- All bulk actions must be audited with actor, timestamp, filters used, and impact summary
- Bulk close should be restricted to HR/Admin and should capture closure reason

## 16. Edge Cases and Exception Handling

The design must support the following scenarios:

- Manager changes mid-cycle
- Employee transfers to another team mid-cycle
- Employee exits before cycle completion
- Goal deadlines missed
- Self-review not submitted before deadline
- Manager review delayed
- Employee disputes manager evaluation
- HR force-closes an assignment
- HR reopens a finalized review for correction

Rules for such cases:

- Reassignment must preserve historical workflow actions
- HR closure must be auditable with mandatory reason
- Disputes may move to `HR_ESCALATED`
- Closed or finalized records must remain available for reporting

## 17. SLA and Escalation Management

The PMS module should support configurable SLA management for both submissions and approvals.

### 17.1 SLA Coverage

SLA rules should be definable for each major stage, including:

- Goal submission by employee
- Goal approval by manager
- Self-review submission by employee
- Manager review submission by manager
- Employee acceptance of final review
- HR action on escalated or exception cases

### 17.2 Stage-Wise SLA Definition

Each SLA rule should support:

- Applicable cycle or template
- Workflow stage
- Responsible role
- Due date basis
- Grace period if allowed
- Reminder schedule
- Escalation trigger
- Auto-action policy

Due dates may be based on:

- Fixed cycle milestone date
- Relative number of days from previous stage completion
- HR-configured override date for exceptional cases

### 17.3 Reminder Rules

The system should support automated reminders such as:

- Pre-due reminders
- Due-date reminders
- Post-due reminders
- Repeated reminders until action or escalation

Reminder channels may include:

- In-app notifications
- Email

### 17.4 Auto-Actions

Auto-actions may be configured for selected stages. Examples:

- Auto-escalate to next approver on SLA breach
- Auto-notify HR/Admin on repeated breach
- Auto-close inactive assignments by HR policy
- Auto-reassign pending approval to delegate where active delegation exists

Auto-actions must:

- Follow explicit policy configuration
- Be logged as system-generated actions
- Preserve original pending owner history

### 17.5 Escalation Hierarchy

The system should support configurable escalation paths such as:

- Employee -> Manager -> HR/Admin
- Manager -> Skip-level manager -> HR/Admin
- HR/Admin -> Super Admin or designated authority if required

Rules:

- Escalation must record the reason, breached stage, and elapsed time
- Escalation should not erase original ownership
- Escalated tasks must remain traceable to both current and original responsible users

## 18. Delegation and Reassignment

The PMS module should distinguish between delegation and reassignment.

### 18.1 Temporary Delegation

Temporary delegation should be used when the assigned approver is unavailable for a limited period, for example:

- Manager is on leave during goal approval
- Manager is unavailable at cycle end during final review

Rules:

- Delegation may be configured with start and end date
- Delegation should apply only within the configured validity period
- Delegation should not change the original assignment owner
- Delegate may act on behalf of the original approver only for permitted stages
- All delegated actions must capture both original owner and acting delegate

### 18.2 Permanent Reassignment

Permanent reassignment should be used when managerial ownership changes structurally, for example:

- Employee moves to a new reporting manager
- Original manager exits the company
- HR changes assignment for business reasons

Rules:

- Reassignment changes the active responsible approver for future pending stages
- Prior completed approvals must remain attributed to the original actor
- Reassignment should not rewrite historical audit data
- Reassignment reason, actor, and timestamp are mandatory

### 18.3 Scope Rules

Delegation and reassignment must both support scope control.

Scope examples:

- Single employee assignment
- Multiple selected employees
- Entire cycle
- Specific workflow stages only
- Time-bound delegation window

Rules:

- Delegation should be stage-aware and time-bound
- Reassignment may be broader but must be explicitly authorized
- Users must not gain unrestricted visibility outside approved scope

### 18.4 Audit Requirements

The system must audit:

- Who delegated or reassigned
- Who received delegated or reassigned scope
- Why the action was taken
- Effective start and end times
- Affected employees, stages, and cycles
- Actions performed by a delegate versus original owner

### 18.5 Approval Handling for Manager Leave or Manager Change

For approval continuity, the scope should explicitly support these cases:

- If the originally assigned manager is on leave, a temporary delegate may complete pending approvals within the approved delegation window
- If a new manager joins before the review is finalized, HR/Admin may permanently reassign pending stages to the new manager
- If the old manager completed earlier stages but the new manager handles the final stage, the system must preserve both histories separately
- If no delegate or reassignment is configured and SLA is breached, the item should escalate according to hierarchy rules

## 19. Advanced Edge Case Handling

The PMS module should explicitly support advanced operational exceptions.

### 19.1 Manager Exit

If a manager exits during an active cycle:

- Pending approvals should move to a configured delegate, new manager, or HR/Admin
- Completed approvals by the exited manager must remain historically intact
- HR/Admin should be able to review impacted assignments in bulk

### 19.2 Employee Exit

If an employee exits before cycle completion:

- HR/Admin may close the assignment with closure reason
- The system may optionally allow pro-rated or early finalization depending on policy
- Closed records must remain visible for compliance and reporting

### 19.3 Missing Submissions

If employee or manager submissions are missing:

- Reminder and SLA policies should trigger automatically
- Escalation should occur after configured breach thresholds
- HR/Admin should be able to intervene manually
- Bulk follow-up actions should be supported

### 19.4 Disputes

If the employee disputes a manager evaluation:

- The assignment may move to `EMPLOYEE_COMMENTED` or `HR_ESCALATED`
- Comments from both parties must remain preserved
- HR/Admin should be able to mediate and document the resolution

### 19.5 SLA Breaches

If SLA is breached for any submission or approval stage:

- The breach must be visible in dashboard and audit history
- Reminder and escalation logic should trigger automatically where configured
- System-driven escalation or delegation routing must remain auditable

### 19.6 Additional Recommended Scenarios

The following cases are also valid and should be considered in implementation:

- Manager changes after self-review submission but before final evaluation
- Delegate approves during leave period and original manager returns later
- Multiple reassignments occur within the same cycle
- Reopened finalized review also breaches SLA after reopen

## 20. Non-Functional Requirements

The PMS module should be designed with the following qualities:

- Secure role-based access control
- Auditability
- Scalability for organization-wide cycles
- Configurability without code changes for common template variations
- Data integrity across template versions
- Clear status traceability
- Reporting-ready structured data

## 21. Example Business Flow

Example:

- Employee is assigned to Annual 2026 PMS cycle
- Employee sets a goal: "Improve client handling by managing project communication proactively and resolving client issues within agreed timelines"
- Employee submits goals
- Manager reviews and approves goals
- During self-review, employee updates progress and rates performance as "Very Good"
- Manager reviews and records rating as "Good"
- Employee adds final comments such as "Handled client calls effectively, resolved escalation points on time, and improved stakeholder communication across deliveries"
- Manager rechecks and submits final review
- Employee accepts the evaluation
- The assignment moves to `FINALIZED`
- Final rating and comments are frozen

## 22. Recommended Implementation Notes

To keep the module robust and maintainable, the implementation should follow these design principles:

- Treat workflow state as a first-class domain concept
- Separate template configuration data from transactional review data
- Preserve template version history permanently for completed cycles
- Store employee, manager, and final values separately
- Use explicit approval-action records instead of only updating a status field
- Enforce permissions based on both role and workflow stage
- Make all override actions reason-driven and auditable
- Model SLA, delegation, reassignment, and escalation as separate domain capabilities instead of implicit status flags

## 23. Final Scope Summary

This PMS module for Zuno HRMS will provide:

- Customizable templates and form structures
- Controlled role-based access
- Structured goal-setting and evaluation workflows
- Separate employee and manager ratings
- Transparent review and acceptance loops
- Finalized and frozen performance outcomes
- Strong audit and administrative control

This scope is intended to support a robust first-phase PMS implementation that aligns with the stated business requirement while leaving room for later enhancements such as calibration, 360 feedback, and deeper analytics.
