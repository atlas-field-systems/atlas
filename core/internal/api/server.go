// Package api serves the Atlas Core HTTP contract.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"unicode/utf8"

	"github.com/mattn/go-sqlite3"

	"github.com/atlas-field-systems/atlas/core/internal/fusion"
	"github.com/atlas-field-systems/atlas/core/internal/objects"
	"github.com/atlas-field-systems/atlas/core/internal/protocol"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type object = state.Record

func unauthenticated() error {
	return state.Refusal{Status: 401, Code: "unauthenticated", Reason: "Invalid credential"}
}

type Server struct {
	*state.Run
	passwordSlots chan struct{}
	streams       context.Context
	stopStreams   context.CancelFunc
	active        sync.WaitGroup
	admission     sync.Mutex
	CommitsClosed atomic.Bool

	debugPath string
	resumedAt int64
	Fusion    fusion.Module

	Stopping atomic.Bool
}

type request struct {
	*state.Tx
	password passwordPreparation
	replayed bool
	upload   *objects.Upload
	r        *http.Request
	caller   caller
	body     object
	raw      []byte
	pattern  string
}

type response struct {
	body   any
	status int
	ack    any
	cookie string
	file   *download
}

func ok(body any) response { return response{body: body, status: 200} }

type endpoint struct {
	pattern, access, definition string
	serve                       func(*request) (response, error)
}

func (s *Server) Handler() http.Handler {
	s.streams, s.stopStreams = context.WithCancel(context.Background())
	s.passwordSlots = make(chan struct{}, 4)
	mux := http.NewServeMux()
	// Choose the most specific path before matching its method. For example,
	// GET /entities/assets/radios must not fall through to the Asset-ID route.
	paths := make(map[string]map[string]http.HandlerFunc)
	route := func(pattern string, handler http.HandlerFunc) {
		method, path, _ := strings.Cut(pattern, " ")
		if paths[path] == nil {
			methods := make(map[string]http.HandlerFunc)
			paths[path] = methods
			mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
				serve := methods[r.Method]
				if serve == nil {
					writeError(w, state.Refusal{Status: 405, Code: "method_not_allowed", Reason: "Method not allowed"})
					return
				}
				if _, err := s.expireContacts(r.Context()); err != nil {
					writeError(w, err)
					return
				}
				serve(w, r)
			})
		}
		paths[path][method] = handler
	}
	s.routes(func(pattern, access, definition string, serve func(*request) (response, error)) {
		e := endpoint{pattern, access, definition, serve}
		route(pattern, func(w http.ResponseWriter, r *http.Request) { s.handle(e, w, r) })
	})
	if s.debugPath != "" {
		route("GET "+s.debugPath, s.debug)
	}
	route("GET /events", s.stream)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if conn, ok := r.Context().Value(connKey{}).(*connection); ok {
			conn.handling.Store(true)
		}
		s.admission.Lock()
		if s.Stopping.Load() {
			s.admission.Unlock()
			writeError(w, state.Refusal{Status: 503, Code: "stopping", Reason: "Core is stopping"})
			return
		}
		s.active.Add(1)
		s.admission.Unlock()
		defer s.active.Done()
		if !utf8.ValidString(r.URL.Path) {
			writeError(w, state.Invalid("Malformed path escape"))
			return
		}
		// URLSearchParams accepts literal semicolons and incomplete percent escapes.
		if r.URL.RawQuery != "" {
			r.URL.RawQuery = formQuery(r.URL.RawQuery)
		}
		_, pattern := mux.Handler(r)
		if pattern == "" {
			writeError(w, state.Missing("No such route"))
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// BeginStop closes live streams and admission. Already admitted writes get the grace period.
func (s *Server) BeginStop() {
	s.admission.Lock()
	s.Stopping.Store(true)
	s.stopStreams()
	s.admission.Unlock()
}

func (s *Server) Wait() { s.active.Wait() }

func writeError(w http.ResponseWriter, err error) {
	var del objects.Deleted
	if errors.As(err, &del) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(410)
		json.NewEncoder(w).Encode(object{"error": "deleted", "explanation": "Object deleted", "deletion": del.Record})
		return
	}
	f := errorDetails(err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.Status)
	json.NewEncoder(w).Encode(object{"error": f.Code, "explanation": f.Reason})
}

func errorDetails(err error) state.Refusal {
	var se sqlite3.Error
	if errors.As(err, &se) && (se.Code == sqlite3.ErrFull || se.Code == sqlite3.ErrIoErr) || errors.Is(err, syscall.ENOSPC) || errors.Is(err, syscall.EDQUOT) || errors.Is(err, syscall.EIO) {
		return state.Refusal{Status: 507, Code: "storage_full", Reason: "Core could not store the change"}
	}
	var del objects.Deleted
	if errors.As(err, &del) {
		return state.Refusal{Status: 410, Code: "deleted", Reason: "Object deleted"}
	}
	var f state.Refusal
	var problem protocol.Invalid
	if errors.As(err, &problem) {
		f = state.Refusal{Status: 400, Code: "invalid", Reason: problem.Error()}
	} else if !errors.As(err, &f) {
		fmt.Fprintln(os.Stderr, err)
		f = state.Refusal{Status: 500, Code: "internal_error", Reason: "Internal error"}
	}
	return f
}

func (s *Server) handle(e endpoint, w http.ResponseWriter, r *http.Request) {
	q := request{pattern: e.pattern, r: r}
	write := r.Method != "GET"
	authorize := func(tx *state.Tx) error {
		c, err := authenticate(tx.Tx, r, s.Run.ID, e.access == "public", r.URL.Path == "/administration/logout")
		if err != nil {
			return err
		}
		if e.access != "public" && e.access != "reader" && !(e.access == "admin" && c.admin) && !slices.Contains(strings.Fields(e.access), c.kind) {
			return state.Refusal{Status: 403, Code: "forbidden", Reason: "This caller may not use this route"}
		}
		q.caller = c
		q.Tx = tx
		return s.authorizeSubject(&q)
	}
	var result response
	var serveErr error
	err := s.Do(r.Context(), func(tx *state.Tx) error {
		if err := authorize(tx); err != nil {
			return err
		}
		if r.URL.Path != "/about" && r.Header.Get("Atlas-Definitions") != s.Protocol.Versions.Hash {
			return state.Refusal{Status: 409, Code: "definitions_mismatch", Reason: "Use the definitions hash reported by GET /about"}
		}
		if err := s.heard(&q); err != nil {
			return err
		}
		if write {
			return nil
		}
		// A valid caller was heard even when the requested resource is missing.
		result, serveErr = e.serve(&q)
		return nil
	})
	if err == nil {
		err = serveErr
	}
	if err == nil && write {
		err = s.change(e, w, &q, authorize, &result)
	}
	s.logResult(&q, result, err)
	if err != nil {
		if result.file != nil {
			result.file.file.Close()
		}
		writeError(w, err)
		return
	}
	if result.file != nil {
		if err := result.file.send(w); err != nil {
			return
		}
		s.Log.Record("info", "api", "file downloaded", object{"object_id": r.PathValue("object_id"), "route": "/objects/:object_id/file", "size_bytes": result.file.size})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if result.cookie != "" {
		w.Header().Set("Set-Cookie", result.cookie)
	}
	w.WriteHeader(result.status)
	json.NewEncoder(w).Encode(result.body)
}

const expiredCookie = "atlas_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
