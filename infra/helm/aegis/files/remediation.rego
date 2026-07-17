package aegis.remediation

default decision := {"allow": false, "requiredApprovals": 1, "dryRunRequired": true, "reason": "Request is not permitted by remediation policy."}

authorized { input.roles[_] == "responder" }
authorized { input.roles[_] == "incident-commander" }

decision := {"allow": true, "requiredApprovals": 1, "dryRunRequired": true, "reason": "Availability-affecting change requires an independent approver and a preflight check."} {
  authorized
  startswith(input.actionType, "kubernetes.")
}

decision := {"allow": true, "requiredApprovals": 1, "dryRunRequired": true, "reason": "Database failover requires an independent approver and a preflight check."} {
  authorized
  input.actionType == "aws.rds.failover"
}
