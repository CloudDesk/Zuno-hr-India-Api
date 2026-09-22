# Leave Allocation, Balances and Automatic Releases

Date: 11 September 2026

Status: architecture confirmed against the current local server code. Production consistency improvements and end-to-end verification remain outstanding.

Audience: backend, frontend, QA, HR operations and deployment teams.

## 1. Agreed architecture

Keep scheduling rules separate from executed credits. Manual and automatic allocation must use the same release service and the same employee balance store.

```text
Admin submits a manual release ------------------------+
                                                      |
Cron reads a due leavereleaseconfigurations document ---+
                                                      v
                               LeaveReleaseService.releaseLeaves()
                                                      |
                         +----------------------------+------------------+
                         v                                               v
             Create leavereleases                         Create/update leavesummaries
             One record per employee                      Employee + year + category
```

This is already the normal release path in the inspected code. No separate automatic balance collection is needed. A configuration is an instruction to execute in the future; a release is evidence of an allocation event.

Do not remove `leavereleaseconfigurations` while the application owns recurring rules. An `automatic` flag on a completed release cannot independently express future employee selection, recurrence, effective dates, pause state and next execution time.

Important distinction: manually inserting a `leavereleases` document does not credit an employee. The shared service performs both writes; there is no release-model hook that automatically updates the summary.

## 2. Scope and evidence

This document describes inspected local code, not verified live MongoDB records or deployed behavior. Collection names below follow the models' default Mongoose naming. Confirm actual names/indexes in the target database before migrations.

Relative links in this document are relative to `Server/docs/`.

| Source | Responsibility |
| --- | --- |
| [Leave summary model](../src/models/leave-summary.model.ts) | Yearly balance schema and remaining calculation |
| [Leave model](../src/models/leave.model.ts) | Applications, status and actors |
| [Release model](../src/models/leave-release.model.ts) | Release source, period, references and adjustments |
| [Configuration model](../src/models/leave-release-configuration.model.ts) | Recurrence and execution state |
| [Carry-forward model](../src/models/leave-carry-forward.model.ts) | Inter-year transfer audit |
| [Release service](../src/services/leave-release.service.ts) | Shared credit and automatic-release reduction |
| [Configuration service](../src/services/leave-release-configuration.service.ts) | Claims due schedules and invokes shared credits |
| [Summary service](../src/services/leave-summary.service.ts) | Allotment, reservation, restoration and reporting |
| [Leave service](../src/services/leave.service.ts) | Apply, approve, reject and withdraw |
| [Carry-forward service](../src/services/leave-carry-forward.service.ts) | Source/destination year updates |
| [Cron registration](../src/utilis/corn.ts) | Automatic release scheduling |

No application code or database data was changed in preparing this document.

## 3. Collections and references

| Collection | Stores | References |
| --- | --- | --- |
| `leavesummaries` | Employee's yearly allocation, usage/reservation and available balance | `userId -> users`; each category's `leaveRequests[] -> leaves`; `editHistory.editedBy.id -> users` |
| `leaves` | Individual leave applications, dates, day counts, status and approval actors | `userId -> users`; `leaveTypeId -> lovs`; actor references -> users |
| `leavereleases` | Manual/automatic credits and release adjustments | `employeeId`, `releasedBy`, `adjustments.adjustedBy -> users`; `automationConfigurationId -> leavereleaseconfigurations`; `duplicateOfReleaseId -> leavereleases` |
| `leavecarryforwards` | Transfer amount, source/destination years and forfeiture audit | `employeeId`, `processedBy -> users` |
| `leavereleaseconfigurations` | Automatic rules and execution metadata | `employeeIds[]`, `createdBy`, `updatedBy -> users` |

`ref` declarations support Mongoose population; they are not SQL foreign-key constraints. Application validation is still required.

### Logical release-to-summary join

There is no `releaseId` array or direct release reference in the summary:

```text
leavereleases.employeeId  = leavesummaries.userId
leavereleases.period.year = leavesummaries.year
leavereleases.leaveType   = summary category key
```

Known categories use top-level fields. Additional leave types use `customLeaveTypes.<type>`. Carry-forward records are associated with summaries by employee and source/destination years. The release-history copy of a carry-forward is not an explicit foreign-key link to its carry-forward audit record.

## 4. Yearly balance structure

`leavesummaries` has a unique compound index on `{ userId, year }`.

