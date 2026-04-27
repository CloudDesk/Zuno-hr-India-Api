# Zuno HRMS - PMS Module Final Phase-wise Estimation (AI-Assisted)

## 1. Estimation Basis

This estimation assumes the following already exist in Zuno HRMS:

- User master
- Reporting manager hierarchy
- Role setup
- Basic authentication and access framework

Because these foundations are already available, they are not estimated as separate PMS effort.

## 2. Phase Summary

| Phase | Phase Name | Estimated Time |
|---|---|---:|
| Phase 1 | Template & Form Builder | 20 hours |
| Phase 2 | Cycle Management & Assignment | 12 hours |
| Phase 3 | Workflow Engine (State Machine) | 18 hours |
| Phase 4 | Goal Setting & Self Review (Employee Flow) | 16 hours |
| Phase 5 | Manager Review & Evaluation | 16 hours |
| Phase 6 | Acceptance, Finalization & Reopen | 12 hours |
| Phase 7 | SLA, Notifications & Escalation | 12 hours |
| Phase 8 | Delegation & Reassignment | 8 hours |
| Phase 9 | Bulk Actions & Admin Controls | 8 hours |
| Phase 10 | Audit, Reporting & Dashboards | 8 hours |
| Phase 11 | Deploy and Test | 8 hours |

Estimated total: `138 hours`

## 3. Final Phase-wise Estimation

### Phase 1. Template & Form Builder

Estimated time: `20 hours`

Includes:

- Template creation such as name, code, and activation
- Section configuration such as Goals, Competencies, and related review sections
- Field builder including types, validation, and permissions
- Rating scale configuration
- Template versioning

Dependencies:

- None
- Can start directly

### Phase 2. Cycle Management & Assignment

Estimated time: `12 hours`

Includes:

- Performance cycle creation including dates and milestones
- Stage window configuration
- Employee assignment through auto, manual, or bulk methods
- Manager mapping based on hierarchy
- Assignment tracking including status and timestamps

Dependencies:

- Depends on Phase 1 because template version must exist before cycle usage

### Phase 3. Workflow Engine (State Machine)

Estimated time: `18 hours`

Includes:

- Assignment-level state machine
- Status transitions and validation rules
- Action handling such as submit, approve, reject, and return
- Stage-based access control
- Draft versus submit handling

Dependencies:

- Depends on Phase 2 because assignments must exist

### Phase 4. Goal Setting & Self Review (Employee Flow)

Estimated time: `16 hours`

Includes:

- Goal creation and update
- Draft save and final submission
- Self-review form handling
- Employee ratings and comments
- Stage-based validation

Dependencies:

- Depends on Phase 1 because template structure must exist
- Depends on Phase 3 because workflow states must exist

### Phase 5. Manager Review & Evaluation

Estimated time: `16 hours`

Includes:

- Manager review handling
- Manager rating input
- Approve and return logic
- Dual rating storage for employee and manager values
- Manager submission flow

Dependencies:

- Depends on Phase 4 because employee data must exist
- Depends on Phase 3 because workflow engine must exist

### Phase 6. Acceptance, Finalization & Reopen

Estimated time: `12 hours`

Includes:

- Employee acceptance flow
- Comment and dispute handling
- Final rating confirmation
- Freeze logic using `FINALIZED` state
- Controlled reopen by HR

Dependencies:

- Depends on Phase 5 because manager review must be complete

### Phase 7. SLA, Notifications & Escalation

Estimated time: `12 hours`

Includes:

- SLA configuration stage-wise
- Reminder engine for pre-due, due, and post-due actions
- Escalation hierarchy logic
- Auto-actions such as auto escalate, notify, and close
- Notification system through email and in-app channels

Dependencies:

- Depends on Phase 3 because workflow engine must exist
- Depends on Phase 2 because cycle timelines must exist

### Phase 8. Delegation & Reassignment

Estimated time: `8 hours`

Includes:

- Temporary delegation with time-bound control
- Permanent reassignment
- Scope-based control by user, stage, or cycle
- Approval routing through delegate
- Audit tracking for delegation actions

Dependencies:

- Depends on Phase 2 because assignments must exist
- Depends on Phase 7 because SLA and escalation integration is required

### Phase 9. Bulk Actions & Admin Controls

Estimated time: `8 hours`

Includes:

- Bulk assignment
- Bulk reminders
- Bulk close actions
- Filtering and preview support
- Admin override controls

Dependencies:

- Depends on Phase 2 because assignments must exist
- Depends on Phase 7 because notifications must exist

### Phase 10. Audit, Reporting & Dashboards

Estimated time: `8 hours`

Includes:

- Audit logs with full tracking
- HR dashboard for cycle progress and SLA breaches
- Manager dashboard for team view
- Employee dashboard for status view
- Basic reporting APIs

Dependencies:

- Depends on all previous phases because complete data is required

### Phase 11. Deploy and Test

Estimated time: `8 hours`

Includes:

- Deployment preparation
- Environment-level validation
- Basic integration testing
- UAT support for final verification
- Release readiness checks

Dependencies:

- Depends on all previous phases because all module components must be available before deployment and test closure

## 4. Dependency Order

Recommended build order:

1. Phase 1 -> Template & Form Builder
2. Phase 2 -> Cycle Management & Assignment
3. Phase 3 -> Workflow Engine (State Machine)
4. Phase 4 -> Goal Setting & Self Review (Employee Flow)
5. Phase 5 -> Manager Review & Evaluation
6. Phase 6 -> Acceptance, Finalization & Reopen
7. Phase 7 -> SLA, Notifications & Escalation
8. Phase 8 -> Delegation & Reassignment
9. Phase 9 -> Bulk Actions & Admin Controls
10. Phase 10 -> Audit, Reporting & Dashboards
11. Phase 11 -> Deploy and Test

## 5. Planning Note

This final structure is clear and valid for implementation planning.

With the selected values above, the working estimate is `138 hours`.

This is more realistic than forcing a `120-hour` target for the current scope. If further reduction is needed, the next candidates to trim are advanced audit and reporting depth and non-essential admin controls.
