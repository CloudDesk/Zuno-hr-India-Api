# Production Email Provider Plan

Prepared: 10 September 2026. Status: design and operational runbook; not implemented or deployed.

## 1. Decision and scope

Use Microsoft Graph with application authentication through Google-to-Microsoft workload identity federation for Microsoft delivery. Restrict the application to sending from the HR mailbox. Retain the existing Gmail transport for non-production environments and deliberate operator overrides.

The desired production sender is `myHR@clouddesk.ae`. This address is deployment configuration, never a source-code constant. Microsoft 365 administrators configure access once; their laptop and interactive session are not involved in normal sending. Human HR users retain MFA. The server uses its own workload identity.

This is a security-focused design for the stated Cloud Run environment, not a guarantee against all compromise. A compromised authorized workload can still send as the HR mailbox. Limit deployment access, service-account impersonation, application owners, and runtime permissions accordingly.

This document proposes changes only. No tenant permissions, email deliveries, secrets, application code, or deployed configurations were changed while preparing it.

## 2. Verified repository facts and gaps

Paths below are relative to `Server/`.

| Inspected location | Observed behavior | Required work |
| --- | --- | --- |
| `src/services/email.service.ts` | Main Nodemailer implementation reads `GMAIL_*`; normal and payslip sends use SMTP | Centralize provider selection and delivery |
| `src/services/document.service.ts` | A letter flow accesses `(emailService as any).transporter.sendMail` | Route through the public email interface |
| `src/emails/services/email.service.ts` | Separate implementation contains a hardcoded Gmail credential | Revoke credential with its owner; inspect usage/history and remove credential-bearing duplicate safely |
| `src/config/index.ts` | Placeholder Gmail configuration and `NODE_ENV` defaults | Validate active-provider configuration; add explicit deployment environment |
| `src/types/environment.d.ts` | `NODE_ENV` types describe Node runtime modes | Add email/deployment configuration types |
| `cloudbuildprod.yaml`, `cloudbuildsit.yaml` | Deploy with long `--set-env-vars` arguments and substitution placeholders | Add provider variables and runtime secret references |
| `cloudbuildprod.yaml` | Configures a runtime service account | Audit its scope and reuse only if appropriately isolated, or replace after preserving required access |

The current checkout does not contain the earlier described Outlook transport changes. Compare the deployed image's commit with this checkout before implementation. The observed credential must not be copied into this document, tickets, logs, or examples. Revocation requires the credential owner's action; deleting the source text alone is insufficient.

Unknowns requiring verification: HR mailbox type and primary address, tenant IDs and policies, actual Cloud Run revision configuration, runtime IAM grants, deployment substitution preprocessing, largest real attachments, sending volume, and existing durable job infrastructure. The design does not assume these have been verified.

## 3. Provider selection: exact contract

Introduce two variables:

| Variable | Allowed values | Meaning |
| --- | --- | --- |
| `APP_ENV` | `PROD`, `SIT`, `UAT`, `DEV`, `TEST`, `LOCAL` | Deployment environment; required |
| `EMAIL_PROVIDER` | `AUTO`, `MICROSOFT`, `GMAIL` | Operator selection; defaults to `AUTO` if missing/blank |

Trim and uppercase both inputs. Reject unknown environments and providers at startup. Do not interpret a typo such as `PRDO` as non-production. Keep `NODE_ENV` for Node/framework behavior; it must not select email delivery. SIT may legitimately use `NODE_ENV=production`.

Proposed resolver, not production code:

```typescript
const effectiveProvider = emailProvider === 'AUTO'
  ? (appEnv === 'PROD' ? 'MICROSOFT' : 'GMAIL')
  : emailProvider;
```

| APP_ENV | EMAIL_PROVIDER | Effective provider |
| --- | --- | --- |
| PROD | AUTO or absent | MICROSOFT |
| SIT/UAT/DEV/TEST/LOCAL | AUTO or absent | GMAIL |
| Any valid environment | MICROSOFT | MICROSOFT |
| Any valid environment | GMAIL | GMAIL |
| Missing/invalid environment | Any | Configuration error |
| Any | Invalid provider | Configuration error |

Only the selected provider's credentials are required. Missing Microsoft configuration in PROD must never silently fall back to Gmail. Network/authentication failures do not trigger provider switching. This prevents an unexpected sender change and uncontrolled retries.

