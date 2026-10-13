package policy

// PolicyDecision represents the verdict of a policy evaluation.
// States: ALLOW (Allowed=true), DENY (Allowed=false, permanent),
// RESTRICTED (Allowed=false, retryable with elevated credentials).
type PolicyDecision struct {
	Allowed  bool
	Reason   string
	Policy   string         // Name of the policy/rule applied
	Metadata map[string]any // Optional context forwarded to the audit log
}

// Allow returns a positive decision.
func Allow(policy, reason string) PolicyDecision {
	return PolicyDecision{
		Allowed: true,
		Policy:  policy,
		Reason:  reason,
	}
}

// Deny returns a permanent negative decision.
func Deny(policy, reason string) PolicyDecision {
	return PolicyDecision{
		Allowed: false,
		Policy:  policy,
		Reason:  reason,
	}
}

// Restrict returns a soft-deny that the caller may retry with elevated credentials.
// Metadata can carry hints such as required_role or missing_scope.
func Restrict(policy, reason string, metadata map[string]any) PolicyDecision {
	return PolicyDecision{
		Allowed:  false,
		Policy:   policy,
		Reason:   reason,
		Metadata: metadata,
	}
}
