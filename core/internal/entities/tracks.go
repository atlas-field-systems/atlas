// Package entities owns the shared picture and its SQLite tables.
package entities

import (
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func TracksWithSource(tx *state.Tx, asset, observation string) ([]state.Record, error) {
	rows, err := tx.Query(`SELECT record FROM tracks WHERE run_id=?
		AND EXISTS (SELECT 1 FROM json_each(record,'$.sources') source
		            WHERE json_extract(source.value,'$.asset_id')=?
		              AND json_extract(source.value,'$.observation_id')=?)
		ORDER BY track_id`, tx.ID, asset, observation)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tracks []state.Record
	for rows.Next() {
		var raw string
		var track state.Record
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &track); err != nil {
			return nil, err
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

func PutTrack(tx *state.Tx, track state.Record) error {
	id, existing := track["track_id"].(string)
	if existing {
		var old state.Record
		var raw string
		err := tx.QueryRow("SELECT record FROM tracks WHERE run_id=? AND track_id=?", tx.ID, id).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil {
			if err = json.Unmarshal([]byte(raw), &old); err != nil {
				return err
			}
			if reflect.DeepEqual(old, track) {
				return nil
			}
		}
	} else {
		var err error
		id, err = tx.NextID("track")
		if err != nil {
			return err
		}
		track["track_id"] = id
	}
	raw, err := json.Marshal(track)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO tracks VALUES (?,?,?) ON CONFLICT(run_id,track_id) DO UPDATE SET record=excluded.record`, tx.ID, id, string(raw)); err != nil {
		return err
	}
	_, err = tx.Append("track.updated", track)
	return err
}

func RemoveTrack(tx *state.Tx, id string) error {
	var raw string
	if err := tx.QueryRow("DELETE FROM tracks WHERE run_id=? AND track_id=? RETURNING record", tx.ID, id).Scan(&raw); err != nil {
		return err
	}
	var old state.Record
	if err := json.Unmarshal([]byte(raw), &old); err != nil {
		return err
	}
	_, err := tx.Append("track.removed", old)
	return err
}
