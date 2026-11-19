package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func (s *Server) change(e endpoint, w http.ResponseWriter, q *request, authorize func(*state.Tx) error, out *response) error {
	r := q.r
	key := r.Header.Get("Idempotency-Key")
	if len(key) == 0 || len(key) > 64 {
		return state.Invalid("Idempotency-Key must contain 1 to 64 characters")
	}
	var err error
	if e.definition == "file" {
		q.upload, err = s.receive(w, q.r)
		if err != nil {
			return err
		}
		defer q.upload.Discard()
		q.raw, _ = json.Marshal(struct {
			SHA  string `json:"sha256"`
			Type string `json:"content_type"`
		}{q.upload.Hash, q.upload.ContentType})
		encoded, err := s.Protocol.CanonicalJSON(q.raw)
		if err != nil {
			return err
		}
		q.raw = []byte(encoded)
	} else {
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
			return state.Invalid("State changes require application/json")
		}

		q.raw, err = io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
		if err != nil {
			var limit *http.MaxBytesError
			if errors.As(err, &limit) {
				return state.Refusal{Status: 413, Code: "too_large", Reason: "JSON body exceeds 16 MiB"}
			}
			return err
		}
		if e.definition != "" {
			if !json.Valid(q.raw) {
				return state.Invalid("Malformed JSON")
			}
			name := e.definition
			if name == "answer" {
				var hdr struct{ Type string }
				json.Unmarshal(q.raw, &hdr)
				name = hdr.Type
				if name != "plugin.result" && name != "plugin.failure" {
					return state.Invalid("Expected a Plugin answer")
				}
			}
			if err = s.Protocol.CheckJSON(name, q.raw); err != nil {
				return err
			}
			if err = json.Unmarshal(q.raw, &q.body); err != nil {
				return state.Invalid("Expected an object")
			}
		} else if len(q.raw) > 0 {
			if err = json.Unmarshal(q.raw, &q.body); err != nil || len(q.body) > 0 {
				return state.Invalid("This route takes no body")
			}
		}
	}
	scope := q.caller.kind + ":" + q.caller.id
	if q.caller.kind == "asset" {
		scope = "asset_key:" + q.caller.id
	}
	if e.definition == "requests.login" {
		scope = "login"
	}
	var fingerprint string
	created := false
	password := e.definition == "requests.login" || e.definition == "requests.account"
	if !password {
		fingerprint, err = s.requestFingerprint(r, q.pattern, q.raw)
		if err != nil {
			return err
		}
	}
	retryPreparation := errors.New("retry credential preparation")
	graceExpired := state.Refusal{Status: 503, Code: "stopping", Reason: "Core has finished its stop grace"}
	for {
		if password {
			q.password, err = s.preparePassword(q, e.definition, scope, key)
			if err != nil {
				return err
			}
		}
		err = s.Do(r.Context(), func(tx *state.Tx) error {
			if err := authorize(tx); err != nil {
				return err
			}
			q.Tx = tx

			if s.CommitsClosed.Load() {
				return graceExpired
			}
			var prior string
			var status int
			var saved string
			err := tx.QueryRow("SELECT fingerprint,status,response FROM idempotency_keys WHERE run_id=? AND scope=? AND key=?", s.Run.ID, scope, key).Scan(&prior, &status, &saved)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if password {
				if prior != q.password.prior {
					return retryPreparation
				}
				fingerprint = q.password.fingerprint
				if e.definition == "requests.login" {
					var hash string
					hash, err = administration.PasswordHash(tx.Tx, q.body["operator_id"].(string))
					if errors.Is(err, sql.ErrNoRows) || err == nil && hash != q.password.hash {
						return unauthenticated()
					}
					if err != nil {
						return err
					}
				}
			}
			if prior != "" {
				if fingerprint != prior {
					return state.Refusal{Status: 409, Code: "idempotency_conflict", Reason: "This key was used for another request"}
				}
				q.replayed = true
				*out = response{status: status, body: json.RawMessage(saved)}
				if r.URL.Path == "/administration/logout" {
					out.cookie = expiredCookie
				}
				return nil
			}
			if q.caller.ended {
				return unauthenticated()
			}
			result, err := e.serve(q)
			if err != nil {
				return err
			}
			*out = result
			created = true
			ack := result.ack
			if ack == nil {
				ack = result.body
			}
			data, err := json.Marshal(ack)
			if err != nil {
				return err
			}
			_, err = tx.Exec("INSERT INTO idempotency_keys VALUES (?,?,?,?,?,?)", s.Run.ID, scope, key, fingerprint, result.status, string(data))
			if err == nil && s.CommitsClosed.Load() {
				return graceExpired
			}
			return err
		})
		if !errors.Is(err, retryPreparation) {
			break
		}
	}
	if q.upload != nil && err == nil && created {
		q.upload.Retained = true
	}
	return err
}
