package entities

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func CopyPlace(tx *state.Tx, task state.Record) error {
	id, ok := task["geofeature_id"].(string)
	if !ok || task["kind"] != "move_to" && task["kind"] != "land" {
		return nil
	}
	var src string
	err := tx.QueryRow("SELECT record FROM geofeatures WHERE run_id=? AND geofeature_id=?", tx.ID, id).Scan(&src)
	if errors.Is(err, sql.ErrNoRows) {
		return state.Missing("No such geo feature")
	}
	if err != nil {
		return err
	}
	var place state.Record
	if err = json.Unmarshal([]byte(src), &place); err != nil {
		return err
	}
	if place["kind"] != "point" {
		return state.Conflict("not_a_point", "Place is not a point")
	}
	key := "destination"
	if task["kind"] == "land" {
		key = "landing_position"
	}
	task[key] = place["position"]
	return nil
}

func RequirePlace(tx *state.Tx, id any) error {
	if id == nil || id == "" {
		return nil
	}
	var exists bool
	err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM geofeatures WHERE run_id=? AND geofeature_id=?)", tx.ID, id).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return state.Missing("No such geo feature")
	}
	return nil
}

func ImageryShows(tx *state.Tx, id string) (bool, error) {
	var exists bool
	err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM geofeatures WHERE run_id=? AND object_id=?)", tx.ID, id).Scan(&exists)
	return exists, err
}

func Place(tx *state.Tx, id string) (state.Record, error) {
	var raw string
	err := tx.QueryRow("SELECT record FROM geofeatures WHERE run_id=? AND geofeature_id=?", tx.ID, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, state.Missing("No such geo feature")
	}
	if err != nil {
		return nil, err
	}
	var record state.Record
	err = json.Unmarshal([]byte(raw), &record)
	return record, err
}

func CreatePlace(tx *state.Tx, p state.Record, by string, call any) (int64, error) {
	id, err := tx.NextID("geofeature")
	if err != nil {
		return 0, err
	}
	p["geofeature_id"], p["time"] = id, tx.Now
	_, err = tx.Exec("INSERT INTO geofeatures(run_id,geofeature_id,record,requested_by,creating_call) VALUES (?,?,?,?,?)", tx.ID, id, state.JSON(p), by, call)
	if err != nil {
		return 0, err
	}
	return tx.AppendPlace("geofeature.created", by, p)
}

func ReplacePlace(tx *state.Tx, id, by string, p state.Record) (int64, error) {
	old, err := Place(tx, id)
	if err != nil {
		return 0, err
	}
	if (old["kind"] == "imagery" || p["kind"] == "imagery") && (old["kind"] != p["kind"] || old["object_id"] != p["object_id"]) {
		return 0, state.Conflict("imagery_fixed", "Imagery may change only its name")
	}
	p["geofeature_id"], p["time"] = id, tx.Now
	if _, err = tx.Exec("UPDATE geofeatures SET record=? WHERE run_id=? AND geofeature_id=?", state.JSON(p), tx.ID, id); err != nil {
		return 0, err
	}
	return tx.AppendPlace("geofeature.replaced", by, p)
}

func DeletePlace(tx *state.Tx, id, by string) (int64, error) {
	old, err := Place(tx, id)
	if err != nil {
		return 0, err
	}
	if _, err = tx.Exec("DELETE FROM geofeatures WHERE run_id=? AND geofeature_id=?", tx.ID, id); err != nil {
		return 0, err
	}
	return tx.AppendPlace("geofeature.deleted", by, old)
}

func PlaceCreatedFor(tx *state.Tx, id any, call int64) (bool, error) {
	var exists bool
	err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM geofeatures WHERE run_id=? AND geofeature_id=? AND creating_call=?)", tx.ID, id, call).Scan(&exists)
	return exists, err
}
