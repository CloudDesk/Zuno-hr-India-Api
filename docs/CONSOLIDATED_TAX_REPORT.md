# Consolidated Tax Report

## Current display rules (supersede earlier display and omission notes below)

The user's latest instruction restores all 60 reference columns in their exact original order. Previous PF and all surcharge display columns are numeric zero. Previous PT shows the optional Form 12B metadata.professionalTax value when it is a nonnegative number, otherwise zero. The Form 12B entry flow currently has no PT input; this read-only adapter does not add one or substitute current-employer PT. Previous PT is display-only and does not alter deductions.

PDF-defined values retain their calculations and missing-data warnings. Extra Excel fields not defined in the PDF are numeric zero placeholders, including Direct TDS, Section 89 relief, paid tax, recovery, balances, override and tax rate. The old mapping of stored taxPaid/remainingTaxToPay/monthlyDeductions has been removed from the report per this latest instruction; those existing records are not changed. Zero placeholder columns never feed any calculation and do not claim that actual payroll balances are zero. Rebate remains the calculated Section 87A relief referenced by the PDF. All columns stay visible even with zeros, blanks or no employees.

Combined salary and standard-deduction calculations remain unchanged. Missing required PDF values are blank, not fabricated zeros. Update Excel is required to replace a previously saved report with this format.


Entry point: Admin → Tax Reports → Consolidated Tax Report.
Endpoints: `GET /consolidated-tax-report/` (preview) and `GET /consolidated-tax-report/export` (Excel).
All require authentication and the administrator role. Responses use `Cache-Control: no-store`.

## Isolation from existing workflows

The new module only queries employee, salary-assignment, declaration, slab, document and organization-profile records. It never invokes tax recalculation, changes a source document, initiates payroll, changes deduction schedules or runs migrations. Existing tax/Form 16 calculators, models and services are unchanged. The only integration changes are registration of a separate route plugin and an additional tab on the tax reports page.

## Inputs and interpretation

- PDF: `Consolidated_Tax_Report_Specification (1).pdf`, two pages.
- Workbook: `CONSOLIDATED INCOME TAX REPORT XCEL.xlsx`, Sheet1, A1:BH5. There are 60 headers but no data rows or formulas.
- Annual gross is the saved FY declaration salary projection, which the existing workflow builds from salary assignments and revisions. It is not changed to actual payroll or recalculated on a GET request.
- Basic and HRA amounts use actual salary structure percentages for the employment months. Missing/overlapping history, or history that fails to reconcile to annual gross, leaves these amounts unavailable. Existing whole-month tax projection conventions remain in force; partial-month cases are flagged.
- Standard deduction comes from exactly one active slab record for the selected FY and regime. Missing/duplicate records leave dependent amounts blank.
- Only verified deductions are used. Old-regime HRA, PT and house-property handling follow the PDF. Chapter VI-A includes the PDF's 80C, 80D, 80DD, 80E, 80GG, 80CCD(2), using verified amounts and supplied caps; aggregate 80C is capped at 150,000. The new regime permits 80CCD(2) from this list. Existing stored approval limits remain the source for other caps.
- Verified house-property amounts use the declaration's income/loss type for their sign. Positive income is not reduced by a deduction ceiling. Property income and losses are netted before the Rs.200,000 salary-setoff limit is applied. The Section 87A relief column includes marginal relief when applicable.
- The template heading “Standard Deduction : Sec 16(ia)” contains standard deduction plus PT, as explicitly defined in the PDF. “Round off to 10 Rs.” contains exactly the taxable-income value, without rounding to ten.
- Slab tax uses configured rates. Rebate/marginal-relief rules are explicitly limited to supported FYs 2024-2025, 2025-2026 and 2026-2027. The 4% cess rate must agree with the configuration. The calculation assumes ordinary salaried resident-individual income, as do the existing regime calculations; special-rate income is outside this specification.
- Differences from the saved tax liability are reported, never written back. Migration adjustments remain unchanged.

## Unresolved source/specification gaps

Previous PF and surcharge columns are excluded by the user's instruction. No structured previous-PT field exists in the current Form 12B model, submission route or details-update flow. Direct TDS and Section 89 relief also have no structured source found in this checkout. These are not fabricated or copied from current-employer PT. Adding inputs or extracting them from uploaded forms requires a separate source decision.

The report now maps Tax Paid Till Date directly from declaration.taxPaid, Tax Balance from declaration.remainingTaxToPay, and current-month recovery from the unique processed monthlyDeductions entry for the selected FY and generation month in Asia/Kolkata. Unprocessed actualDeduction values are planned amounts in this system and are not reported as recovered. These snapshots retain all existing adjustments; they are not recomputed from the new combined-salary liability. Component-wise paid/balance amounts and other unmapped reference columns remain omitted.
Verified Form 12B salary and TDS are displayed. TDS is split at 4% cess when the no-surcharge assumption is supportable: income tax = TDS / 1.04, cess = total minus income tax, rounded to paise. Above the prior-salary surcharge threshold, the split stays unavailable.

