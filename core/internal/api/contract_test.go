package api

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/config"
	"github.com/atlas-field-systems/atlas/core/internal/diagnostics"
	"github.com/atlas-field-systems/atlas/core/internal/protocol"
	"github.com/atlas-field-systems/atlas/core/internal/state"
	"github.com/atlas-field-systems/atlas/core/internal/store"
)

func newCore(t *testing.T, source clock.Source) *Server {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(state.JSON(object{"data_directory": dir, "archive_directory": filepath.Join(t.TempDir(), "archive")})), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Read(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = cfg.PrepareDirs(); err != nil {
		t.Fatal(err)
	}
	p, err := protocol.Start()
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(dir, "core.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	run, err := db.BeginRun(context.Background(), source.Now().UnixMilli(), nil)
	if err != nil {
		t.Fatal(err)
	}
	log, err := diagnostics.Open(cfg, run.ID, source)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(log.Close)
	return &Server{Run: &state.Run{Config: cfg, Clock: source, Store: db, Run: run, Protocol: p, Log: log}}
}

func putSession(t *testing.T, s *Server) {
	t.Helper()
	hash, err := administration.HashPassword("contract-password")
	if err != nil {
		t.Fatal(err)
	}
	err = s.Store.Write(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec("INSERT INTO accounts VALUES ('ADM',1,?)", hash); err != nil {
			return err
		}
		_, err := tx.Exec("INSERT INTO sessions (run_id,token_hash,operator_id,created_at) VALUES (?,?,'ADM',1)", s.Run.ID, administration.Digest("test-session"))
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Set a real SQLite page limit and check the observable picture, including its event cursor.
func TestStorageFullRollsBackChange(t *testing.T) {
	s := newCore(t, clock.System{})
	putSession(t, s)
	handler := s.Handler()
	call := func(method, path, body, key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Cookie", "atlas_session=test-session")
		r.Header.Set("Atlas-Definitions", s.Protocol.Versions.Hash)
		r.Header.Set("Idempotency-Key", key)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	err := s.Store.Write(context.Background(), func(tx *sql.Tx) error {
		var pages int
		if err := tx.QueryRow("PRAGMA page_count").Scan(&pages); err != nil {
			return err
		}
		_, err := tx.Exec(fmt.Sprintf("PRAGMA max_page_count=%d", pages))
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	path := "/entities/geofeatures"
	point := `{"latitude":1,"longitude":2}`
	body := `{"kind":"line","line":[` + strings.TrimSuffix(strings.Repeat(point+",", 32), ",") + "]}"
	for i := 0; i < 100; i++ {
		before := call("GET", path, "", "")
		if before.Code != 200 {
			t.Fatal(before.Code, before.Body)
		}
		response := call("POST", path, body, fmt.Sprint(i))
		if response.Code == 200 {
			continue
		}
		if response.Code != 507 || !strings.Contains(response.Body.String(), `"error":"storage_full"`) {
			t.Fatal(response.Code, response.Body)
		}
		after := call("GET", path, "", "")
		if before.Body.String() != after.Body.String() {
			t.Fatal("refused change modified the picture or its event cursor")
		}
		return
	}
	t.Fatal("SQLite did not reach the page limit")
}

// End the grace period at reauthorization, after password preparation and before commit.
func TestPreparedLoginCannotCommitAfterGrace(t *testing.T) {
	s := newCore(t, clock.System{})
	putSession(t, s)
	s.Handler()
	r := httptest.NewRequest("POST", "/administration/login", strings.NewReader(`{"operator_id":"ADM","password":"contract-password"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", "pending-login")
	q := request{r: r, pattern: "POST /administration/login", caller: caller{kind: "anonymous"}}
	err := s.change(endpoint{pattern: q.pattern, definition: "requests.login", serve: s.login}, httptest.NewRecorder(), &q, func(tx *state.Tx) error {
		if q.password.fingerprint == "" {
			t.Fatal("login reached commit without a prepared fingerprint")
		}
		s.BeginStop()
		s.CommitsClosed.Store(true)
		return nil
	}, new(response))
	if f := errorDetails(err); f.Status != 503 || f.Code != "stopping" {
		t.Fatalf("got %v", err)
	}
	err = s.Store.Write(context.Background(), func(tx *sql.Tx) error {
		var sessions, keys int
		if err := tx.QueryRow("SELECT (SELECT count(*) FROM sessions),(SELECT count(*) FROM idempotency_keys)").Scan(&sessions, &keys); err != nil {
			return err
		}
		if sessions != 1 || keys != 0 {
			t.Fatalf("grace expiry left %d sessions and %d retry keys", sessions, keys)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

type deadline struct {
	at   time.Time
	fire chan time.Time
}

type manualClock struct{ timers chan deadline }

func (c manualClock) Now() time.Time { return time.Unix(1800000000, 0) }
func (c manualClock) At(at time.Time) clock.Timer {
	t := deadline{at, make(chan time.Time, 1)}
	c.timers <- t
	return clock.Timer{C: t.fire, Cancel: func() {}}
}

func (c manualClock) next(t *testing.T, want time.Duration) deadline {
	t.Helper()
	select {
	case next := <-c.timers:
		if next.at.Sub(c.Now()) != want {
			t.Fatalf("expected %s timer, got %s", want, next.at.Sub(c.Now()))
		}
		return next
	case <-time.After(5 * time.Second):
		t.Fatal("timer was never armed")
	}
	return deadline{}
}

type pipeListener struct {
	net.Listener
	pipe   chan net.Conn
	closed chan struct{}
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.pipe:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *pipeListener) Close() error { close(l.closed); return nil }

// net.Pipe has no socket buffer. Once headers are consumed, the next flush
// stalls until either a reader drains it or Core closes its connection.
func TestStalledStream(t *testing.T) {
	for _, mode := range []string{"event", "keepalive"} {
		t.Run(mode, func(t *testing.T) {
			c := manualClock{make(chan deadline, 4)}
			s := newCore(t, c)
			putSession(t, s)
			if mode == "event" {
				err := s.Store.Write(context.Background(), func(tx *sql.Tx) error {
					_, err := tx.Exec("INSERT INTO events(run_id,time,kind,record) VALUES (?,?,?,?)", s.Run.ID, 1, "asset.contact", `{"asset_id":"A","time":1,"contact":"online"}`)
					return err
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			client, peer := net.Pipe()
			defer client.Close()
			l := &pipeListener{pipe: make(chan net.Conn, 1), closed: make(chan struct{})}
			l.pipe <- peer
			server, listener := s.HTTP(l)
			go server.Serve(listener)
			defer func() { server.Close(); s.Wait() }()
			if _, err := fmt.Fprintf(client, "GET /events?after=0 HTTP/1.1\r\nHost: localhost\r\nCookie: atlas_session=test-session\r\nAtlas-Definitions: %s\r\n\r\n", s.Protocol.Versions.Hash); err != nil {
				t.Fatal(err)
			}
			reader := bufio.NewReader(client)
			for {
				line, err := reader.ReadString('\n')
				if err != nil {
					t.Fatal(err)
				}
				if line == "\r\n" {
					break
				}
			}
			alive := c.next(t, 10*time.Second)
			if mode == "keepalive" {
				alive.fire <- alive.at
				c.next(t, 10*time.Second)
			}
			timeout := c.next(t, 30*time.Second)
			timeout.fire <- timeout.at
			// Wait for closure before reading, so the stream cannot escape backpressure.
			ended := make(chan struct{})
			go func() { s.Wait(); close(ended) }()
			select {
			case <-ended:
			case <-time.After(5 * time.Second):
				t.Fatal("stalled stream did not close")
			}
			_, err := reader.ReadByte()
			if err != io.EOF {
				t.Fatalf("stalled stream still had output: %v", err)
			}
		})
	}
}

// The persisted digest was produced by the TypeScript server's JSON.stringify
// and URLSearchParams. Resuming an open run must recognize the original retry.
func TestLegacyFingerprint(t *testing.T) {
	s := newCore(t, clock.System{})
	r := httptest.NewRequest("POST", "/plugins/A/actions/caf%C3%A9%3C%26?x=rock~&x=*&space=%20&semi=;&broken=%E2%82&bad=%FF%FE&literal=%", nil)
	r.SetPathValue("plugin_id", "A")
	r.SetPathValue("action", "café<&")
	got, err := s.requestFingerprint(r, "POST /plugins/{plugin_id}/actions/{action}", []byte(`{"inputs":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	if got != "a0763540b3005e8c18db6817c5af8344b5633c306327903813a1e5c81dc74bd0" {
		t.Fatalf("incompatible retry fingerprint %s", got)
	}
}

func TestMethodsMatchTheMostSpecificPath(t *testing.T) {
	s := newCore(t, clock.System{})
	handle := s.Handler()
	for _, call := range []struct{ method, path string }{{"GET", "/entities/assets/radios"}, {"HEAD", "/events"}} {
		w := httptest.NewRecorder()
		handle.ServeHTTP(w, httptest.NewRequest(call.method, call.path, nil))
		if w.Code != 405 || !strings.Contains(w.Body.String(), "method_not_allowed") {
			t.Errorf("%s %s: %d %s", call.method, call.path, w.Code, w.Body)
		}
	}
}
