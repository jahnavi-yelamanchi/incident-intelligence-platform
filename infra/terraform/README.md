# Production AWS foundation

Provision with a dedicated Terraform state backend and a least-privilege deployment role:

```bash
terraform init
terraform plan -var region=us-east-1
terraform apply -var region=us-east-1
```

The stack creates multi-AZ networking, a private EKS cluster, encrypted Aurora PostgreSQL, multi-AZ Redis, encrypted S3 evidence storage, an SQS queue/dead-letter queue, KMS, and Secrets Manager. Do not place secret values in Terraform variables or state. Populate the generated Secrets Manager secret through the deployment pipeline, then synchronize it into the `aegis-runtime` Kubernetes Secret using External Secrets.
