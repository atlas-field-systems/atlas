package api

import (
	"encoding/json"
	"fmt"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
	"github.com/atlas-field-systems/atlas/core/internal/tasks"
)

func (s *Server) authorizeSubject(q *request) error {
	c := q.caller
	if q.r.Method == "GET" || c.kind == "account" || c.kind == "anonymous" {
		return nil
	}
	if c.kind == "plugin" && q.r.PathValue("plugin_id") != "" && q.r.PathValue("plugin_id") != c.id {
		return state.Forbidden("This Plugin is not yours")
	}
	asset := q.r.PathValue("asset_id")
	creation := q.r.Method == "POST" && (q.r.URL.Path == "/objects" || q.r.URL.Path == "/entities/geofeatures")
	if creation {
		asset = q.r.URL.Query().Get("asset_id")
	}
	if asset == "" && !creation {
		return nil
	}
	if c.kind == "asset" {
		own, err := entities.AssetForKey(q.Tx, q.caller.id)
		if err != nil {
			return err
		}
		if own == "" || asset != "" && asset != own {
			return state.Forbidden("This Asset is not yours")
		}
	}
	if c.kind == "gateway" {
		ok, err := entities.GatewayCarries(q.Tx, c.id, asset)
		if err != nil {
			return err
		}
		if !ok {
			return state.Forbidden("This gateway does not carry that Asset")
		}
	}
	return nil
}

func (s *Server) heard(q *request) error {
	kind, id := q.caller.kind, q.caller.id
	if kind == "asset" {
		var err error
		id, err = entities.AssetForKey(q.Tx, q.caller.id)
		if err != nil {
			return err
		}
	}
	if q.r.URL.Path == "/about" && q.r.Header.Get("Atlas-Definitions") != "" && q.r.Header.Get("Atlas-Definitions") != s.Protocol.Versions.Hash && (kind == "asset" || kind == "gateway" || kind == "plugin") {
		hash := q.r.Header.Get("Atlas-Definitions")
		if id == "" {
			result, err := q.Tx.Exec("INSERT OR IGNORE INTO asset_key_mismatches VALUES (?,?,?)", s.Run.ID, q.caller.id, hash)
			if err == nil {
				if n, _ := result.RowsAffected(); n != 0 {
					q.Record("warn", "identity", "Unregistered Asset definitions mismatch", object{"key_id": q.caller.id, "definitions_hash": hash})
				}
			}
			if err != nil {
				return err
			}
		} else {
			record := object{"time": q.Now, kind + "_id": id, "definitions_hash": hash}
			if s.Protocol.Check("refusal", record) == nil {
				var exists bool
				err := q.Tx.QueryRow(`SELECT EXISTS(
                    SELECT 1 FROM events WHERE run_id=? AND kind='definitions.refused'
                    AND json_extract(record,?)=? AND json_extract(record,'$.definitions_hash')=?
                    AND coalesce(json_extract(record,'$.radio'),0)=0)`, s.Run.ID, "$."+kind+"_id", id, hash).Scan(&exists)
				if err != nil {
					return err
				}
				if !exists {
					if _, err = q.Append("definitions.refused", record); err != nil {
						return err
					}
				}
			}
		}
	}
	if id == "" {
		return nil
	}
	if kind == "asset" || kind == "gateway" || kind == "plugin" {
		_, err := s.contact(q, kind, id, object{"time": q.Now, kind + "_id": id, "contact": "online"})
		return err
	}
	return nil
}

func (s *Server) contact(q *request, kind, id string, record object) (bool, error) {
	var changed bool
	var err error
	if kind == "asset" {
		changed, err = entities.SetContact(q.Tx, id, record)
	} else {
		changed, err = administration.SetContact(q.Tx, kind, id, record)
	}
	if err != nil || !changed {
		return false, err
	}
	if record["contact"] != "offline" {
		return true, nil
	}
	switch kind {
	case "asset":
		return true, tasks.Drop(q.Tx, id, false)
	case "plugin":
		return true, q.DropRequests("plugin", id)
	case "gateway":
		return true, s.disconnectRadios(q, id, record["time"])
	}
	return true, nil
}