Selection applies to all email categories, including reset emails, payslips, letters, and reminders. It is resolved at process startup and captured with each durable job. An environment-variable change creates a new Cloud Run revision; it is not a live in-process switch.

### Configuration examples

Default production:

```dotenv
APP_ENV=PROD
EMAIL_PROVIDER=AUTO
MICROSOFT_TENANT_ID=<tenant-id>
MICROSOFT_CLIENT_ID=<production-app-client-id>
MICROSOFT_SENDER_EMAIL=myHR@clouddesk.ae
EMAIL_FROM_NAME=Cloud Desk HR
```

Default SIT:

```dotenv
APP_ENV=SIT
EMAIL_PROVIDER=AUTO
EMAIL_FROM_NAME=Cloud Desk HR SIT
GMAIL_SERVICE=gmail
GMAIL_HOST=smtp.gmail.com
GMAIL_PORT=465
GMAIL_AUTH_USER=<approved-gmail-account>
GMAIL_AUTH_PASSWORD=<injected-from-secret-manager>
EMAIL_ALLOWED_RECIPIENTS=<approved-test-address-1>,<approved-test-address-2>
```

To test Microsoft in SIT, set `EMAIL_PROVIDER=MICROSOFT` and supply a separate SIT app's Microsoft configuration. To deliberately select Gmail in PROD, set `EMAIL_PROVIDER=GMAIL` and provision valid Gmail settings and its runtime secret first. Restore `AUTO` to return to environment defaults.

Gmail mode sends as its authorized Gmail identity. It does not automatically send as `myHR@clouddesk.ae`; setting a From header alone cannot establish that authorization.

## 4. Complete configuration inventory

| Variable/configuration | Required when | Storage and validation |
| --- | --- | --- |
| `APP_ENV` | Always | Non-secret environment value; enum validation |
| `EMAIL_PROVIDER` | Optional | Non-secret enum; absent means AUTO |
| `EMAIL_FROM_NAME` | Always | Non-secret display name; reject header control characters |
| `MICROSOFT_TENANT_ID` | Microsoft | Non-secret tenant GUID |
| `MICROSOFT_CLIENT_ID` | Microsoft | Non-secret client GUID |
| `MICROSOFT_SENDER_EMAIL` | Microsoft | Configured primary mailbox address; confirm endpoint identity during setup |
| `GMAIL_SERVICE` | Gmail, optional | Existing service preset; validate consistency with host/port |
| `GMAIL_HOST` | Gmail | Explicit SMTP host |
| `GMAIL_PORT` | Gmail | Integer; approved TLS configuration |
| `GMAIL_AUTH_USER` | Gmail | Authorized sender/account |
| `GMAIL_AUTH_PASSWORD` | Gmail | Runtime Secret Manager reference, never build substitution value |
| `EMAIL_ALLOWED_RECIPIENTS` | All non-PROD deployments | Exact test addresses, parsed as a list; reject sends outside list |
| Cloud Run service account | Microsoft | Deployment identity, not a JSON key file |

Non-PROD recipient restrictions apply to To, Cc, and Bcc after parsing and before queueing or sending. Reject the whole job on a disallowed recipient rather than silently removing recipients. Test with synthetic data; a tester allowlist does not authorize sending real employee documents to testers.

The Microsoft provider needs no `OUTLOOK_AUTH_PASSWORD`, `MICROSOFT_CLIENT_SECRET`, stored refresh token, or downloaded Google service-account key. Protocol constants such as the Graph endpoint and token-exchange audience belong in the implementation; customer identities and provider choices remain environment-driven.

## 5. Administrator preparation

Assign an owner for each area:

| Owner | Deliverable |
| --- | --- |
| Microsoft administrator | Mailbox verification, Entra application, scoped Exchange permission |
| Google Cloud administrator | Runtime identity, narrowly granted deploy/impersonation access, secret access |
| Backend engineer | Provider adapters, durable sending, tests and migration |
| HR/test owner | Approved test recipients and delivery validation |

Verify `myHR@clouddesk.ae` is an Exchange Online mailbox, not merely a distribution list or external contact. Record its primary SMTP address, UPN, mailbox type, and licensing/entitlement with the tenant administrator. If the configured address is only an alias and cannot identify `/users/{id}` reliably, use a separately configured immutable mailbox user ID for the endpoint and validate the intended sender address.