```javascript
{
  userId: '<employee-object-id>',
  year: 2026,
  annual: {
    alloted: 20,
    availed: 3,
    remaining: 17,
    leaveRequests: ['<request-object-id>']
  },
  customLeaveTypes: {},
  editHistory: []
}
```

The actual field spelling is `alloted`, not `allotted`. Retain it unless a deliberate schema/API migration is approved.

| Field | Current meaning |
| --- | --- |
| `alloted` | Current total allocation, including credited carry-forward and allocation adjustments |
| `availed` | Reserved/consumed days; includes Pending applications in the main flow |
| `remaining` | Normally `max(0, alloted - availed)` |
| `leaveRequests` | Application IDs contributing to reservation/usage; removed on restoration |
| `editHistory` | Allotment edit metadata where recorded by the update service |

Built-in categories: annual, sick, compOff, lossOfPay, otherPaid, otherUnpaid, maternity, workFromHome and restricted_holiday. Configured additional types can live in `customLeaveTypes`.

`getLeaveSummary()` can create a missing employee/year document with zero balances. Therefore, requesting a summary is not necessarily read-only. Initializing a summary does not itself grant leave entitlement.

## 5. Manual release flow

1. Admin submits employees, category, release type, period and days.
2. The route calls `LeaveReleaseService.releaseLeaves()`.
3. The service validates and classifies employees/releases, including existing-period and request-ID handling.
4. For each eligible employee, it creates a `leavereleases` document.
5. It obtains or creates the corresponding yearly summary.
6. It passes the increased allotment to `updateLeaveAllotments()`.
7. The service returns per-request results and handles the release notification path.

```text
existing allocation = 10
release amount       = 1.5
existing availed     = 3

new allocation       = 11.5
new remaining        = 8.5
```

Typical release metadata:

```javascript
{
  employeeId: '<employee-id>',
  releaseType: 'monthly',
  period: { year: 2026, month: 9 },
  leaveType: 'annual',
  daysReleased: 1.5,
  source: 'manual',
  releasedBy: '<admin-user-id>',
  requestId: '<submission-id>'
}
```

The model currently supports `daily`, `monthly`, `quarterly`, `annual` and `carryforward` release types. Normal shared release input supports daily/monthly/quarterly/annual; carry-forward uses its own service. Source and release type are separate dimensions: a monthly release can be manual or automatic.

## 6. Automatic release flow

### Rule storage

`leavereleaseconfigurations` stores the category, frequency, days per release, employee list, effective start/end, active/paused/inactive state, next execution date, last execution result, processing lock, and creator/updater.

Saving a rule is not an allocation credit. Credit occurs when execution invokes the shared release service.

### Execution

1. Registered cron invokes `processDueConfigurations()`.
2. The service identifies eligible active rules due by the current India business date.
3. It claims each rule using `processingAt` and a unique `processingToken`; stale-lock threshold is 30 minutes in the current code.
4. It resolves the configuration creator to build execution context.
5. It maps yearly frequency to annual release type and constructs the applicable period, including day/month for daily releases.
6. It invokes the same `releaseLeaves()` method used by manual submission.
7. Each successful employee receives a release record and an increased summary allocation.
8. It records execution status, advances `nextRunAt`, and clears its lock.

Automatic invocation includes:

```javascript
{
  source: 'automatic',
  automationConfigurationId: '<configuration-id>',
  scheduledFor: '<due-date>',
  requestId: 'auto:<configuration-id>:<due-date-YYYY-MM-DD>',
  skipExisting: true
}
```

`releasedBy` currently refers to the configuration creator through execution context. `source` identifies system execution; the actor field does not mean the creator manually clicked for that occurrence.

### What execution writes

| Collection | Write |
| --- | --- |
| `leavereleaseconfigurations` | Lock, last-run status/message/time, next run, possible inactive/paused state |
| `leavereleases` | One credit record per processed employee, linked to configuration |
| `leavesummaries` | Create if missing; increase allocation and recalculate remaining |

Current failure behavior needs attention: a returned result with failed employees still advances the schedule. A thrown execution error pauses the configuration. Failed employees therefore require an explicit recovery policy; do not assume every failure is automatically retried for the same due occurrence.

The latest cron uses configured schedule/timezone variables. Confirm actual deployed values, process startup and runtime availability. An in-process cron is not a guarantee that execution happens while a serverless instance is stopped or unavailable.

## 7. Release adjustments and direct allotment edits

### Automatic-release reduction

The current `reduceAutomaticRelease()` path:

