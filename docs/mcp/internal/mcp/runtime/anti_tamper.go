package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
)

// ErrTamperDetected is returned when the provided proposal_hash does not match
// the server-side recalculation. The caller should respond with HTTP 409 Conflict.
var ErrTamperDetected = errors.New("proposal integrity check failed: hash mismatch (tamper detected)")

// CalculateProposalHash computes a canonical SHA-256 hash over the proposal fields
// that are security-critical: workspace_id, intent, requires_human_approval, commands.
//
// Canonical JSON rules (must be identical in Go and Next.js):
//   - Object keys sorted alphabetically at every level of nesting.
//   - No whitespace between tokens.
//   - String values UTF-8 encoded with JSON escaping.
//
// This guarantees that the hash produced by the Next.js client and the Go server
// will be identical when the payload has not been tampered with.
func CalculateProposalHash(workspaceID, intent string, requiresHumanApproval bool, commands any) (string, error) {
	payload := map[string]any{
		"commands":                commands,
		"intent":                  intent,
		"requires_human_approval": requiresHumanApproval,
		"workspace_id":            workspaceID,
	}

	b, err := canonicalJSON(payload)
	if err != nil {
		return "", err
	}

	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// ValidateProposalHash recalculates the hash and compares it to the provided value.
// Returns ErrTamperDetected if the hashes differ.
func ValidateProposalHash(workspaceID, intent string, requiresHumanApproval bool, commands any, providedHash string) error {
	computed, err := CalculateProposalHash(workspaceID, intent, requiresHumanApproval, commands)
	if err != nil {
		return err
	}
	if computed != providedHash {
		return ErrTamperDetected
	}
	return nil
}

// canonicalJSON serialises v to JSON with all object keys sorted alphabetically
// at every nesting level. This is required for cross-language hash consistency.
func canonicalJSON(v any) ([]byte, error) {
	// Marshal to intermediate JSON, then re-marshal via the sorted map path.
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	// Unmarshal into a generic structure so we can sort recursively.
	var generic any
	if err := json.Unmarshal(b, &generic); err != nil {
		return nil, err
	}
	return marshalSorted(generic)
}

// marshalSorted recursively sorts map keys and serialises to JSON bytes.
func marshalSorted(v any) ([]byte, error) {
	switch val := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		buf := []byte{'{'}
		for i, k := range keys {
			keyBytes, err := json.Marshal(k)
			if err != nil {
				return nil, err
			}
			valBytes, err := marshalSorted(val[k])
			if err != nil {
				return nil, err
			}
			buf = append(buf, keyBytes...)
			buf = append(buf, ':')
			buf = append(buf, valBytes...)
			if i < len(keys)-1 {
				buf = append(buf, ',')
			}
		}
		buf = append(buf, '}')
		return buf, nil

	case []any:
		buf := []byte{'['}
		for i, item := range val {
			itemBytes, err := marshalSorted(item)
			if err != nil {
				return nil, err
			}
			buf = append(buf, itemBytes...)
			if i < len(val)-1 {
				buf = append(buf, ',')
			}
		}
		buf = append(buf, ']')
		return buf, nil

	default:
		return json.Marshal(val)
	}
}
