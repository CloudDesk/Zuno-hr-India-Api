# Form 12BB bulk worker

Form 12BB bulk generation is durable. A parent job is stored in `form12bbjobs`, every employee is stored in `form12bbjobitems`, and Cloud Tasks drives small worker requests until every item is terminal.

The worker processes three employees per request by default. Each item has an atomic lease, three attempts with exponential backoff, and an idempotency key recorded on the generated document. A Cloud Run restart therefore resumes the batch instead of losing it or generating an extra report version.

## One-time Google Cloud setup

Run these commands in project `zuno-hr-2025` before deploying the changed Cloud Build files:

```sh
gcloud services enable cloudtasks.googleapis.com

gcloud tasks queues create form12bb-generation \
  --location=asia-south1 \
  --max-concurrent-dispatches=2 \
  --max-dispatches-per-second=2 \
  --max-attempts=20 \
  --min-backoff=5s \
  --max-backoff=300s \
  --max-doublings=5

gcloud projects add-iam-policy-binding zuno-hr-2025 \
  --member=serviceAccount:zunoprod@zuno-hr-2025.iam.gserviceaccount.com \
  --role=roles/cloudtasks.enqueuer
```

Configure a strong `FORM12BB_WORKER_SECRET` value in the SIT and production
deployment environments. The Cloud Build files pass it to Cloud Run in the same
way as the other deployment environment variables; do not commit the value.

If the queue already exists, use `gcloud tasks queues update form12bb-generation` with the same rate and retry flags.

`API_URL` must be the externally reachable API base URL. The task target is derived as:

```text
${API_URL}/documents/form12bb/jobs/process
```

Set `FORM12BB_WORKER_URL` only when that derived URL is not correct.

## Runtime configuration

The production and SIT Cloud Build files set:

```text
FORM12BB_QUEUE_MODE=cloud-tasks
FORM12BB_TASKS_PROJECT=zuno-hr-2025
FORM12BB_TASKS_LOCATION=asia-south1
FORM12BB_TASKS_QUEUE=form12bb-generation
FORM12BB_JOB_CHUNK_SIZE=3
FORM12BB_JOB_MAX_ATTEMPTS=3
FORM12BB_JOB_LEASE_MINUTES=20
```

They pass `FORM12BB_WORKER_SECRET` from the deployment environment and configure a 15-minute Cloud Run request timeout. SIT memory is raised to 1 GiB for Chromium.

For local development, the default queue mode is `inline`; it still uses persisted job items, leases, retries, and idempotency. Do not use inline mode in production. Production defaults to Cloud Tasks and rejects new bulk jobs if required configuration is missing.

## Operations

- The existing job-status endpoint remains the source of UI progress.
- Failure summaries are capped at 100 entries on the parent job; all employee results remain in `form12bbjobitems`.
- A safe recovery endpoint is available at `POST /documents/form12bb/jobs/:jobId/resume` for the admin who created an active job.
- Missing declarations and invalid source data are terminal employee failures. Browser, storage, database, and network errors are retried.
- The queue concurrency is the main capacity control. Increase it gradually only after observing Cloud Run memory, MongoDB load, Puppeteer duration, and storage errors.

## Acceptance test

Before production rollout:

1. Run batches of 10 and 100 in SIT and verify final counters.
2. Start a 100-employee batch, deploy a new Cloud Run revision mid-job, and verify it resumes.
3. Temporarily cause an upload failure and verify the employee is retried without an extra report version.
4. Run a 1,000-employee batch and verify `processed = succeeded + failed = total`.
5. Confirm a second job containing an employee already in an active batch is rejected.
