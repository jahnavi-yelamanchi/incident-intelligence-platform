variable "name" {
  type    = string
  default = "aegis"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "region" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "azs" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "kubernetes_version" {
  type    = string
  default = "1.31"
}

variable "database_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "redis_node_type" {
  type    = string
  default = "cache.r6g.large"
}

variable "tags" {
  type    = map(string)
  default = {}
}
