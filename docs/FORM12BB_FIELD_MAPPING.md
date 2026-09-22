# Form 12BB field mapping

The generator treats the tax declaration as the source of truth and never invents employee claims. Empty source values remain blank; numeric claim values default to zero only where Form 12BB requires an amount.

| Form 12BB field | Source | Rule |
| --- | --- | --- |
| Employee name/address | User profile | Name is required; address stays blank when absent. |
| PAN/Aadhaar | User tax/profile data | Render the available identifier; otherwise leave blank. |
| Financial year | Generation request | Must be `YYYY-YYYY`; declaration values cannot shorten it. |
| Tax regime | Tax declaration | Display as Old Regime or New Regime. |
| Rent and landlord particulars | Verified HRA declaration | Amount, landlord name/PAN and proof names are mapped. Landlord address remains blank because it is not currently captured. |
| LTC | Not currently captured | Render zero/blank until a dedicated declaration field is introduced. |
| Housing-loan interest | Verified house-property declaration | Verified interest and proof names are mapped. Lender particulars remain blank because they are not currently captured. |
| Chapter VI-A | Investment declarations | Human-readable section labels go in Nature of claim, values in Amount and proof names in Evidence/particulars. |
| Section 80CCD(2) | Verified declaration entry | Allowed for new-regime output when present. The generator does not infer an employer contribution from salary data. |
| Other income | Not currently captured | Render zero until an approved source field is introduced. |
| TCS/TDS deduction | Tax declaration `taxPaid` | Interpreted as tax already paid/deducted for this declaration. |
| Verification | User profile | Employee name/full name and available parent name, place and designation; missing parent name renders a writable blank line. |

Regeneration creates a new versioned PDF object and stores up to 20 prior object references in `metadata.form12BB.previousVersions`. The database continues to expose one current report per employee and financial year.
