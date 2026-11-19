package diagnostics

import "regexp"

var secretField = regexp.MustCompile(`(?i)password|cookie|authorization|^key$|token|key_hash|^fingerprint$`)

func SecretField(name string) bool { return secretField.MatchString(name) }

func redact(v any) any {
	switch x := v.(type) {
	case map[string]any:
		clean := make(map[string]any, len(x))
		for k, field := range x {
			if SecretField(k) {
				clean[k] = "[redacted]"
			} else {
				clean[k] = redact(field)
			}
		}
		return clean
	case []any:
		clean := make([]any, len(x))
		for i, field := range x {
			clean[i] = redact(field)
		}
		return clean
	default:
		return v
	}
}
