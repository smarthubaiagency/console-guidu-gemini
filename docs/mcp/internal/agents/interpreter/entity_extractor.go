package interpreter

import (
	"regexp"
	"strings"
)

// Entities holds extracted parameters from raw user input.
type Entities struct {
	Fields    map[string]string // extracted key-value pairs (e.g. name, email)
	IDs       []string          // extracted UUID-like strings
	Slugs     []string          // extracted slug-like strings
	Ambiguous []string          // terms that could not be unambiguously resolved
}

// EntityExtractor extracts structured parameters from raw text.
// Side-Effect Free: no IO, no database, no network calls.
type EntityExtractor struct{}

// NewEntityExtractor returns a ready-to-use EntityExtractor.
func NewEntityExtractor() *EntityExtractor { return &EntityExtractor{} }

var (
	uuidRe  = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	emailRe = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
)

// Extract performs regex and keyword-based entity extraction from the input string.
func (e *EntityExtractor) Extract(input string) Entities {
	entities := Entities{
		Fields: make(map[string]string),
	}

	// UUID extraction
	entities.IDs = uuidRe.FindAllString(input, -1)

	// Email extraction
	lower := strings.ToLower(input)
	if emails := emailRe.FindAllString(lower, -1); len(emails) > 0 {
		entities.Fields["email"] = emails[0]
	}

	return entities
}
