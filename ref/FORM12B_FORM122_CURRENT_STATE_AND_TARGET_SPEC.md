# Form 12B / Form 122: Current State, Correct Tax Treatment, and Target HRMS Specification

**Status:** Proposed authoritative specification  
**Prepared:** 23 September 2026  
**Scope:** India tax declaration, previous-employer salary/TDS, employee submission, admin processing, and payroll TDS recalculation

## 1. Purpose

This document separates three subjects that must not be confused:

1. The legally relevant treatment of salary and TDS from another employer.
2. What the HRMS currently stores and calculates.
3. The target Form 12B/Form 122 workflow and calculation behaviour.

The key implementation rule is:

```text
Previous-employer salary
        +
Current-employer salary
        ↓
Combined salary income
        ↓
Apply the employee's selected tax regime
        ↓
Apply eligible exemptions/deductions and one standard deduction
        ↓
Calculate tax, rebate/marginal relief, and cess
        ↓
Less previous-employer TDS
        ↓
Less current-employer TDS already deducted
        ↓
Remaining TDS to distribute across unprocessed payroll months
```

Form 12B/122 is not an old-regime investment deduction. Previous-employer salary and TDS are relevant under both old and new regimes. The selected regime determines how combined income is taxed.

## 2. Official tax basis

### 2.1 Multiple employers

Where an employee has worked for more than one employer during the year, the current/chosen employer must take into account the salary income due or received from the other employer and the tax deducted from it for salary-TDS calculation.

This means the calculation must use aggregate salary. It is not correct to calculate tax only on the current employer's salary and then subtract the previous employer's TDS.

### 2.2 Salary amount to use

Use salary due or received during the tax year. Do not derive taxable salary merely as `monthly CTC × number of months`.

- For a partial month, use the amount due/paid through payroll for that partial period.
- If there is an employment gap, no artificial zero-salary record is needed. There is simply no salary income for that gap.
- Use the appropriate salary components reported in the signed statutory form and supporting Form 16/payroll records.
- Do not treat CTC as taxable salary automatically.
- Apply the standard deduction once against aggregate salary, not separately for every employer.

### 2.3 Form naming from 2026-27

For periods governed by the Income-tax Act, 2025 and Income-tax Rules, 2026, Form 122 replaces/consolidates the earlier Forms 12B and 12BAA.

- For FY 2025-26 and earlier applicable periods, retain the applicable Form 12B terminology.
- For tax year 2026-27 onward, use the applicable Form 122 employee-facing template and terminology.
- Internal code may temporarily retain names such as `Form12B`, but the released statutory template and UI label must correspond to the selected tax year.

### 2.4 Official references

