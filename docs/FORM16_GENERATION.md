# Form 16 generation configuration

The Form 16 generator uses the existing tax declaration and verified declaration data when available. If an employee has no declaration for the selected financial year, it falls back to actual payroll earnings and professional-tax deductions, with optional declaration exemptions and deductions treated as zero. Employer details are read primarily from `src/config/form16-employer.json`:

```json
{
  "name": "",
  "address": "",
  "email": "",
  "pan": "",
  "tan": "",
  "citName": "",
  "citAddress": ""
}
```

For deployment compatibility, empty JSON fields fall back to the following environment variables:

```env
FORM16_EMPLOYER_NAME=
FORM16_EMPLOYER_ADDRESS=
FORM16_EMPLOYER_EMAIL=
FORM16_EMPLOYER_PAN=
FORM16_EMPLOYER_TAN=
FORM16_CIT_NAME=
FORM16_CIT_ADDRESS=
```

`FORM16_EMPLOYER_NAME` falls back to `COMPANY_NAME`, and `FORM16_EMPLOYER_EMAIL` falls back to `GMAIL_AUTH_USER`. Name, address, PAN, TAN, CIT name, and CIT address are required. Generation fails with a clear validation message if any required value is absent.

## Supported period

The generator accepts any consecutive financial year in `YYYY-YYYY` format for which an active tax slab is configured.

## Source data and access

- Employees must have either a tax declaration or payroll records for the selected financial year and a valid PAN in their government ID profile.
- Only verified declarations are included in exemption and Chapter VI-A totals.
- Sections 13 through 21 are calculated from the taxable income printed in Section 12 using the active tax slab and cess configuration for the selected financial year and regime; a previously stored tax snapshot is not reused.
- Generated PDFs are stored using the existing private document-storage flow and are versioned when regenerated.
- Admins can generate and regenerate reports. The employee who owns a report can view or download it through a short-lived signed URL.
