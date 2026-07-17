provider "aws" {
  region = var.region
}

locals {
  name = "${var.name}-${var.environment}"
  tags = merge({ Application = var.name, Environment = var.environment, ManagedBy = "terraform" }, var.tags)
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "platform" {
  description             = "${local.name} application data encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = local.tags
}
resource "aws_kms_alias" "platform" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.platform.key_id
}

module "vpc" {
  source               = "terraform-aws-modules/vpc/aws"
  version              = "~> 5.0"
  name                 = local.name
  cidr                 = var.vpc_cidr
  azs                  = var.azs
  private_subnets      = [for index, _ in var.azs : cidrsubnet(var.vpc_cidr, 4, index)]
  public_subnets       = [for index, _ in var.azs : cidrsubnet(var.vpc_cidr, 4, index + 8)]
  database_subnets     = [for index, _ in var.azs : cidrsubnet(var.vpc_cidr, 4, index + 12)]
  enable_nat_gateway   = true
  single_nat_gateway   = false
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = local.tags
}

module "eks" {
  source                         = "terraform-aws-modules/eks/aws"
  version                        = "~> 20.0"
  cluster_name                   = local.name
  cluster_version                = var.kubernetes_version
  cluster_endpoint_public_access = false
  enable_irsa                    = true
  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnets
  eks_managed_node_groups = {
    primary = { min_size = 3, max_size = 12, desired_size = 3, instance_types = ["m7g.large"], capacity_type = "ON_DEMAND" }
  }
  tags = local.tags
}

resource "aws_security_group" "data" {
  name_prefix = "${local.name}-data-"
  description = "Data services accessible only from Aegis private VPC"
  vpc_id      = module.vpc.vpc_id
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_db_subnet_group" "platform" {
  name       = local.name
  subnet_ids = module.vpc.database_subnets
  tags       = local.tags
}
resource "aws_rds_cluster" "platform" {
  cluster_identifier              = local.name
  engine                          = "aurora-postgresql"
  engine_mode                     = "provisioned"
  database_name                   = "incident"
  master_username                 = "incident"
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = aws_kms_key.platform.arn
  db_subnet_group_name            = aws_db_subnet_group.platform.name
  vpc_security_group_ids          = [aws_security_group.data.id]
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.platform.arn
  backup_retention_period         = 35
  preferred_backup_window         = "03:00-03:30"
  copy_tags_to_snapshot           = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-final"
  enabled_cloudwatch_logs_exports = ["postgresql"]
  tags                            = local.tags
}
resource "aws_rds_cluster_instance" "platform" {
  count                        = 2
  identifier                   = "${local.name}-${count.index}"
  cluster_identifier           = aws_rds_cluster.platform.id
  instance_class               = var.database_instance_class
  engine                       = aws_rds_cluster.platform.engine
  publicly_accessible          = false
  performance_insights_enabled = true
  tags                         = local.tags
}

resource "aws_elasticache_subnet_group" "platform" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}
resource "aws_elasticache_replication_group" "platform" {
  replication_group_id       = local.name
  description                = "${local.name} Redis"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token_update_strategy = "ROTATE"
  auth_token                 = random_password.redis.result
  subnet_group_name          = aws_elasticache_subnet_group.platform.name
  security_group_ids         = [aws_security_group.data.id]
  tags                       = local.tags
}
resource "random_password" "redis" {
  length  = 40
  special = false
}

resource "aws_s3_bucket" "evidence" {
  bucket_prefix = "${local.name}-evidence-"
  force_destroy = false
  tags          = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.platform.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_sqs_queue" "dead_letter" {
  name                      = "${local.name}-dead-letter"
  kms_master_key_id         = aws_kms_key.platform.id
  message_retention_seconds = 1209600
  tags                      = local.tags
}

resource "aws_sqs_queue" "events" {
  name              = "${local.name}-events"
  kms_master_key_id = aws_kms_key.platform.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 5
  })
  tags = local.tags
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/runtime"
  kms_key_id              = aws_kms_key.platform.arn
  recovery_window_in_days = 30
  tags                    = local.tags
}
