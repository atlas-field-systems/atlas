package entities

import (
	"database/sql"
	"encoding/json"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

const observationsSQL = `SELECT record FROM (
    SELECT record, row_number() OVER (
        PARTITION BY asset_id, observation_id ORDER BY order_time DESC, event_id DESC
    ) AS rank FROM events WHERE run_id=? AND kind='report.observation' AND clock_ahead=0
) WHERE rank=1`

// A report's acquisition time determines the current picture. Event IDs break ties.
var assetReports = map[string]string{
	"reports": `SELECT kind,record FROM (
        SELECT kind,record,row_number() OVER (PARTITION BY kind ORDER BY order_time DESC,event_id DESC) AS rank
        FROM events WHERE run_id=? AND asset_id=? AND clock_ahead=0 AND kind LIKE 'report.%'
        AND kind NOT IN ('report.observation','report.gimbal')
    ) WHERE rank=1`,
	"settings": `SELECT key,value FROM (
        SELECT j.key, json_object('value',json(json_extract(e.record,'$.settings')->j.key),'time',e.order_time) AS value,
            row_number() OVER (PARTITION BY j.key ORDER BY order_time DESC,event_id DESC) AS rank
        FROM events e, json_each(e.record,'$.settings') j
        WHERE run_id=? AND asset_id=? AND clock_ahead=0 AND kind='report.settings'
    ) WHERE rank=1`,
	"subsystems": `SELECT subsystem_id,record FROM (
        SELECT subsystem_id,record,row_number() OVER (PARTITION BY subsystem_id ORDER BY order_time DESC,event_id DESC) AS rank
        FROM events WHERE run_id=?1 AND asset_id=?2 AND clock_ahead=0 AND kind='report.status' AND sub_kind='subsystem'
        AND subsystem_id IN (
            SELECT json_extract(j.value,'$.subsystem_id') FROM assets, json_each(description,'$.subsystems') j
            WHERE run_id=?1 AND asset_id=?2
        )
    ) WHERE rank=1`,
	"gimbals": `SELECT camera,record FROM (
        SELECT json_extract(record,'$.camera_id') AS camera,record,
            row_number() OVER (PARTITION BY json_extract(record,'$.camera_id') ORDER BY order_time DESC,event_id DESC) AS rank
        FROM events WHERE run_id=?1 AND asset_id=?2 AND clock_ahead=0 AND kind='report.gimbal'
        AND camera IN (
            SELECT json_extract(j.value,'$.camera_id') FROM assets, json_each(description,'$.cameras') j
            WHERE run_id=?1 AND asset_id=?2 AND json_extract(j.value,'$.mount')='gimbal'
        )
    ) WHERE rank=1`,
}

func Assets(tx *state.Tx, id string) ([]state.Record, error) {
	query := `SELECT asset_id,gateway_id,description,contact FROM assets WHERE run_id=? AND removed=0`
	args := []any{tx.ID}
	if id != "" {
		query += " AND asset_id=?"
		args = append(args, id)
	}
	rows, err := tx.Query(query+" ORDER BY asset_id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []state.Record{}
	for rows.Next() {
		var asset, contact string
		var gateway, description *string
		if err = rows.Scan(&asset, &gateway, &description, &contact); err != nil {
			return nil, err
		}
		entry := state.Record{"asset_id": asset, "gateway_id": gateway, "contact": json.RawMessage(contact), "description": nil}
		if description != nil {
			entry["description"] = json.RawMessage(*description)
		}
		for key, query := range assetReports {
			values, err := keyedRecords(tx.Tx, query, tx.ID, asset)
			if err != nil {
				return nil, err
			}
			entry[key] = values
		}
		items = append(items, entry)
	}
	return items, rows.Err()
}

func keyedRecords(tx *sql.Tx, query string, args ...any) (map[string]json.RawMessage, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var key, raw string
		if err = rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		out[key] = json.RawMessage(raw)
	}
	return out, rows.Err()
}

func Observations(tx *state.Tx) ([]json.RawMessage, error) {
	return state.Records(tx.Tx, observationsSQL, tx.ID)
}

func Tracks(tx *state.Tx) ([]json.RawMessage, error) {
	return state.Records(tx.Tx, "SELECT record FROM tracks WHERE run_id=? ORDER BY track_id", tx.ID)
}

func Places(tx *state.Tx) ([]json.RawMessage, error) {
	return state.Records(tx.Tx, "SELECT record FROM geofeatures WHERE run_id=? ORDER BY geofeature_id", tx.ID)
}

func Track(tx *state.Tx, id string) (json.RawMessage, error) {
	var raw string
	err := tx.QueryRow("SELECT record FROM tracks WHERE run_id=? AND track_id=?", tx.ID, id).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, state.Missing("No such Track")
	}
	return json.RawMessage(raw), err
}

func Picture(tx *state.Tx) (state.Record, error) {
	assets, err := Assets(tx, "")
	if err != nil {
		return nil, err
	}
	observations, err := Observations(tx)
	if err != nil {
		return nil, err
	}
	tracks, err := Tracks(tx)
	if err != nil {
		return nil, err
	}
	places, err := Places(tx)
	if err != nil {
		return nil, err
	}
	return state.Record{"assets": assets, "tracks": tracks, "geofeatures": places, "observations": observations}, nil
}

func RequireAsset(tx *state.Tx, id string) error {
	var exists bool
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM assets WHERE run_id=? AND asset_id=? AND removed=0)", tx.ID, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return state.Missing("No such Asset")
	}
	return nil
}