- Allows reductions only on automatic releases.
- Requires a reason and positive half-day increments.
- Limits reduction to the original release amount minus earlier reductions, and to current allocation.
- Decreases yearly allocation through the summary service.
- Appends `daysReduced`, reason, actor and timestamp to `release.adjustments`.
- Attempts to restore the old allocation if saving adjustment history fails.

The original `daysReleased` is retained, but the document is not wholly immutable because adjustments are appended.

```text
effective release credit = daysReleased - sum(adjustments.daysReduced)
```

Reports and reconciliation must account for reductions. A business rule is still needed for reducing allocation below already reserved/used days: clamping remaining to zero does not explain or resolve that deficit.

### Direct allotment editing is different

`updateLeaveAllotments()` sets the total allocation provided; it does not inherently create a release record.

| Starting allocation | Operation | Result |
| --- | --- | --- |
| 20 | Release 5 | 25 |
| 20 | Set allotment to 5 | 5 |

Consequently, release history is not currently a complete accounting ledger of every allocation change. Recommended target: preserve the admin editing UI but record the signed allocation delta, actor and reason as an auditable event, atomically with the balance update. Do not silently call an absolute replacement an additive release.

Historical balances will need an opening-balance/reconciliation strategy if a complete ledger is adopted. Do not assume summing old releases reproduces existing summaries.

## 8. Applying and taking leave

| Event | `leaves` write | Summary write |
| --- | --- | --- |
| Application | Create request, normally Pending | Increase availed, decrease remaining, add request ID |
| Approval | Update status/approval metadata | No second reservation deduction |
| Rejection | Update rejection state/metadata | Reduce availed, recalculate remaining, remove request ID |
| Employee withdrawal | Preserve request as Cancelled | Restore reserved days and remove request ID |

The employee withdrawal method currently permits Pending requests only. Approval processing also affects attendance; attendance is not the authoritative allocation store.

The main application balance check calculates `alloted - availed`. Some unpaid categories bypass that check; restricted holiday has separate validation. The full request is charged to the start-date year by the inspected creation path. Cross-year leave therefore needs an explicit splitting/reconciliation rule before claiming accurate per-year consumption.

Example: allocate 10, apply for 2 -> availed 2 and remaining 8 while Pending. Approve -> still 2 and 8. Reject/withdraw instead -> availed 0 and remaining 10, assuming restoration succeeds.

## 9. Carry-forward

Current service is restricted to India employees and the next consecutive year. It checks an existing source summary, positive available balance, positive transfer amount not exceeding that balance, and an existing-transfer lookup.

It performs four related operations:

1. Creates `leavecarryforwards` with source/destination years, amount, balance-before, forfeited amount and actor.
2. Directly reduces the source summary's stored remaining by the transferred amount, leaving allocation and availed unchanged.
3. Creates/loads destination summary and adds transferred days to its allocation.
4. Attempts a carryforward `leavereleases` history record for the destination year; failure of this history write does not fail the already processed transfer.

### Known inconsistency

```text
Before: source alloted=20, availed=10, remaining=10
Transfer 5:
  source alloted=20, availed=10, remaining=5
  destination alloted increases by 5
  transfer audit daysForfeited=5
```

The source's normal formula still produces 10. A later save or balance calculation can restore/ignore the transfer adjustment. The recorded forfeited remainder is also left as stored source remaining in this example. This is not a consistent year-close model.

Recommended target, requiring implementation and policy agreement: represent transfer-out and forfeiture explicitly, preserve actual leave usage, calculate remaining consistently everywhere, and credit destination only once. A close-year process should distinguish pending applications, historical edits and late approvals. Do not fix this by marking carried days as leave taken.

The carry-forward model's supported categories are narrower than all summary/custom types; extending it requires coordinated schema, validation and UI changes.

## 10. Current consistency limits

| Concern | Why it matters | Required production work |
| --- | --- | --- |
| Release creation and summary update are separate writes | Crash can leave history without credit; request replay may see history and skip credit | Transactional credit or a recoverable operation state machine |
| Read-add-write allocation updates | Concurrent releases can overwrite each other's increments | Atomic increments/transactional conflict handling |
| Request ID is optional | Not every submission has replay protection | Require stable keys for credit operations and confirm unique indexes exist |
| Rule lock is time-limited | Long execution can overlap a reclaimed rule | Lease handling plus per-employee operation uniqueness |
| Partial failure advances schedule | Failed employees can miss that occurrence | Persist/retry failed targets without replaying successes |
| Reduction and adjustment history are separate writes | Compensation can fail or overwrite concurrent changes | Atomic audit and balance mutation |
| Carry-forward lookup lacks a unique transfer index | Concurrent requests can pass the same existence check | Unique employee/fromYear/toYear/category operation identity |
| Restore errors are caught while status continues | Cancelled/rejected leave may still consume balance | Atomic request/status and reservation transition |
| Multiple reporting calculations | Annual usage includes Pending; quarterly usage reads Approved | Explicit pending/approved metrics and consistent contracts |
| Legacy balance method is a placeholder | Fixed allocation 20 and application count can mislead consumers | Route consumers to authoritative summaries or replace the method |

