package state

// Refusal carries a documented Core API error from admission to the HTTP boundary.
type Refusal struct {
	Status       int
	Code, Reason string
}

func (e Refusal) Error() string          { return e.Reason }
func Invalid(reason string) error        { return Refusal{400, "invalid", reason} }
func Missing(reason string) error        { return Refusal{404, "not_found", reason} }
func Forbidden(reason string) error      { return Refusal{403, "forbidden", reason} }
func Conflict(code, reason string) error { return Refusal{409, code, reason} }
