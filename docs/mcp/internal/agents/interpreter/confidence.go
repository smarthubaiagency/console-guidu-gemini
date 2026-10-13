package interpreter

// GatingVerdict is the outcome of the confidence evaluation.
type GatingVerdict int

const (
	// VerdictPropose — confidence is high enough for autonomous execution.
	VerdictPropose GatingVerdict = iota
	// VerdictReview — confidence is marginal; human approval is required before execution.
	VerdictReview
	// VerdictClarify — confidence is too low; the agent must request more information.
	VerdictClarify
)

// ConfidenceGating applies the Linkko Constitution §4 thresholds to a confidence score.
// Thresholds match the mcp-go legacy interpreter exactly:
//   - score >= 0.8  → VerdictPropose  (RequiresHumanApproval = false)
//   - score >= 0.5  → VerdictReview   (RequiresHumanApproval = true)
//   - score <  0.5  → VerdictClarify  (execution blocked, agent must clarify)
type ConfidenceGating struct {
	ThresholdClear float64 // default 0.8
	ThresholdAmbig float64 // default 0.5
}

// NewConfidenceGating returns a ConfidenceGating with the canonical thresholds.
func NewConfidenceGating() *ConfidenceGating {
	return &ConfidenceGating{
		ThresholdClear: 0.8,
		ThresholdAmbig: 0.5,
	}
}

// Evaluate returns the GatingVerdict for the given confidence score.
func (g *ConfidenceGating) Evaluate(confidence float64) GatingVerdict {
	if confidence >= g.ThresholdClear {
		return VerdictPropose
	}
	if confidence >= g.ThresholdAmbig {
		return VerdictReview
	}
	return VerdictClarify
}

// RequiresHumanApproval returns true when the verdict is VerdictReview,
// meaning the agent's confidence is too low for autonomous execution.
func (g *ConfidenceGating) RequiresHumanApproval(confidence float64) bool {
	return g.Evaluate(confidence) == VerdictReview
}