For MongoDB transactions, confirm target deployment supports transactions and pass the same session to every participating operation. Keep notifications outside the transaction, preferably through an outbox. A transaction added to only one write does not solve cross-collection consistency.

## 11. Proposed production invariants

These are target requirements, not claims about completed implementation:

- Every committed release has exactly one corresponding allocation effect.
- Replaying the same employee/operation key never credits twice.
- A failed allocation never appears as an unqualified successful credit.
- Multiple employees in a batch have independently recoverable outcomes.
- Manual and automatic credits share validation, precision, audit and balance logic.
- Schedule edits affect future instructions, not historical credited amounts.
- Pausing a configuration stops future execution and does not reverse past credits.
- Adjustments preserve original credit history and record who changed the effective amount.
- Carry-forward source, destination and audit are consistent under one policy.
- Rejection/withdrawal restores a reservation at most once.
- Summary reporting and application validation use the same availability rules.

## 12. Team implementation plan

### Phase 1: confirm deployed reality

Identify the deployed commit, actual database names/indexes, runtime cron settings, active schedules, provider of scheduler execution and current summary/report consumers. Inspect historical inconsistencies read-only before any backfill.

### Phase 2: strengthen the shared release operation

Use a stable per-employee operation key. Make history and balance effects atomic. Preserve manual override semantics separately from replay identity. Test concurrent different requests and identical replays. Add a recovery strategy for operations created before the fix.

### Phase 3: make scheduling recoverable

Track per-occurrence employee outcomes. Retry failed targets using original keys. Define pause/resume, missed occurrences, expired schedules and creator removal behavior. Ensure the runtime scheduler runs reliably in the deployed hosting model.

### Phase 4: unify adjustment and carry-forward accounting

Agree whether all allocation changes become ledger events. Preserve absolute admin editing semantics via explicit deltas. Correct carry-forward and year-close calculation across saving, applying, reporting and reconciliation. Include reduction history in effective-credit totals.

### Phase 5: verify and migrate

Dry-run reconciliation, export discrepancies for approval, repair only agreed records, deploy with monitored execution and validate employee-level balances. Avoid automatic mass recalculation from an incomplete historical release ledger.

## 13. QA acceptance matrix

| Scenario | Expected result |
| --- | --- |
| Manual release, existing summary | One release; allocation increases exactly once |
| Manual release, missing summary | Zero-initialized yearly summary plus intended credit |
| Automatic due rule | Automatic release links to rule; same balance result as manual |
| Paused/future rule | No credit |
| Same request submitted twice | One allocation effect |
| Two concurrent legitimate credits | Both amounts preserved |
| Crash between history/balance writes | Atomic rollback or detectable recoverable operation |
| One employee fails in batch | Successful targets preserved; failed target recoverable |
| Schedule owner missing | Visible failure and defined recovery |
| Automatic reduction | Effective release and summary both decrease once; reason retained |
| Apply Pending leave | Reservation deducted once |
| Approve reserved leave | No second deduction |
| Reject/withdraw retry | Restoration at most once |
| Cross-year request | Agreed year allocation policy applied consistently |
| Carry-forward and subsequent summary save | Transfer cannot be undone by recalculation |
| Duplicate carry-forward | No duplicate destination credit |
| Direct admin allotment edit | Correct absolute total and auditable delta/history |
| Annual vs quarterly display | Clearly defined reservation/approved semantics |

Run focused service/integration tests and the server build. Use a transaction-capable test database for concurrency and failure-injection tests. Code inspection alone cannot establish these acceptance results.

## 14. Team handoff statement

> Architecture confirmed: automatic configurations store schedules; both manual and automatic releases use the same service to create release history and update yearly employee balances. Retain the separate configuration collection. Complete transactional consistency, retry/recovery, adjustment accounting and carry-forward corrections before declaring the implementation production-complete.

This document does not authorize data repairs or imply that identified fixes have been implemented.
