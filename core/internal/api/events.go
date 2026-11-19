package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func integer(s string) (int64, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n < 0 || n > 9007199254740991 {
		return 0, state.Invalid("Expected a nonnegative integer")
	}
	return n, nil
}

func pageSize(v url.Values) (int64, error) {
	if !v.Has("limit") {
		return 1000, nil
	}
	n, err := integer(v.Get("limit"))
	if err != nil || n < 1 {
		return 0, state.Invalid("Invalid page limit")
	}
	return min(n, 1000), nil
}

func (s *Server) historyRoutes(add register) {
	for _, h := range []struct{ path, group, id string }{{"/history", "report", "asset_id"}, {"/history/tracks", "track", "track_id"}, {"/history/geofeatures", "geofeature", "geofeature_id"}} {
		add("GET "+h.path, "reader", "", func(q *request) (response, error) {
			v := q.r.URL.Query()
			limit, err := pageSize(v)
			if err != nil {
				return response{}, err
			}
			filter := " AND kind LIKE ?"
			args := []any{s.Run.ID, h.group + ".%"}
			if v.Has(h.id) {
				filter += " AND " + h.id + "=?"
				args = append(args, v.Get(h.id))
			}
			if report := v.Get("report"); h.group == "report" && report != "" {
				name := "report." + strings.TrimPrefix(report, "report.")
				if !q.IsReport(name) {
					return response{}, state.Invalid("Unknown report kind")
				}
				filter += " AND kind=?"
				args = append(args, name)
			}
			for _, k := range []string{"since", "until"} {
				if v.Has(k) {
					n, err := integer(v.Get(k))
					if err != nil {
						return response{}, state.Invalid(k + " must be a time")
					}
					if k == "since" {
						filter += " AND order_time>=?"
					} else {
						filter += " AND order_time<=?"
					}
					args = append(args, n)
				}
			}
			order := "order_time"
			if h.group == "geofeature" {
				order = "event_id"
			}
			if cursor := v.Get("cursor"); cursor != "" {
				raw, err := base64.RawURLEncoding.DecodeString(cursor)
				var pair []int64
				if err != nil || json.Unmarshal(raw, &pair) != nil || len(pair) != 2 || pair[0] < 0 || pair[1] < 0 || pair[0] > 9007199254740991 || pair[1] > 9007199254740991 {
					return response{}, state.Invalid("Invalid history cursor")
				}
				filter += " AND (" + order + ",event_id)>(?,?)"
				args = append(args, pair[0], pair[1])
			}
			items, err := state.Events(q.Tx.Tx, filter+" ORDER BY "+order+",event_id LIMIT ?", append(args, limit+1)...)
			if err != nil {
				return response{}, err
			}
			var next any
			if int64(len(items)) > limit {
				items = items[:limit]
				last := items[limit-1]
				key := last.Order
				if order == "event_id" {
					key = last.ID
				}
				next = base64.RawURLEncoding.EncodeToString([]byte(state.JSON([]int64{key, last.ID})))
			}
			n, err := state.AsOf(q.Tx.Tx)
			return ok(object{"items": items, "as_of": n, "next_cursor": next}), err
		})
	}
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	var cursor int64
	params := r.URL.Query()
	err := s.Store.Write(r.Context(), func(tx *sql.Tx) error {
		if _, err := authenticate(tx, r, s.Run.ID, false, false); err != nil {
			return err
		}
		hash := r.Header.Get("Atlas-Definitions")
		if hash == "" {
			hash = params.Get("definitions")
		}
		if hash != s.Protocol.Versions.Hash {
			return state.Conflict("definitions_mismatch", "Use the definitions hash reported by GET /about")
		}
		raw := r.Header.Get("Last-Event-ID")
		if raw == "" {
			raw = params.Get("after")
		}
		var err error
		if raw == "" {
			cursor, err = state.AsOf(tx)
		} else {
			cursor, err = integer(raw)
		}
		return err
	})
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	ctl := http.NewResponseController(w)
	conn, ok := r.Context().Value(connKey{}).(*connection)
	if !ok {
		writeError(w, errors.New("stream requires its HTTP connection"))
		return
	}
	closeOnStop := context.AfterFunc(s.streams, func() { conn.Close() })
	defer closeOnStop()
	if err = ctl.Flush(); err != nil {
		panic(http.ErrAbortHandler)
	}
	s.Log.Record("info", "api", "event stream connected", object{"route": "/events"})
	defer s.Log.Record("info", "api", "event stream disconnected", object{"route": "/events"})
	interval := time.Duration(s.Config.StreamKeepalive * float64(time.Second))
	alive := s.Clock.At(s.Clock.Now().Add(max(time.Millisecond, interval)))
	defer func() { alive.Cancel() }()
	for {
		wake := s.Store.Changed()
		var batch []state.Event
		err = s.Do(r.Context(), func(tx *state.Tx) error {
			c, err := authenticate(tx.Tx, r, s.Run.ID, false, false)
			if err != nil {
				return err
			}
			filter := " AND e.event_id>?"
			args := []any{s.Run.ID, cursor}
			if c.kind == "account" || params.Get("everything") == "true" {
				if id := params.Get("asset_id"); id != "" {
					filter += " AND e.asset_id=?"
					args = append(args, id)
				}
			} else {
				switch c.kind {
				case "plugin":
					filter += " AND e.kind='plugin.called' AND e.plugin_id=?"
					args = append(args, c.id)
				case "asset", "gateway":
					filter += " AND e.kind IN ('tasks.requested','tasks.updated','cancel.requested','settings.requested','task.dropped')"
					if c.kind == "asset" {
						asset, err := entities.AssetForKey(tx, c.id)
						if err != nil {
							return err
						}
						filter += " AND e.asset_id=?"
						args = append(args, asset)
					} else {
						assets, err := entities.CarriedBy(tx, c.id)
						if err != nil {
							return err
						}
						filter += " AND e.asset_id IN (SELECT value FROM json_each(?))"
						args = append(args, state.JSON(assets))
					}
				}
				filter += " AND NOT EXISTS(SELECT 1 FROM events d WHERE d.run_id=e.run_id AND d.request_id=e.event_id AND d.kind IN ('request.dropped','plugin.dropped'))"
			}
			batch, err = state.Events(tx.Tx, filter+" ORDER BY e.event_id LIMIT 256", args...)
			return err
		})
		if err != nil {
			panic(http.ErrAbortHandler)
		}
		for _, e := range batch {
			data, err := json.Marshal(e)
			if err != nil {
				panic(http.ErrAbortHandler)
			}
			if err = s.writeFrame(w, conn, fmt.Sprintf("id: %d\nevent: %s\ndata: %s\n\n", e.ID, e.Kind, data)); err != nil {
				panic(http.ErrAbortHandler)
			}
			cursor = e.ID
		}
		if len(batch) == 256 {
			continue
		}
		select {
		case <-r.Context().Done():
			return
		case <-s.streams.Done():
			panic(http.ErrAbortHandler)
		case <-wake:
		case <-alive.C:
			fired := alive
			alive = s.Clock.At(s.Clock.Now().Add(max(time.Millisecond, interval)))
			err = s.writeFrame(w, conn, ": alive\n\n")
			fired.Cancel()
			if err != nil {
				panic(http.ErrAbortHandler)
			}
		}
	}
}