The user subsequently authorized aggregating verified previous-employer salary for annual report tax. Current gross stays separately displayed; Income After Exemption now equals current gross plus verified previous gross minus approved current HRA exemption. Standard deduction is applied once to the combined salary. Previous TDS is displayed separately, not deducted from income or annual liability, and not credited again against stored balances. Unverified, missing-required, invalid or duplicate Form 12B sources leave dependent combined-income/tax fields unavailable with warnings.

This changes only the new report calculation. Existing payroll currently credits previous TDS without aggregating previous salary. Consequently the report's combined-salary annual tax may differ from the unchanged stored remaining balance/recovery plan; the report explicitly warns about this.
Surcharge calculations above 50 lakh taxable income are not specified: final liability is unavailable rather than displaying zero surcharge. Unsupported FYs and invalid/gapped tax slabs are also flagged.

## Preview and export

The admin workflow selects only financial year and includes all eligible Indian employees employed in that year (existing consultancy/intern exclusions apply). Preview is paginated; generation is not filtered or truncated at 1,000 employees.

GET /status returns saved metadata. GET /preflight lists missing, ambiguous or unapproved declarations, including Form 12B. The UI offers Cancel and Generate anyway. Warnings do not prevent generation or exclude employees. Only verified deductions enter calculations, and no declaration is automatically approved.

POST /generate accepts the year and records the authenticated admin. It creates or replaces the single current workbook for that year. GET /export downloads the saved bytes without recalculation. Source changes appear after Update Excel; live preview is labelled separately.

A dedicated consolidated_tax_reports collection uses FY as primary key. Private GridFS files in consolidatedTaxReportFiles are accessible only through the admin route. A token-qualified 10-minute lease prevents concurrent updates. The pointer changes after upload completes; failures preserve the prior file. Retired files are removed after publication. Failed cleanup or uncertain database acknowledgements may retain a private orphan, never another current report. Existing payroll and declaration collections remain unchanged.

`Sheet1` retains the three merged organization/FY heading rows and relative reference-column ordering. It has wrapped dark headers, typed numeric/date cells, text employee codes, filters and frozen identifiers/headings. Real computed zeros are preserved. Optional columns are omitted only when no matching row has an applicable nonzero value.

`Report Notes` includes the reporting basis, unsupported columns, generation timestamp and every employee warning. Preview and generation use the same read-only builder. Downloads return the saved workbook and its warnings at generation time.

## Verification

- Pure calculation tests cover salary revisions, structure changes, missing and overlapping sources, regime eligibility, pending deductions, aggregate 80C, signed property losses, exact TDS splitting, fiscal-year rebate boundaries and unsupported cases.
- Fastify injection tests cover unauthenticated/staff/manager denial, admin preview, filter validation, no-store headers and exporting beyond a preview page.
- Excel round-trip tests cover template column order, typed dates/amounts, leading-zero employee IDs, literal formula-like text and the review-notes sheet.
- Existing Form 12B and Form 16 tests run unchanged.

### Review on 30 September 2026

Corrected positive house-property income being capped as a deduction, validation of negative previous salary, and omission of marginal relief from the Section 87A relief column. Invalid nonfinite/negative taxable inputs are rejected. These corrections are confined to the consolidated report calculator.

66 distinct tests passed across eight suites (full 61-test run, then the expanded route suite and new four-test storage suite). API TypeScript checking passed. Browser checks passed for preview pagination, warning before generation, cancellation, generate anyway, saved XLSX download and update. The downloaded workbook's 31 implemented columns were checked against all 60 source headers: labels and relative order agree. Omitted fields remain documented above, not silently treated as zero.

Lease ownership, replacement ordering, failed updates, lost commit acknowledgements and download/update races are covered with mocked storage; no live MongoDB/GridFS integration or deployment was performed. The unchanged frontend still has its previously recorded 219 errors / 369 warnings elsewhere, with none in the report files. Existing payroll, declaration, Form 12B and Form 16 source modules were not edited; integration remains the separate API registration and admin tab.

References for regime eligibility and rebate boundaries:
- https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1
- https://www.incometax.gov.in/iec/foportal/help/new-tax-vs-old-tax-regime-faqs

### Latest combined-salary regression check

All 68 tests across eight suites passed after verified previous salary aggregation and stored recovery/balance mapping. API TypeScript checking and the browser generate/warn/cancel/update/download checks passed. Existing calculation and approval modules remain unmodified. No live database verification or deployment was performed.

Remaining source limitations were rechecked: Form 12B has salaryEarned and tdsDeducted but no structured previous PT field. No Direct TDS input was found. The existing Form 16 Section 89 relief value is hardcoded to zero, not a captured relief amount; the consolidated report does not present this placeholder as a verified deduction. These omissions must not be described as full requirement completion.
