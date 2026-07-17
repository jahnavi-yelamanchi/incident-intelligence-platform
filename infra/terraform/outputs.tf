output "cluster_name" { value = module.eks.cluster_name }
output "cluster_oidc_provider_arn" { value = module.eks.oidc_provider_arn }
output "database_endpoint" { value = aws_rds_cluster.platform.endpoint }
output "redis_endpoint" { value = aws_elasticache_replication_group.platform.primary_endpoint_address }
output "evidence_bucket" { value = aws_s3_bucket.evidence.id }
output "runtime_secret_arn" { value = aws_secretsmanager_secret.runtime.arn }