// Write at most one frame at a time. Closing the connection interrupts a
// blocked flush without sharing a ResponseWriter between goroutines.
func (s *Server) writeFrame(w http.ResponseWriter, conn *connection, frame string) error {
	if _, system := s.Clock.(clock.System); system {
		if err := conn.SetWriteDeadline(time.Now().Add(30 * time.Second)); err != nil {
			return err
		}
		defer conn.SetWriteDeadline(time.Time{})
	} else {
		// The injected clock may advance while the operating system clock stands still.
		timer := s.Clock.At(s.Clock.Now().Add(30 * time.Second))
		done, finished := make(chan struct{}), make(chan struct{})
		go func() {
			defer close(finished)
			select {
			case <-timer.C:
				conn.Close()
			case <-done:
			}
		}()
		defer func() { close(done); timer.Cancel(); <-finished }()
	}
	if _, err := fmt.Fprint(w, frame); err != nil {
		return err
	}
	return http.NewResponseController(w).Flush()
}

func (s *Server) openCall(q *request, plugin string, id int64) error {
	var settled bool
	err := q.Tx.QueryRow("SELECT EXISTS(SELECT 1 FROM events a WHERE "+state.SettlementMatch+") FROM events e WHERE e.run_id=? AND e.event_id=? AND e.kind='plugin.called' AND e.plugin_id=?", s.Run.ID, id, plugin).Scan(&settled)
	if errors.Is(err, sql.ErrNoRows) {
		return state.Missing("No such call for this Plugin")
	}
	if err != nil {
		return err
	}
	if settled {
		return state.Conflict("call_settled", "Call already answered or dropped")
	}
	return nil
}

func (s *Server) creator(q *request) (string, any, error) {
	switch q.caller.kind {
	case "plugin":
		n, err := integer(q.r.URL.Query().Get("request_id"))
		if err != nil || n < 1 {
			return "", nil, state.Invalid("Plugin writes require request_id")
		}
		return q.caller.id, n, s.openCall(q, q.caller.id, n)
	case "asset":
		id, err := entities.AssetForKey(q.Tx, q.caller.id)
		return id, nil, err
	case "gateway":
		return q.r.URL.Query().Get("asset_id"), nil, nil
	default:
		return q.caller.id, nil, nil
	}
}
