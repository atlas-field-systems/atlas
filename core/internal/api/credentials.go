package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type caller struct {
	kind, id, token string
	admin, ended    bool
}

func authenticate(tx *sql.Tx, r *http.Request, run int64, public, logout bool) (caller, error) {
	var c caller
	if header := r.Header.Get("Authorization"); header != "" {
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || len(token) != 22 {
			return c, unauthenticated()
		}
		var err error
		c.kind, c.id, err = administration.KeyOwner(tx, token)
		if errors.Is(err, sql.ErrNoRows) {
			return c, unauthenticated()
		}
		return c, err
	}
	cookie, err := r.Cookie("atlas_session")
	if err == nil && cookie.Value != "" {
		c.token = administration.Digest(cookie.Value)
		c.id, c.admin, c.ended, err = administration.SessionOwner(tx, run, c.token)
		if err == nil && (!c.ended || logout) {
			c.kind = "account"
			return c, nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return c, err
		}
	}
	if public {
		return caller{kind: "anonymous"}, nil
	}
	return c, unauthenticated()
}

// Scrypt preparation happens outside SQLite transactions. A racing first use
// of the same retry key is rechecked against the winner's salted fingerprint.
type passwordPreparation struct{ prior, fingerprint, hash string }

func (s *Server) preparePassword(q *request, definition, scope, key string) (passwordPreparation, error) {
	p := passwordPreparation{}
	err := s.Store.Write(q.r.Context(), func(tx *sql.Tx) error {
		err := tx.QueryRow("SELECT fingerprint FROM idempotency_keys WHERE run_id=? AND scope=? AND key=?", s.Run.ID, scope, key).Scan(&p.prior)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if definition == "requests.login" {
			p.hash, err = administration.PasswordHash(tx, q.body["operator_id"].(string))
			if errors.Is(err, sql.ErrNoRows) {
				return nil // Check a retained retry fingerprint before rejecting the login.
			}
			return err
		}
		return nil
	})
	if err != nil {
		return p, err
	}
	select {
	case s.passwordSlots <- struct{}{}:
		defer func() { <-s.passwordSlots }()
	case <-q.r.Context().Done():
		return p, q.r.Context().Err()
	}
	canonical, err := s.Protocol.CanonicalJSON(q.raw)
	if err != nil {
		return p, err
	}
	if p.prior != "" {
		if !administration.VerifyPassword(p.prior, canonical) {
			return p, state.Conflict("idempotency_conflict", "This key was used for another request")
		}
		p.fingerprint = p.prior
	} else {
		p.fingerprint, err = administration.HashPassword(canonical)
		if err != nil {
			return p, err
		}
	}
	password := q.body["password"].(string)
	if definition == "requests.login" {
		if !administration.VerifyPassword(p.hash, password) {
			return p, unauthenticated()
		}
	} else if p.prior == "" {
		p.hash, err = administration.HashPassword(password)
	}
	return p, err
}
