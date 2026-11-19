package state

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Record is a Protocol value that has passed the shared validator.
type Record = map[string]any

type Event struct {
	ID          int64           `json:"event_id"`
	Time        int64           `json:"time"`
	Kind        string          `json:"kind"`
	Record      json.RawMessage `json:"record"`
	RequestedBy *string         `json:"requested_by,omitempty"`
	Ahead       bool            `json:"clock_ahead,omitempty"`
	Order       int64           `json:"-"`
}

// Events returns a filtered page; the run ID is the first query argument.
func Events(tx *sql.Tx, where string, args ...any) ([]Event, error) {
	const selectEvent = "SELECT e.event_id,e.time,e.kind,e.record,e.requested_by,e.clock_ahead,e.order_time FROM events e WHERE e.run_id=?"
	rows, err := tx.Query(selectEvent+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Event{}
	for rows.Next() {
		var e Event
		var raw string
		if err := rows.Scan(&e.ID, &e.Time, &e.Kind, &raw, &e.RequestedBy, &e.Ahead, &e.Order); err != nil {
			return nil, err
		}
		e.Record = json.RawMessage(raw)
		items = append(items, e)
	}
	return items, rows.Err()
}

func (t *Tx) Append(kind string, record Record) (int64, error) {
	return t.appendRecord(kind, record, nil)
}

func (t *Tx) AppendPlace(kind, by string, record Record) (int64, error) {
	return t.appendRecord(kind, record, by)
}

func (t *Tx) appendRecord(kind string, record Record, by any) (int64, error) {
	spec, ok := t.Protocol.Events[kind]
	if !ok || spec.Many {
		return 0, fmt.Errorf("unknown single-record event %q", kind)
	}
	data, err := json.Marshal(record)
	if err != nil {
		return 0, err
	}
	if err := t.Protocol.CheckJSON(spec.Record, data); err != nil {
		return 0, fmt.Errorf("Core built invalid %s: %v", kind, err)
	}
	id, err := t.insert(kind, record["asset_id"], data, by, false)
	if err == nil {
		t.recordEvent(id, kind, record)
	}
	return id, err
}

func (t *Tx) AppendTasks(kind string, tasks []Record) (int64, error) {
	spec, ok := t.Protocol.Events[kind]
	if !ok || !spec.Many || len(tasks) == 0 {
		return 0, fmt.Errorf("invalid batch for %s", kind)
	}
	for _, task := range tasks {
		if err := t.Protocol.Check(spec.Record, task); err != nil {
			return 0, fmt.Errorf("Core built invalid %s: %v", kind, err)
		}
	}
	data, err := json.Marshal(tasks)
	if err != nil {
		return 0, err
	}
	return t.insert(kind, tasks[0]["asset_id"], data, nil, false)
}

// Preserve the received record's property order in evidence and replay.
func (t *Tx) AppendReport(kind, asset string, raw json.RawMessage, ahead bool) (int64, error) {
	if !t.IsReport(kind) {
		return 0, errors.New("unknown report kind")
	}
	if err := t.Protocol.CheckJSON(kind, raw); err != nil {
		return 0, err
	}
	return t.insert(kind, asset, raw, nil, ahead)
}

func (t *Tx) IsReport(kind string) bool {
	_, ok := t.Protocol.Events[kind]
	return ok && strings.HasPrefix(kind, "report.")
}

func (t *Tx) insert(kind string, asset any, data []byte, by any, ahead bool) (int64, error) {
	result, err := t.Exec(`INSERT INTO events(run_id,time,kind,asset_id,record,requested_by,clock_ahead) VALUES (?,?,?,?,?,?,?)`, t.ID, t.Now, kind, asset, string(data), by, ahead)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (t *Tx) recordEvent(id int64, kind string, record Record) {
	if !strings.HasSuffix(kind, ".contact") && !strings.HasSuffix(kind, ".dropped") && !strings.HasPrefix(kind, "track.") {
		return
	}
	fields := Record{"event_id": id, "kind": kind}
	for _, k := range []string{"asset_id", "plugin_id", "track_id", "gateway_id", "task_id", "request_id", "contact"} {
		if v, ok := record[k]; ok {
			fields[k] = v
		}
	}
	msg, area := kind, "requests"
	if strings.HasSuffix(kind, ".contact") {
		fields["last_heard"] = record["time"]
		names := map[string]string{"asset.contact": "Asset", "gateway.contact": "Gateway", "plugin.contact": "Plugin"}
		msg = names[kind] + " contact changed"
		area = "contact"
	} else if strings.HasPrefix(kind, "track.") {
		area = "fusion"
	}
	t.Record("info", area, msg, fields)
}

const SettlementMatch = `a.run_id=e.run_id AND a.request_id=e.event_id AND
 ((e.kind='plugin.called' AND a.plugin_id=e.plugin_id AND a.kind IN ('plugin.result','plugin.failed','plugin.dropped'))
 OR (a.asset_id=e.asset_id AND ((e.kind='settings.requested' AND a.kind IN ('report.settings','request.dropped'))
 OR (e.kind IN ('tasks.requested','tasks.updated','cancel.requested') AND a.kind IN ('report.status','request.dropped')))))`

func (t *Tx) DropRequests(kind, id string) error {
	if kind != "plugin" && kind != "asset" {
		return fmt.Errorf("unsupported recipient %q", kind)
	}
	column := kind + "_id"
	drop := "request.dropped"
	if kind == "plugin" {
		drop = "plugin.dropped"
	}
	ids, err := Column[int64](t.Tx, "SELECT e.event_id FROM events e WHERE e.run_id=? AND e."+column+"=? AND e.kind IN ('plugin.called','tasks.requested','tasks.updated','cancel.requested','settings.requested') AND NOT EXISTS(SELECT 1 FROM events a WHERE "+SettlementMatch+") ORDER BY e.event_id", t.ID, id)
	if err != nil {
		return err
	}
	for _, event := range ids {
		if _, err = t.Append(drop, Record{column: id, "time": t.Now, "request_id": event}); err != nil {
			return err
		}
	}
	return nil
}
