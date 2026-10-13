package interpreter

import "strings"

// Intent represents a parsed user intent with a domain and action.
type Intent struct {
	Domain string // e.g. "contact", "workspace", "unknown"
	Action string // e.g. "create", "update", "get", "unknown"
	Raw    string // original unmodified input
}

// IntentParser extracts domain intent from raw user input.
// Side-Effect Free: no IO, no database, no network calls.
type IntentParser struct{}

// NewIntentParser returns a ready-to-use IntentParser.
func NewIntentParser() *IntentParser { return &IntentParser{} }

// Parse performs keyword-based intent extraction from the input string.
// Returns Domain and Action set to "unknown" when no clear match is found.
func (p *IntentParser) Parse(input string) Intent {
	lower := strings.ToLower(input)
	intent := Intent{Domain: "unknown", Action: "unknown", Raw: input}

	// Domain detection
	switch {
	case containsAny(lower, "contact", "lead", "prospect"):
		intent.Domain = "contact"
	case containsAny(lower, "workspace"):
		intent.Domain = "workspace"
	}

	// Action detection
	switch {
	case containsAny(lower, "create", "add", "new", "register", "cadastrar", "adicionar"):
		intent.Action = "create"
	case containsAny(lower, "update", "edit", "change", "modify", "atualizar", "editar"):
		intent.Action = "update"
	case containsAny(lower, "get", "show", "fetch", "list", "find", "buscar", "listar"):
		intent.Action = "get"
	case containsAny(lower, "delete", "remove", "deletar", "remover"):
		intent.Action = "delete"
	}

	return intent
}

func containsAny(s string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}