Keep existing MFA and security policies. Neither enabling SMTP AUTH nor generating app passwords is part of this Graph setup. Do not undo organization-wide SMTP settings without checking other workloads.

## 6. Microsoft application and permission setup

### 6.0 Which account to use and where the IDs come from

Yes: this design is applicable when `myHR@clouddesk.ae` is hosted in the organization's Microsoft 365 Exchange Online tenant. A custom domain does not require a separate authentication design. An email address alone does not prove hosting; the administrator must verify the mailbox in Exchange Online. This runbook is for a work/school organization, not a personal Outlook.com account.

Tenant ID and client ID are identifiers, not credentials. They cannot send mail by themselves. The full requirement is: correct tenant + registered application + trusted runtime identity + scoped sending permission + an eligible mailbox. Do not interpret the two environment variables as a password replacement without completing the other setup.

| Item | What it identifies | Where to obtain it | Used by |
| --- | --- | --- | --- |
| Directory (tenant) ID | Existing organization directory | Entra ID -> Overview -> Properties -> Tenant ID | `MICROSOFT_TENANT_ID` |
| Application (client) ID | New HR server app registration | App registrations -> selected app -> Overview | `MICROSOFT_CLIENT_ID` |
| Enterprise application Object ID | That app's service principal in the organization | Enterprise applications -> selected app -> Overview | Exchange PowerShell `-ObjectId`; not a runtime secret |
| App registration Object ID | Application definition | App registrations -> selected app -> Overview | Do not substitute this for the Enterprise application Object ID |
| HR mailbox address | Intended mail sender | Exchange admin mailbox details | `MICROSOFT_SENDER_EMAIL` |

