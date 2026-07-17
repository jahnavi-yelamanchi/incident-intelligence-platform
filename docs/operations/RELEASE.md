# Production release procedure

1. Apply Terraform from `infra/terraform` using a reviewed plan and a remote encrypted state backend.
2. Build and sign the three images from the pinned commit, publish their digests, and set those digests in Helm values. Do not deploy mutable `latest` tags.
3. Put runtime credentials in AWS Secrets Manager; sync them into the `aegis-runtime` Kubernetes Secret through the approved external-secrets controller.
4. Run Prisma migrations exactly once with `MIGRATION_DATABASE_URL`; verify that runtime deployments use only the restricted `DATABASE_URL` role.
5. Deploy Helm, confirm API readiness, worker queue depth, OPA health, Temporal connectivity, and websocket reconnects.
6. Exercise a non-production remediation request end-to-end: preflight, independent approval, execution, verification, and immutable audit record.
7. Verify restore procedures against a recent RDS backup and inspect SQS dead-letter queues before declaring the release healthy.

## Required release gates

- GitHub Actions verification is green for the release commit.
- Terraform and Helm render cleanly.
- No runtime secrets, private keys, or token payloads appear in the diff, logs, or image layers.
- OPA denies an unauthorized remediation request and permits an authorized request only with an independent approver.
- Alert ingestion, GitHub deployment events, Slack signed events, Auth0 tenant claims, and approved Kubernetes/AWS paths are exercised in the target environment.