- [Income Tax Department: Section 192](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-192-3)
- [Income Tax Department: Income from Salary](https://www.incometaxindia.gov.in/en/income-from-salary)
- [Income Tax Department: Form 122 FAQ (earlier Forms 12B and 12BAA)](https://www.incometaxindia.gov.in/documents/d/guest/form-122-faqs)
- [Income Tax Department: Form 122 guidance note](https://www.incometaxindia.gov.in/documents/d/guest/fn-122)
- [Income Tax Department: Return schedule showing total gross salary from all employers](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-04/Notification_No_47_2026.pdf)

This document is an HRMS implementation specification, not a substitute for review by the organisation's payroll/tax adviser when rules or forms change.

## 3. Correct status-to-calculation behaviour

| Form status | Use previous salary? | Use previous TDS? | Tax calculation |
| --- | ---: | ---: | --- |
| Not released/not submitted | No | No | Current-employer data only |
| Released | No | No | Current-employer data only |
| Pending admin review | No | No | Current-employer data only |
| Rejected | No | No | Current-employer data only |
| Verified | Yes | Yes | Combined salary calculation |

Only a verified Form 12B/122 can affect tax.

Rejection must not apply the previous salary or previous TDS and must not invoke a Form 12B tax adjustment.

## 4. Current HRMS data model

### 4.1 Tax declaration record

The current `TaxDeclaration` model stores the following relevant fields:

| Field | Current purpose |
| --- | --- |
| `employeeId` | Employee owning the declaration |
| `financialYear` | Declaration FY, such as `2026-2027` |
| `regime` | `old` or `new` |
| `annualGross` | Gross salary calculated from this HRMS's salary assignments |
| `standardDeduction` | Standard deduction configured on the selected tax slab |
| `ptDeduction` | Professional-tax deduction calculated by the service |
| `declarations` | Employee investment/exemption declarations |
| `totalDeclaredAmount` | Total amount declared by the employee |
| `totalVerifiedAmount` | Amount verified by admin |
| `calculatedTaxAmount` | Slab-based tax before subsequent adjustments |
| `revisedTaxAmount` | Current revised annual liability used by payroll |
| `previousTaxAmount` | Liability before the most recent adjustment |
| `taxPaid` | Current-employer tax already processed/paid in HRMS |
| `remainingTaxToPay` | Remaining annual tax after tax already paid |
| `initialTaxBreakdown` | Detailed tax, rebate, relief, cess, and Form 12B fields |
| `monthlyDeductions` | April-March deduction plan and processed state |
| `form12B` | Reference to the Form 12B document |
| `isForm12BApplicable` | Whether the Form 12B UI/upload is enabled |
| `isMigrationAdjusted` | Prevents automatic monthly-plan replacement for migrated records |
| `isSubmissionsEnabled` | Controls employee declaration submission access |

The breakdown currently contains:

```ts
{
  taxAmount,
  slabwiseTax,
  taxableIncome,
  rebateAmount,
  marginalReliefAmount,
  totalTaxAmount,
  cessAmount,
  taxWithCess,
  form12bTDSAmount,
  finalTaxWithCess,
  ptDeduction
}
```

Current intended meanings:

```text
taxWithCess       = tax after rebate/relief plus cess, before Form 12B TDS
form12bTDSAmount  = verified TDS deducted by the previous employer
finalTaxWithCess  = max(0, taxWithCess - form12bTDSAmount)
```

### 4.2 Current Form 12B document data

The current `Document` record uses `type: "Form12B"` and stores:

```ts
metadata.form12B = {
  financialYear,
  previousEmployer: {
    name,
    pan,
    tan
  },
  employmentPeriod: {
    startDate,
    endDate
  },
  salaryEarned,
  tdsDeducted,
  status,
  isLocked,
  comments
}
```

The physical PDF is stored through the document's `fileName` and `filePath` fields. The document also maintains an audit log.

### 4.3 Current status values

The existing Form 12B flow uses:

- `Pending`
- `Verified`
- `Rejected`
- `ResubmissionRequested`

The new immutable employee-upload requirement should not use `ResubmissionRequested`, because it expressly prohibits employee replacement or re-upload after submission.

## 5. Current implementation flow

### 5.1 Eligibility during declaration creation

`TaxDeclarationService.create()` currently sets `isForm12BApplicable` when the employee's joining date falls between the start and end of the selected FY.

This check does not currently depend on the employee's tax regime.

### 5.2 Admin bulk enable

`bulkEnableForm12B()` currently:

1. Accepts employee IDs and a financial year.
2. Finds the employee's tax declaration for that FY.
3. Sets `isForm12BApplicable = true`.

It does not create a release record, store a template version, or independently validate new-joinee eligibility.

### 5.3 Current annual gross

`calculateAnnualGross()` currently reads `SalaryAssignment` records belonging to the employee in this HRMS and calculates:

```text
monthlyGross × overlapping assignment months
```

It does not include previous-employer salary from Form 12B.

It also counts an overlapping month as a month; therefore partial-month accuracy depends on the salary-assignment/payroll data already being prorated correctly. The Form 12B calculation must use the reported previous-employer amount rather than independently guessing month counts.

### 5.4 Initial tax calculation

`calculateIncomeTax()` currently supports both regimes:

- It ignores investment declarations under the new regime.
- It applies the configured standard deduction.
- It calculates slab-wise tax.
- It applies regime-specific rebate/marginal-relief logic.
- It adds cess.
- It initially sets `form12bTDSAmount` to zero.

### 5.5 Current Form 12B upload

`DocumentService.uploadForm12B()` currently:

1. Validates the employee and FY.
2. Validates that `isForm12BApplicable` is true.
3. Stores the entered previous-employer values and uploaded file.
4. Links the Form 12B document to the tax declaration.
5. Supports replacing an existing document and resets it to `Pending`.

This replacement behaviour conflicts with the new immutable submission requirement.

### 5.6 Current approval

`DocumentService.updateForm12BStatus()` currently:

1. Marks the document as `Verified`, `Rejected`, or `ResubmissionRequested`.
2. Locks the document.
3. Calls `processForm12BTDS()` only when status becomes `Verified`.

Calling the tax calculation only for `Verified` is correct. Rejection currently does not trigger a Form 12B tax adjustment.

### 5.7 Current `processForm12BTDS()` calculation

The current method receives only:

```ts
{
  form12bId,
  tdsAmount,
  financialYear
}
```

It currently:

1. Finds a linked and applicable tax declaration.
2. Rejects any declaration whose regime is not `old`.
3. Takes the existing `finalTaxWithCess` as tax before Form 12B.
4. Subtracts previous-employer TDS.
5. Updates revised/remaining tax and future monthly deductions.

Current effective calculation:

```text
Tax on current-employer salary
− Previous-employer TDS
= Remaining annual liability
```

This is incomplete because `salaryEarned` from Form 12B is stored but never used by `processForm12BTDS()`.

## 6. Current implementation gaps

### Gap 1: Previous salary is ignored

The system stores `salaryEarned`, but tax is still calculated only from this HRMS's salary assignments. Subtracting previous TDS without first including previous salary can undercalculate tax.

### Gap 2: Artificial old-regime restriction

`processForm12BTDS()` throws when `regime !== "old"`, even though `calculateIncomeTax()` already supports old and new regimes.

Removing this guard is necessary, but removing it alone is not sufficient. Previous salary must also enter the combined-income calculation.

### Gap 3: Form 12B is applied as a one-time adjustment

The employee declaration `update()` path explicitly reapplies verified Form 12B TDS, but `recalculateTax()` does not include Form 12B salary or TDS.

Consequently, a later admin verification/rejection of investment declarations can overwrite the breakdown and lose the Form 12B effect.

The Form 12B calculation must be part of the central recalculation path.

### Gap 4: Employee re-upload is currently possible

The service can replace an existing Form 12B file and reset status to `Pending`. The target requirement says the signed employee document must be immutable immediately after final submission.

### Gap 5: Current employee and admin responsibilities are mixed

The current employee form collects the structured salary/TDS fields and the document in one operation. The target requirement says:

- Employee downloads, completes, signs, and uploads the statutory document.
- Admin uses that immutable document as a reference and enters/edits structured Form 12B values.

These should be distinct workflow stages.

### Gap 6: Release is only a boolean flag

The current system has no template-release status, release timestamp, template version, or immutable employee-submission timestamp.

### Gap 7: Route authorization requires hardening

The current Form 12B status route has authentication/admin checks commented out. Approval, rejection, and admin value editing must be protected by server-side admin authorization.

### Gap 8: Amount fields are not consistently defined

Some current creation/update paths assign `revisedTaxAmount` from tax before cess while other paths use `finalTaxWithCess`. The target implementation must use one documented meaning consistently:

```text
revisedTaxAmount = annual tax liability after cess and verified external TDS credit
```

## 7. Target functional workflow

### 7.1 Admin releases the template

Admin selects eligible employees and releases the applicable static Form 12B/Form 122 template.

The current FY should be derived server-side and displayed read-only for the normal new-joinee workflow. Do not accept an unrestricted free-text FY from the client.

Recommended eligible employee rules:

- Active employee.
- Not a consultant.
- Not an intern.
- Joining date falls within the current FY/tax year.
- Tax declaration exists for the current year.
- Previous-employment declaration is required.
- Template has not already been released or finally submitted.
- Both old- and new-regime employees are eligible.

Eligibility must be validated again on the server when release is submitted.

After release, the employee sees:

- `Download Form 12B/122 Template`
- `Upload Signed Form 12B/122`

### 7.2 Employee submission

The employee:

1. Downloads the released static template.
2. Completes and signs it outside HRMS.
3. Uploads the signed PDF.
4. Confirms final submission.

Before final submission, show:

> Once submitted, this signed document cannot be edited, deleted, replaced, or uploaded again. Please verify the document before continuing.

After final submission:

- Store the file immutably.
- Store the file checksum/hash where practical.
- Store template version, release time, submission time, and uploader.
- Lock employee mutation APIs server-side.
- Permit employee view/download only.
- Set status to `PendingAdminProcessing`.

### 7.3 Admin processing

Admin can:

- View/download the immutable signed employee document.
- Enter or edit structured previous-employer values.
- Save a draft without affecting tax.
- Approve or reject.

Admin cannot replace or modify the employee's signed PDF.

Recommended structured data:

- Previous employer name.
- Previous employer PAN.
- Previous employer TAN.
- Employment start/end date.
- Salary and other taxable components required by the applicable statutory form.
- Exempt components required by the applicable statutory form.
- Previous-employer TDS.
- Supporting certificate reference, where required.

The current single `salaryEarned` value can be retained for compatibility only if payroll confirms that it represents the correct aggregate amount needed by the tax calculation. Form 122 contains more detailed components; the model should not discard legally relevant values that affect taxable salary.

### 7.4 Approval

Approval must:

1. Validate that required structured data is complete.
2. Mark the structured record `Verified`.
3. Lock further ordinary edits.
4. Recalculate combined income using the selected regime.
5. Apply previous-employer TDS as tax already deducted.
6. Subtract current-employer TDS already processed.
7. Redistribute only the remaining amount across unprocessed payroll months.
8. Write an audit entry containing approver, timestamp, and relevant before/after totals.

### 7.5 Rejection

Rejection must:

- Require a reason.
- Keep the employee's signed file for audit.
- Lock the workflow as rejected.
- Exclude previous salary and TDS from tax calculation.
- Not call `processForm12BTDS()` or any equivalent external-income adjustment.

Because employee re-upload is prohibited, a rejected record is terminal under the normal flow. If the business requires correction of an accidentally uploaded file, define a separately authorized, audited admin exception instead of silently permitting normal re-upload.

## 8. Target calculation for both regimes

### 8.1 Inputs

```text
currentEmployerSalary
verifiedPreviousEmployerSalary
selectedRegime
verifiedDeclarationsAllowedByRegime
standardDeduction
otherApplicableSalaryAdjustments
previousEmployerTDS
currentEmployerTDSAlreadyProcessed
taxSlabs
cessRate
```

### 8.2 Calculation

```text
combinedGrossSalary =
    currentEmployerSalary
    + verifiedPreviousEmployerSalary

taxBreakdown = calculateIncomeTax(
    combinedGrossSalary,
    selectedRegime,
    deductionsPermittedUnderSelectedRegime,
    oneApplicableStandardDeduction,
    selectedRegimeTaxSlabs,
    cessRate,
    otherPermittedAdjustments
)

taxBeforeExternalTDS = taxBreakdown.finalTaxWithCess

taxAfterPreviousEmployerTDS = max(
    0,
    taxBeforeExternalTDS - previousEmployerTDS
)

remainingTDS = max(
    0,
    taxAfterPreviousEmployerTDS - currentEmployerTDSAlreadyProcessed
)
```

The breakdown should preserve both values:

```text
taxWithCess       = liability before previous-employer TDS credit
form12bTDSAmount  = verified previous-employer TDS
finalTaxWithCess  = liability after previous-employer TDS credit
remainingTaxToPay = finalTaxWithCess - current-employer tax already processed
```

Do not add “tax on previous salary” to an independently calculated “tax on current salary.” The progressive slab calculation must run once on combined income.

### 8.3 Regime behaviour

| Behaviour | Old regime | New regime |
| --- | --- | --- |
| Include verified previous salary | Yes | Yes |
| Credit verified previous-employer TDS | Yes | Yes |
| Use regime-specific slabs | Yes | Yes |
| Apply investment declarations | As allowed | Only as allowed by configured new-regime rules |
| Apply standard deduction | Once | Once |
| Recalculate remaining payroll TDS | Yes | Yes |

The following guard must be removed as part of the complete correction:

```ts
if (taxDeclaration.regime !== "old") {
  throw new Error("Form12B TDS processing is only applicable for old regime");
}
```

It must not be removed in isolation. The combined-salary and persistent recalculation changes are required at the same time.

## 9. Recommended calculation integration

Form 12B should not be a fragile one-time mutation of an existing breakdown. Introduce one shared recalculation path used by:

- Initial Form 12B approval.
- Employee declaration updates.
- Admin investment-proof review.
- Salary assignment changes.
- Tax-slab/configuration recalculation.
- Any explicit tax refresh operation.

Suggested responsibility:

```ts
async function recalculateCompleteTaxDeclaration(taxDeclaration) {
  const currentSalary = await calculateAnnualGross(...);
  const verifiedForm = await getVerifiedForm12BOr122(...);
  const previousSalary = verifiedForm?.salaryEarned ?? 0;
  const previousTDS = verifiedForm?.tdsDeducted ?? 0;

  const breakdown = await calculateIncomeTax(
    currentSalary + previousSalary,
    taxDeclaration.regime,
    deductionsAllowedForRegime,
    ...
  );

  breakdown.taxWithCess = breakdown.finalTaxWithCess;
  breakdown.form12bTDSAmount = previousTDS;
  breakdown.finalTaxWithCess = Math.max(
    0,
    breakdown.taxWithCess - previousTDS
  );

  return breakdown;
}
```

Production code must load the verified stored document rather than trusting salary/TDS values supplied by the approval request.

## 10. Recommended workflow records

To avoid changing or overwriting the employee's signed evidence, keep the immutable submission separately identifiable from the structured calculation record.

### Employee release/submission record

Recommended fields:

```ts
{
  employeeId,
  financialYear,
  statutoryFormName,
  templateVersion,
  templatePath,
  releasedAt,
  releasedBy,
  submittedFileName,
  submittedFilePath,
  submittedFileHash,
  submittedAt,
  submittedBy,
  submissionLocked,
  workflowStatus
}
```

### Structured Form 12B/122 calculation record

Recommended fields:

```ts
{
  employeeId,
  financialYear,
  submissionId,
  previousEmployer,
  employmentPeriod,
  salaryComponents,
  salaryEarned,
  tdsDeducted,
  status,
  enteredBy,
  verifiedBy,
  verifiedAt,
  rejectionReason,
  valuesLocked,
  auditLog
}
```

If the existing `Document` model is retained, enforce these two responsibilities through explicit metadata and API rules. Do not allow admin structured-value editing to replace the employee's signed `filePath`.

## 11. Acceptance criteria

### Release and eligibility

- Current FY is derived and validated server-side.
- Only eligible current-year new joinees appear in the normal release selector.
- Old- and new-regime employees can be released a form.
- An existing tax declaration is required.
- Duplicate release/final submission is prevented.
- Correct Form 12B or Form 122 template is chosen for the applicable year.

### Employee submission

- Employee can download the released template.
- Employee can upload one supported signed document.
- Final confirmation clearly states that submission is immutable.
- After submission, edit, replacement, re-upload, and delete APIs are rejected server-side.
- Employee can still view/download the submitted document.

### Admin processing

- Only authorized admins can view all employee submissions.
- Admin can download but cannot replace the signed document.
- Admin can enter/edit structured values while processing is pending.
- Approval requires complete valid values.
- Rejection requires a reason.
- Approved/rejected records are locked and audited.

### Tax calculation

- Pending and rejected records do not affect tax.
- Verified previous salary is included in combined salary.
- Verified previous TDS is applied after tax and cess.
- Both old and new regimes use their configured slabs and permitted deductions.
- Standard deduction is applied once.
- Current-employer processed TDS is not deducted twice.
- Remaining tax is distributed only across unprocessed months.
- Later declaration or salary recalculation preserves Form 12B/122 income and TDS.
- Re-running the same recalculation is idempotent and does not subtract TDS repeatedly.
- Migrated declarations retain their documented monthly-plan override behaviour.

## 12. Required test scenarios

1. Old-regime new joinee with verified previous salary and TDS.
2. New-regime new joinee with verified previous salary and TDS.
3. Partial-month previous employment using actual reported salary.
4. Gap between previous and current employment.
5. One-day/short partial-month employment.
6. Previous salary with zero TDS.
7. Previous TDS greater than calculated remaining liability.
8. Pending Form 12B/122: no tax effect.
9. Rejected Form 12B/122: no tax effect.
10. Verified form followed by employee declaration update.
11. Verified form followed by admin investment-proof approval/rejection.
12. Verified form followed by salary revision.
13. Duplicate approval/recalculation request: no duplicate TDS credit.
14. Processed payroll months remain unchanged; only future months are redistributed.
15. Migration-adjusted declaration preserves migration monthly deductions.
16. Unauthorized user cannot release, edit structured values, approve, or reject.
17. Employee cannot replace the signed file through direct API calls.
18. Correct Form 12B/Form 122 template is released according to the tax year.

## 13. Example

Assume the reported amounts are appropriate salary amounts for tax calculation:

```text
Previous employer:
  April-August salary                  ₹2,50,000
  TDS already deducted                  ₹20,000

Current employer:
  September partial salary              ₹26,667
  October-March salary                 ₹6,00,000

Combined salary                        ₹8,76,667
```

The system must calculate tax once on the combined salary under the selected regime, after applying the legally/configurationally applicable exemptions and deductions. It must then credit ₹20,000 of verified previous-employer TDS and subtract current-employer TDS already processed to obtain the remaining payroll deduction.

The system must not calculate tax only on ₹6,26,667 and then subtract ₹20,000.

## 14. Implementation decision summary

| Decision | Required behaviour |
| --- | --- |
| Both regimes | Supported |
| Old-regime guard | Remove as part of the complete calculation correction |
| Previous salary | Include only when verified |
| Previous TDS | Credit only when verified |
| Pending/rejected submission | No tax effect |
| Employee signed document | Immutable after final submission |
| Admin document access | View/download only |
| Admin structured values | Editable before approval; locked afterward |
| Current FY | Derived and validated server-side for normal new-joinee release |
| Standard deduction | Apply once to aggregate salary |
| Recalculation | Centralized and idempotent |
| 2026-27 employee-facing form | Form 122 where the new law applies |

## 15. Relevant current code

- `src/services/tax-declaration.service.ts`
  - `calculateAnnualGross()`
  - `create()`
  - `update()`
  - `reviewDeclarations()`
  - `processForm12BTDS()`
  - `calculateIncomeTax()`
  - `recalculateTax()`
  - `updateMonthlyDeductionPlan()`
  - `bulkEnableForm12B()`
- `src/services/document.service.ts`
  - `uploadForm12B()`
  - `updateForm12BStatus()`
- `src/models/tax-declaration.ts`
- `src/models/document.model.ts`
- `src/routes/document.routes.ts`
- `src/routes/tax-declaration.ts`