The organization already has a tenant ID; registering this application creates a client ID. Neither is HR's password, HR's user Object ID, the domain name, nor a Microsoft subscription ID. [Find the tenant ID](https://learn.microsoft.com/en-us/entra/fundamentals/how-to-find-tenant)

#### A. Microsoft administrator: establish the correct directory

1. Sign in to [Microsoft Entra admin center](https://entra.microsoft.com) with the organization's authorized administrator account and complete that administrator's MFA.
2. Confirm the selected directory contains the `clouddesk.ae` organization and HR user. If multiple directories are available, switch to the correct directory before creating anything. Do not create an unrelated new tenant.
3. Open Entra ID -> Overview -> Properties and record Tenant ID. Microsoft documents Global Reader or higher access for this viewing procedure.
4. Open [Exchange admin center](https://admin.exchange.microsoft.com) with an authorized Exchange administrator. Under Recipients -> Mailboxes, locate HR and verify the mailbox identity and type described in section 5. HR need not be given an administrator role.

An account being called an 'admin account' is not sufficient evidence of every required permission. Use an app administrator or appropriately delegated app owner for application configuration, and an Exchange administrator with the required Exchange role assignments for section 6.2. If roles are eligible through privileged identity management, activate them for setup. Do not use the HR mailbox account to work around missing admin rights.

#### B. Application administrator: create the client ID

1. In the correct tenant, open Entra ID -> App registrations -> New registration.
2. Use the name `Zuno HR Email PROD`, choose the single-tenant option for this organization, and register. No interactive redirect URI is needed for this server workflow.
3. Record Application (client) ID from Overview. Record Directory (tenant) ID there too and compare it with the organization ID already collected.
4. Open Enterprise applications, locate the application by its client ID rather than only its display name, and record its Object ID for Exchange setup.
5. Assign accountable application owners through your organization's identity-management process. An unused default delegated permission such as User.Read is not required by this app-only sending design; inspect and remove unnecessary permissions through that process.

Microsoft's registration guide specifies Application Developer or higher for its procedure; local tenant restrictions must also be satisfied. Its generic tutorial prerequisites include an Azure subscription. Do not infer from that tutorial that this project must move to Azure or create a new tenant; confirm access/entitlements in the existing organization if the portal blocks registration. [Current registration instructions](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

#### C. Google Cloud administrator and application owner: configure authentication

The Google administrator identifies the actual Cloud Run runtime service account and supplies its numeric unique ID. The Entra application owner or administrator configures the federated credential in section 7. These are separate cloud permissions; the Director's Microsoft login does not automatically grant Google Cloud access.

Federation configuration requires authority to modify that app's credentials, for example app ownership or the applicable Entra application administration role. Do not create an app password, client secret or downloaded service-account key as a substitute for this step. The application receives short-lived tokens at runtime. [Microsoft Google federation instructions](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-google-cloud)

#### D. Exchange administrator: grant mailbox permission

Run section 6.2 using an administrative sign-in to `Connect-ExchangeOnline`, completing admin MFA. Microsoft specifies Exchange Administrator and the relevant Exchange Organization Management/delegated application role authority. The app itself must not receive an administrator role. Grant only the scoped Application Mail.Send assignment and verify it.

Do not follow a generic tutorial's tenant-wide Graph Mail.Send consent step in addition to this scoped design. Follow this document's RBAC authorization route; authentication and mailbox authorization are separate steps. [Current Exchange requirements](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)

#### E. HR mailbox user: validation only

- Keep normal MFA enabled. No app password, Security info change, app registration, or server credential sharing is required from HR.
- Confirm the intended sender name and approved test recipients with the administrator.
- Inspect approved test messages and Sent Items using normal Outlook access. For a shared mailbox, use delegated access rather than enabling direct login just for this integration.
- HR does not approve an MFA prompt for every server email and does not need to stay signed in. The administrator's laptop can be closed after setup.

#### F. Backend/deployment engineer: configure and verify

Set the tenant/client/sender environment variables from the verified values. Attach the intended Google runtime identity, deploy the implemented Graph provider and run the section 11 tests. Copying identifiers into the current Gmail-only implementation will not enable Graph. The document remains a plan until those code and cloud changes are completed.

The default remains `APP_ENV=PROD` plus `EMAIL_PROVIDER=AUTO` -> Microsoft; other recognized environments -> Gmail. An explicit `EMAIL_PROVIDER` override still requires that provider's complete configuration.

#### Documentation verification record

Official pages checked on 10 September 2026: app registration (page updated 5 June 2026), finding tenant ID (16 March 2026), Google workload federation (13 August 2026), and Exchange Application RBAC (21 August 2026). Links are attached to the relevant steps above. Portal labels can vary; use the named resource and account role if navigation differs. No access to the organization's tenant was performed, so available licenses, configured roles and mailbox status remain unverified.

### 6.1 Create the application

In the [Entra admin center](https://entra.microsoft.com), create a single-tenant application under App registrations. Suggested label: `Zuno HR Email PROD`. Leave redirect URI empty. Record tenant ID and client ID. Also locate its Enterprise application and record that service principal's Object ID; it is different from the app registration's Object ID.

Do not create a client secret. Do not grant broad Graph application permissions as a shortcut. This design obtains mailbox authorization from Exchange Application RBAC.

### 6.2 Scope sending authorization

Microsoft documents Application RBAC as the replacement for Application Access Policies. Exchange and Entra grants are additive; a broad Entra mail grant defeats a narrow Exchange scope. The authorization test below checks RBAC only. Permission changes can take 30 minutes to 2 hours to reach API caches. [Microsoft RBAC reference](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)

The following is a one-time command template, not an idempotent script. Replace placeholders, inspect existing objects first, and have an appropriately privileged Exchange administrator run it. Do not rerun creation commands blindly.

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline

$mailAppId = '<application-client-id>'
$mailServicePrincipalId = '<enterprise-application-object-id>'
$mailScopeName = 'Zuno-HR-Mail-PROD'

Get-EXOMailbox -Identity 'myHR@clouddesk.ae' |
  Format-List PrimarySmtpAddress,UserPrincipalName,RecipientTypeDetails

New-ServicePrincipal -AppId $mailAppId -ObjectId $mailServicePrincipalId -DisplayName 'Zuno HR Email PROD'
New-ManagementScope -Name $mailScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'myHR@clouddesk.ae'"
New-ManagementRoleAssignment -Name 'Zuno-HR-Send-PROD' -Role 'Application Mail.Send' -App $mailServicePrincipalId -CustomResourceScope $mailScopeName

Test-ServicePrincipalAuthorization -Identity $mailServicePrincipalId -Resource 'myHR@clouddesk.ae'
Test-ServicePrincipalAuthorization -Identity $mailServicePrincipalId -Resource '<other-existing-test-mailbox>'

Disconnect-ExchangeOnline -Confirm:$false
```

Expected: Mail.Send in scope for HR, out of scope for the other mailbox. Independently audit Enterprise application permissions, then perform controlled API positive and negative tests. Use an approved test recipient for both; an incorrectly permitted negative test could otherwise send a real message. Verify the scope resolves to exactly the intended mailbox before proceeding.

## 7. Google-to-Microsoft trust

Use a dedicated runtime service account per environment. Reusing an existing dedicated account is acceptable after IAM review; switching identities must preserve required storage/database integration access. Build/deploy identity and runtime identity are distinct.

Record the runtime account's numeric unique ID. In the Entra app: Certificates & secrets -> Federated credentials -> Add credential -> Other issuer. Set issuer to `https://accounts.google.com`, subject to that numeric ID, and audience to `api://AzureADTokenExchange`. Do not use the service-account email as the subject. [Microsoft federation guide](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-google-cloud)

At runtime, request a Google ID token for that audience through the Cloud Run metadata service, then use `ClientAssertionCredential` from `@azure/identity` to request a Microsoft access token for `https://graph.microsoft.com/.default`. Cache credentials/tokens through the SDK and bound network timeouts. Never log either token. Validate compatible SDK versions against the deployed Node version during implementation.

Cloud Run supports retrieving identity tokens from metadata. Do not use a Google OAuth access token in place of the required ID token. No service-account key download is required. [Cloud Run identity token guidance](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)

Network prerequisites: metadata endpoint access and outbound HTTPS to Microsoft identity and Graph endpoints. Test under actual VPC/egress policy. Local laptops lack Cloud Run metadata; use Gmail locally and a controlled Cloud Run SIT revision for federation testing.

Separate SIT federation must not trust the production runtime account or reuse the production app. If testing must use the same HR mailbox, explicitly scope the SIT app and retain the recipient allowlist; a separate test mailbox gives stronger isolation.

## 8. Backend implementation plan

### 8.1 Public interface and adapters

Preserve business callers through a central service, with provider-neutral message data: recipient arrays, subject, HTML/text content, validated attachments and business correlation ID. Keep HTTP reply handling outside provider adapters. Both adapters return a normalized submission result rather than exposing Nodemailer or Graph objects.

Suggested modules, to be fitted to repository conventions during implementation:

| Module | Responsibility |
| --- | --- |
| `src/config/index.ts` | Environment parsing, resolver, selected-provider validation |
| `src/services/email.service.ts` | Existing public facade; common validation and dispatch |
| `src/services/email/gmail.provider.ts` | Existing Gmail delivery, authorized sender and TLS |
| `src/services/email/microsoft.provider.ts` | Graph message mapping and submission |
| `src/services/email/microsoft.credential.ts` | Federated credential callback and token acquisition |
| Existing/new durable job module | Job persistence, claims, retries, status and recovery |

Trace every import and email-producing route before changing behavior. Replace the direct transporter access in the document service. Determine whether the duplicate email service is live before removing it. Remove sensitive payslip/PDF buffer logging in the delivery paths.

### 8.2 Graph message submission

Use `POST /v1.0/users/{configured-mailbox-identifier}/sendMail`. Map recipient arrays and body explicitly. Save to Sent Items for operational investigation. Do not accept caller-selected From addresses. One employee payslip must be one message to that employee; never combine payroll recipients.

Graph returns `202 Accepted` without a response body. Record `accepted`, not `delivered`; do not invent a message ID. Store Graph request correlation headers when available. Exchange processing and recipient delivery happen later. [sendMail API contract](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

### 8.3 Attachments and sensitive documents

Inventory real attachment sizes before finalizing the adapter. Graph's simple attachment approach is for files smaller than 3 MB; large attachments use upload sessions with a draft workflow and additional permissions such as Mail.ReadWrite. Do not assume the current 25 MB download ceiling is a supported Graph message size. [Microsoft attachment guidance](https://learn.microsoft.com/en-us/graph/outlook-large-attachments)

Proposed initial production policy: send-only permissions, each attachment below 3,000,000 bytes, and a conservative serialized JSON request ceiling of 3,500,000 bytes including base64 expansion and body. These are application limits to validate, not a claim about a universal Microsoft limit. Measure the serialized UTF-8 payload, not just raw file size. Acceptance requires all actual business documents to fit or an explicitly implemented alternative.

For oversized documents, prefer an authenticated application download link with authorization checks. Do not substitute a public payslip URL silently. If attaching larger files is mandatory, design and review the scoped draft/upload permission expansion before release.

Fetch attachments only from trusted private storage/object references. Enforce ownership, byte limits, timeout, and content type. Reject arbitrary URLs, localhost/metadata destinations and unsafe redirects; otherwise document fetching can become SSRF. Restrict local paths to approved attachment locations and prevent traversal. Durable jobs must not rely on temporary files surviving Cloud Run restarts.

## 9. Reliable sending and API behavior

Add a durable outbox backed by the existing database, with unique business-event keys and atomic job claims. Use a durable dispatcher/worker; do not depend on unawaited background promises after an HTTP response. Select an existing queue if suitable; otherwise design authenticated Cloud Tasks dispatch with a periodic recovery scan. A task endpoint must verify authentication even if the current public API service allows unauthenticated network access.

Proposed states: `pending`, `processing`, `accepted`, `retry_scheduled`, `failed`, `unknown`. Record provider, sender, attempt count, next attempt, lease expiry, correlation ID, timestamps and redacted error category. Store sensitive payloads only with access control and bounded retention; reference durable private attachments.

Persist provider/sender selection at enqueue time. Retry with that same provider. Changing deployment configuration affects new jobs; operators must explicitly handle old pending jobs. A lost processing lease after an external send may mean submission happened: move it to `unknown` rather than blindly resending.

| Outcome | Planned handling |
| --- | --- |
| 202 from Graph / SMTP acceptance | Mark accepted |
| Invalid recipient/payload, oversized attachment | Fail before submission |
| 401 | Reacquire credentials once; persistent failure alerts and stops retries |
| 403 | Permission/configuration investigation; no automatic provider fallback |
| 429 | Honor Retry-After; bounded rescheduling |
| Explicit transient rejection | Limited exponential backoff with jitter |
| Connection loss after possible submission or ambiguous server error | Mark unknown; investigate before replay |

Microsoft recommends honoring Retry-After for throttling. Coordinate SDK and job retries so nested retry loops do not duplicate sendMail POSTs. [Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)

Exactly-once email delivery cannot be promised. Database uniqueness prevents duplicate business jobs but cannot atomically commit with Microsoft accepting a message. Operators need an ambiguity procedure using correlation data and message trace; a client request ID is diagnostic, not a Graph idempotency guarantee.

Password reset APIs must retain non-enumerating responses. Review reset-token lifetime relative to queue delay; suppress expired jobs and avoid storing plaintext reset tokens in logs. Bulk payslip APIs need per-recipient status instead of claiming the entire batch succeeded on partial acceptance. Do not silently alter response semantics without updating callers and tests.

Start with conservative mailbox-wide concurrency and measure actual throughput. Multiple Cloud Run instances must share the throttle budget. Confirm normal and peak HR volumes against Exchange sending limits; Graph is not an unlimited bulk-mail system.

## 10. Deployment and the operator toggle

Both Cloud Build files must forward `_APP_ENV`, `_EMAIL_PROVIDER`, `_EMAIL_FROM_NAME` and the selected provider's non-secret configuration to runtime environment variables. Set PROD trigger `_APP_ENV=PROD`, SIT trigger `_APP_ENV=SIT`, and both `_EMAIL_PROVIDER=AUTO`. Tenant, client and mailbox values are supplied by deployment configuration.

Important existing gap: `_NAME: '${NAME}'` is not proof that Cloud Build reads arbitrary shell environment values. Verify any wrapper/preprocessing actually used. Standard Cloud Build uses defined substitutions such as `_NAME`; populate them through trigger configuration or explicit build invocation. Do not add more unresolved placeholder chains. [Cloud Build substitutions](https://docs.cloud.google.com/build/docs/configuring-builds/substitute-variable-values)

Inject Gmail credentials with a Cloud Run Secret Manager reference, for example `GMAIL_AUTH_PASSWORD=<secret-name>:<version>` in `--update-secrets`, after granting the runtime account access to that specific secret. Avoid putting credentials in `--set-env-vars`, build substitutions, or build logs. Pin a secret version for deterministic deployment. [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

Use structured runtime environment files or correctly escaped arguments for lists/display names. The comma-separated recipient list must not break gcloud's comma-separated flag parser. Treat this as a deployment test case.

### Normal toggle procedure

1. Open the appropriate Cloud Build trigger and change `_EMAIL_PROVIDER` to `MICROSOFT`, `GMAIL`, or `AUTO`.
2. Confirm that provider's non-secret configuration, runtime permissions and secrets exist.
3. Deploy a new revision, run a controlled smoke test, and check the effective provider in redacted startup logs.
4. Route intended traffic to that revision and confirm worker configuration agrees.

For an urgent manual change: Cloud Run -> service -> Edit & deploy new revision -> Variables & secrets -> `EMAIL_PROVIDER` -> deploy. Then update the build trigger/source of truth immediately so the next deployment does not undo the choice. Console labels can change; the operation is a runtime revision configuration update.

Do not change `APP_ENV` to switch mail providers: that also changes environment-specific policy. Use only `EMAIL_PROVIDER` for the toggle.

## 11. Verification and release gates

### Automated tests

- Full provider matrix, normalization, blank AUTO default, unknown values and missing APP_ENV.
- PROD missing Microsoft config fails; SIT Gmail does not require Microsoft config.
- Explicit overrides work and no failure triggers cross-provider fallback.
- To/Cc/Bcc allowlist enforcement and fixed sender behavior.
- HTML/text mapping, attachment ownership/limits, SSRF/path traversal rejection.
- Token refresh, metadata failure, 202 with empty response, 401/403/429 and ambiguous timeout handling.
- Concurrent claims, business-key deduplication, worker crash and persisted provider behavior.
- All email callers use the same facade; no direct transporter bypass remains.
- Existing Gmail flows and password-reset privacy/expiry behavior remain correct.

Run TypeScript build and focused Jest tests. Add broader tests where caller contracts change. Mock external submission in automated tests; do not send real employee email from CI.

### Tenant/deployment acceptance

- Verify runtime service account and federation on an actual Cloud Run test revision.
- Validate API send success for HR and denial for a different existing test mailbox; audit broad grants separately.
- Test Gmail, Outlook and internal recipients with approved synthetic messages and PDFs.
- Check From, Reply-To behavior, Sent Items, attachments and message trace.
- Verify domain SPF, DKIM and DMARC with Microsoft admin; preserve other legitimate senders in DNS changes.
- Verify active-provider logs without passwords, tokens, reset links, document bytes or unnecessary personal data.
- Test switching to Gmail and back to AUTO; ensure sender change is understood.
- Test restart recovery, queued job behavior and provider failure alerts.
- Establish supported attachment and volume limits with real workflow measurements.

Do not declare production ready from token acquisition alone. No tenant or delivery tests were performed for this planning document.

## 12. Rollout, rollback and cleanup

Stage 1: identify deployed commit, revoke the discovered hardcoded Gmail credential, inventory caller/attachment behavior and resolve configuration ownership.

Stage 2: implement resolver, common interface, Gmail regression coverage, Graph authentication/adapter and durable job handling. Preserve Gmail default in SIT.

Stage 3: administrator configures test identity; exercise Microsoft override in SIT with synthetic data. Complete positive/negative permission checks and retry/attachment tests.

Stage 4: configure production identity and release a revision without normal traffic. Use an approved smoke test, then move traffic and workers together. Watch accepted/failed/unknown counts, queue age, auth failures and throttling.

Rollback: select a known compatible revision or explicitly choose Gmail with valid credentials. Gmail rollback changes sender identity. Do not replay accepted or unknown jobs automatically. Pause dispatch before changing queued job providers; reconcile uncertain submissions, then audit any operator-approved reroute.

Cleanup after acceptance: revoke unused Outlook app passwords, remove obsolete runtime secret bindings and disable HR SMTP AUTH only after checking other consumers. Keep Gmail available where required by this plan. Record owners, incident procedure and the chosen provider in deployment records.

## 13. Items to record before implementation is considered complete

| Item | Record/decision |
| --- | --- |
| Deployed source revision vs local checkout | Pending |
| Production tenant/client/service-principal IDs | Pending admin setup |
| HR mailbox primary address, type and endpoint identity | Pending verification |
| PROD and SIT runtime accounts and IAM review | Pending |
| Actual deployment substitution mechanism | Pending inspection of trigger/wrapper |
| Gmail credential revocation and replacement | Pending credential owner |
| Peak volume and largest attachments | Pending measurement |
| Durable worker mechanism and endpoint authentication | Pending implementation design against existing infrastructure |
| Test recipients, operational owner and alert destination | Pending |
| Permission, delivery and rollback evidence | Pending testing |

These are explicit implementation prerequisites, not evidence that the architecture is unsupported. Public documentation supports the building blocks; the organization-specific configuration and end-to-end behavior must still be demonstrated.