func (s *Server) disconnectRadios(q *request, gateway string, at any) error {
	ids, err := entities.CarriedBy(q.Tx, gateway)
	if err != nil {
		return err
	}
	for _, id := range ids {
		last, err := entities.LastHeard(q.Tx, id, at)
		if err != nil {
			return err
		}
		if _, err = s.contact(q, "asset", id, object{"asset_id": id, "time": last, "contact": "offline"}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) assetRoutes(add register) {
	add("POST /entities/assets", "asset", "requests.asset", s.registerAsset)
	add("POST /entities/assets/radios", "gateway", "requests.radio", s.registerAsset)
	add("PUT /entities/assets/{asset_id}/description", "gateway", "description", func(q *request) (response, error) {
		id := q.r.PathValue("asset_id")
		if q.body["asset_id"] != id {
			return response{}, state.Invalid("Description Asset differs from path")
		}
		exists, err := entities.HasDescription(q.Tx, id)
		if err != nil {
			return response{}, err
		}
		if exists {
			if err := tasks.Drop(q.Tx, id, true); err != nil {
				return response{}, err
			}
		}
		event, err := entities.Describe(q.Tx, id, q.body)
		return ok(object{"event_id": event}), err
	})
	add("PUT /entities/assets/{asset_id}/contact", "gateway", "contact", func(q *request) (response, error) {
		id := q.r.PathValue("asset_id")
		if q.body["asset_id"] != id {
			return response{}, state.Invalid("Contact Asset differs from path")
		}
		changed, err := s.contact(q, "asset", id, q.body)
		return ok(object{"changed": changed}), err
	})
	add("POST /entities/assets/{asset_id}/reports", "asset gateway", "requests.reports", s.storeReports)
	add("DELETE /administration/assets/{asset_id}", "admin", "", func(q *request) (response, error) {
		id := q.r.PathValue("asset_id")
		if err := entities.Remove(q.Tx, id); err != nil {
			return response{}, err
		}
		if err := tasks.Drop(q.Tx, id, true); err != nil {
			return response{}, err
		}
		event, err := q.Append("asset.removed", object{"asset_id": id, "time": q.Now, "requested_by": q.caller.id})
		return ok(object{"event_id": event}), err
	})
}

func (s *Server) registerAsset(q *request) (response, error) {
	radio := q.caller.kind == "gateway"
	id := ""
	var err error
	if radio && q.body["definitions_hash"] != s.Protocol.Versions.Hash {
		_, err := q.Append("definitions.refused", object{"time": q.Now, "gateway_id": q.caller.id, "radio": true, "definitions_hash": q.body["definitions_hash"]})
		return response{status: 409, body: object{"error": "definitions_mismatch", "explanation": "The radio uses different Protocol definitions."}}, err
	}
	if !radio {
		id, err = entities.AssetForKey(q.Tx, q.caller.id)
		if err != nil {
			return response{}, err
		}
	}
	if id != "" {
		if err = tasks.Drop(q.Tx, id, true); err != nil {
			return response{}, err
		}
	} else {
		id, err = administration.NextGlobalID(q.Tx.Tx)
		if err != nil {
			return response{}, err
		}
		if err = entities.Register(q.Tx, id, q.caller.id, radio); err != nil {
			return response{}, err
		}
	}
	body := object{"asset_id": id}
	if !radio {
		desc := q.body
		desc["time"] = q.Now
		desc["asset_id"] = id
		if _, err = entities.Describe(q.Tx, id, desc); err != nil {
			return response{}, err
		}
		if _, err = s.contact(q, "asset", id, object{"asset_id": id, "time": q.Now, "contact": "online"}); err != nil {
			return response{}, err
		}
		last, err := tasks.LastID(q.Tx, id)
		if err != nil {
			return response{}, err
		}
		body["last_task_id"] = last
	}
	body["as_of"], err = state.AsOf(q.Tx.Tx)
	return response{status: 201, body: body}, err
}

func (s *Server) storeReports(q *request) (response, error) {
	id := q.r.PathValue("asset_id")
	if err := entities.NoteHeard(q.Tx, id); err != nil {
		return response{}, err
	}
	var payload struct{ Reports []json.RawMessage }
	if err := json.Unmarshal(q.raw, &payload); err != nil {
		return response{}, err
	}
	reports := q.body["reports"].([]any)
	for i, raw := range reports {
		r, ok := raw.(map[string]any)
		if !ok {
			return response{}, state.Invalid(fmt.Sprintf("/reports/%d/type: unknown report", i))
		}
		kind, _ := r["type"].(string)
		if !q.IsReport(kind) {
			return response{}, state.Invalid(fmt.Sprintf("/reports/%d/type: unknown report", i))
		}
		reportTime, _ := r["time"].(float64)
		ahead := reportTime > float64(q.Now)+1000*s.Config.ClockAhead
		event, err := q.AppendReport(kind, id, payload.Reports[i], ahead)
		if err != nil {
			return response{}, err
		}
		if r["asset_id"] != id {
			return response{}, state.Forbidden("Report Asset differs from path")
		}
		q.Record("trace", "entities", "Report stored", object{"asset_id": id, "event_id": event, "report_type": kind, "report_time": r["time"], "clock_ahead": ahead})
		if kind == "report.status" {
			err = tasks.ApplyStatus(q.Tx, id, r, event, ahead)
			if err != nil {
				return response{}, err
			}
		}
	}
	return ok(object{"stored": len(reports)}), nil
}
