package api

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/objects"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func (s *Server) pluginRoutes(add register) {
	add("PUT /plugins/{plugin_id}/description", "plugin", "plugin.description", func(q *request) (response, error) {
		id := q.r.PathValue("plugin_id")
		if q.body["plugin_id"] != id {
			return response{}, state.Invalid("plugin_id must match the path")
		}
		event, err := administration.DescribePlugin(q.Tx, id, q.body)
		return ok(object{"event_id": event}), err
	})
	add("POST /plugins/{plugin_id}/actions/{action}", "account", "requests.plugin_call", s.callPlugin)
	add("POST /plugins/{plugin_id}/answers", "plugin", "answer", s.answerPlugin)
	add("GET /plugins/{plugin_id}/calls/{event_id}", "reader", "", func(q *request) (response, error) {
		n, err := integer(q.r.PathValue("event_id"))
		if err != nil {
			return response{}, state.Missing("No such call")
		}
		entry, err := s.callEntry(q, q.r.PathValue("plugin_id"), n)
		return ok(entry), err
	})
	add("GET /plugins/{plugin_id}/calls", "reader", "", func(q *request) (response, error) {
		id := q.r.PathValue("plugin_id")
		exists, err := administration.PluginKnown(q.Tx, id)
		if err != nil {
			return response{}, err
		}
		if !exists {
			return response{}, state.Missing("No such Plugin")
		}
		v := q.r.URL.Query()
		before := int64(9007199254740991)
		limit, err := pageSize(v)
		if err != nil {
			return response{}, err
		}
		if v.Has("cursor") {
			before, err = integer(v.Get("cursor"))
			if err != nil || before < 1 {
				return response{}, state.Invalid("Invalid page")
			}
		}
		calls, err := state.Events(q.Tx.Tx, " AND e.kind='plugin.called' AND e.plugin_id=? AND event_id<? ORDER BY event_id DESC LIMIT ?", s.Run.ID, id, before, limit+1)
		if err != nil {
			return response{}, err
		}
		var next any
		if int64(len(calls)) > limit {
			calls = calls[:limit]
			next = strconv.FormatInt(calls[limit-1].ID, 10)
		}
		items := []object{}
		for _, call := range calls {
			entry, err := s.callAnswer(q, call)
			if err != nil {
				return response{}, err
			}
			items = append(items, entry)
		}
		n, err := state.AsOf(q.Tx.Tx)
		return ok(object{"as_of": n, "items": items, "next_cursor": next}), err
	})
}

func (s *Server) callEntry(q *request, id string, n int64) (object, error) {
	found, err := state.Events(q.Tx.Tx, " AND e.kind='plugin.called' AND e.plugin_id=? AND e.event_id=?", s.Run.ID, id, n)
	if err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, state.Missing("No such call")
	}
	return s.callAnswer(q, found[0])
}

func (s *Server) callAnswer(q *request, call state.Event) (object, error) {
	answers, err := state.Events(q.Tx.Tx, ` AND e.request_id=? AND e.plugin_id=(SELECT plugin_id FROM events WHERE event_id=e.request_id) AND e.kind IN ('plugin.result','plugin.failed','plugin.dropped') ORDER BY e.event_id LIMIT 1`, s.Run.ID, call.ID)
	if err != nil {
		return nil, err
	}
	entry := object{"call": call, "answer": nil}
	if len(answers) > 0 {
		entry["answer"] = answers[0]
	}
	return entry, nil
}

func (s *Server) callPlugin(q *request) (response, error) {
	id, name := q.r.PathValue("plugin_id"), q.r.PathValue("action")
	desc, err := administration.PluginDescription(q.Tx, id)
	if err != nil {
		return response{}, err
	}
	var d struct {
		Actions []struct {
			Action string
			Inputs []struct {
				Input    string
				Kind     string `json:"input_kind"`
				Choices  []string
				Optional bool
			}
		}
	}
	if desc != nil {
		if err = json.Unmarshal([]byte(*desc), &d); err != nil {
			return response{}, err
		}
	}
	for _, a := range d.Actions {
		if a.Action != name {
			continue
		}
		seen := map[string]bool{}
		problems := []string{}
		for i, raw := range q.body["inputs"].([]any) {
			v := raw.(map[string]any)
			input := v["input"].(string)
			valid := false
			for _, spec := range a.Inputs {
				if spec.Input == input && spec.Kind == v["kind"] {
					valid = true
					if spec.Kind == "choice" {
						valid = slices.Contains(spec.Choices, v["choice"].(string))
					}
					break
				}
			}
			if !valid || seen[input] {
				problems = append(problems, fmt.Sprintf("/inputs/%d: Unknown, repeated, or mismatched input", i))
			}
			seen[input] = true
		}
		for _, spec := range a.Inputs {
			if !spec.Optional && !seen[spec.Input] {
				problems = append(problems, "/inputs: Missing "+spec.Input)
			}
		}
		if len(problems) > 0 {
			return response{}, state.Invalid(strings.Join(problems, "; "))
		}
		event, err := q.Append("plugin.called", object{"type": "plugin.call", "time": q.Now, "plugin_id": id, "action": name, "inputs": q.body["inputs"], "requested_by": q.caller.id})
		return response{status: 202, body: object{"event_id": event}}, err
	}
	return response{}, state.Conflict("not_supported", "Plugin does not offer this action")
}

func (s *Server) answerPlugin(q *request) (response, error) {
	r := q.body
	plugin := q.r.PathValue("plugin_id")
	if r["plugin_id"] != plugin {
		return response{}, state.Invalid("plugin_id must match the path")
	}
	call := int64(r["request_id"].(float64))
	if err := s.openCall(q, plugin, call); err != nil {
		return response{}, err
	}
	places, _ := r["places"].([]any)
	for _, column := range []string{"geofeature_id", "object_id"} {
		ids, _ := r[column+"s"].([]any)
		createdFor, label := entities.PlaceCreatedFor, "Geo feature"
		if column == "object_id" {
			createdFor, label = objects.CreatedFor, "Object"
			for _, v := range places {
				p := v.(map[string]any)
				if p["kind"] == "imagery" {
					ids = append(ids, p["object_id"])
				}
			}
		}
		for _, id := range ids {
			exists, err := createdFor(q.Tx, id, call)
			if err != nil {
				return response{}, err
			}
			if !exists {
				return response{}, state.Invalid(label + " was not created by this call")
			}
		}
	}
	for _, v := range places {
		p := v.(map[string]any)
		if p["kind"] == "imagery" {
			if err := objects.RequireGeoTIFF(q.Tx, p["object_id"]); err != nil {
				return response{}, err
			}
		}
	}
	name := r["type"].(string)
	kind := name
	if name == "plugin.failure" {
		kind = "plugin.failed"
	}
	event, err := q.Append(kind, r)
	return ok(object{"event_id": event}), err
}
