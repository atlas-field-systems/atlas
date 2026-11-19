package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func (s *Server) PrepareDebug() (string, error) {
	if !s.Config.DebugEndpoint {
		return "", nil
	}
	segment, err := administration.RandomToken(24, base64.RawURLEncoding)
	if err != nil {
		return "", err
	}
	s.debugPath = "/debug/" + segment + "/log"
	return s.debugPath, nil
}

func (s *Server) debug(w http.ResponseWriter, r *http.Request) {
	var after int64
	if v := r.URL.Query(); v.Has("after") {
		var err error
		after, err = integer(v.Get("after"))
		if err != nil {
			writeError(w, state.Invalid("after must be nonnegative"))
			return
		}
	}
	lines, err := s.Log.ReadAfter(after)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	for _, line := range lines {
		if _, err = w.Write(append(line, '\n')); err != nil {
			return
		}
	}
}

func (s *Server) logResult(q *request, result response, err error) {
	route := strings.SplitN(q.pattern, " ", 2)[1]
	params := object{}
	for _, seg := range strings.Split(route, "/") {
		if strings.HasPrefix(seg, "{") {
			k := strings.Trim(seg, "{}")
			params[k] = q.r.PathValue(k)
			route = strings.Replace(route, seg, ":"+k, 1)
		}
	}
	actor := object{"kind": "anonymous"}
	if q.caller.kind != "" {
		actor["kind"] = q.caller.kind
		switch q.caller.kind {
		case "account":
			actor["operator_id"] = q.caller.id
		case "asset":
			actor["key_id"] = q.caller.id
		case "gateway", "plugin":
			actor[q.caller.kind+"_id"] = q.caller.id
		}
	}
	fields := object{"method": q.r.Method, "route": route, "params": params, "actor": actor, "replayed": q.replayed, "status": result.status}
	if err != nil {
		f := errorDetails(err)
		fields["status"], fields["error"], fields["explanation"] = f.Status, f.Code, f.Reason
	}
	if strings.HasPrefix(route, "/administration/") && q.r.Method != "GET" && err == nil {
		ack := result.ack
		if ack == nil {
			ack = result.body
		}
		raw, _ := json.Marshal(ack)
		var body object
		_ = json.Unmarshal(raw, &body)
		allowed := object{}
		for _, k := range []string{"operator_id", "key_id", "gateway_id", "plugin_id", "asset_id", "event_id", "issued", "replaced", "logged_in"} {
			if v, ok := body[k]; ok {
				allowed[k] = v
			}
		}
		fields["acknowledgment"] = allowed
	}
	s.Log.Record("info", "api", "request completed", fields)
}
