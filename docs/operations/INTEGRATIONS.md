# Integration operations

## Signed operational events

Create an administrator-managed `generic_webhook` integration connection with a unique `webhookSecret`. Send events to:

`POST /v1/ingest/events/{connectionId}`

Requests require `x-webhook-timestamp` (Unix seconds) and `x-webhook-signature` (`sha256=<HMAC-SHA256(timestamp.body)>`). The service rejects signatures outside its replay window. Supported sources are `generic_webhook`, `opentelemetry`, and `kubernetes`.

## Prometheus Alertmanager

Use the same encrypted `generic_webhook` connection for Alertmanager. Its connection ID is the public URL identifier; its `webhookSecret` stays encrypted at rest. Configure Alertmanager to send to:

`POST /v1/ingest/prometheus/{connectionId}`

It uses the same timestamped HMAC headers as signed operational events. Each valid Alertmanager alert is normalized and enters the regular deduplication and correlation pipeline.

## GitHub App

Set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` from the installed GitHub App. Store a GitHub integration connection containing `installationId`, `repository`, and its webhook secret. Configure GitHub deployment-status webhooks at:

`POST /v1/integrations/github/{connectionId}/webhook`

An administrator can request repository runbook/document indexing at:

`POST /v1/integrations/github/{connectionId}/sync`

## Slack

Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_SIGNING_SECRET`, `INTEGRATION_OAUTH_STATE_SECRET`, and `INTEGRATION_ENCRYPTION_KEY`. An administrator starts OAuth at `/v1/integrations/slack/authorize`. Configure Slack Events to call:

`POST /v1/integrations/slack/{connectionId}/events`

All integration credentials are encrypted at rest and never returned by the management API.
