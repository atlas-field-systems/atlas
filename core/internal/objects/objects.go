package objects

import (
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"

	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type Deleted struct{ Record json.RawMessage }

func (e Deleted) Error() string { return "Object deleted" }
func Get(tx *state.Tx, id string) (state.Record, string, error) {
	var raw, file string
	var deletion *string
	err := tx.QueryRow("SELECT record,file,deletion FROM objects WHERE run_id=? AND object_id=?", tx.ID, id).Scan(&raw, &file, &deletion)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", state.Missing("No such Object")
	}
	if err != nil {
		return nil, "", err
	}
	if deletion != nil {
		return nil, "", Deleted{json.RawMessage(*deletion)}
	}
	var record state.Record
	err = json.Unmarshal([]byte(raw), &record)
	return record, file, err
}

func RequireGeoTIFF(tx *state.Tx, id any) error {
	var tiff bool
	err := tx.QueryRow("SELECT geotiff FROM objects WHERE run_id=? AND object_id=? AND deletion IS NULL", tx.ID, id).Scan(&tiff)
	if errors.Is(err, sql.ErrNoRows) {
		return state.Missing("No such Object")
	}
	if err != nil {
		return err
	}
	if !tiff {
		return state.Conflict("not_geotiff", "Imagery requires a GeoTIFF")
	}
	return nil
}

func Store(tx *state.Tx, u *Upload, name, place, by string, call any) (state.Record, error) {
	if err := entities.RequirePlace(tx, place); err != nil {
		return nil, err
	}
	id, err := tx.NextID("object")
	if err != nil {
		return nil, err
	}

	record := state.Record{"object_id": id, "time": tx.Now, "name": name, "size_bytes": u.size, "content_type": u.ContentType, "requested_by": by}
	if place != "" {
		record["geofeature_id"] = place
	}
	if err = tx.Protocol.Check("object", record); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("INSERT INTO objects(run_id,object_id,record,file,sha256,geotiff,creating_call) VALUES (?,?,?,?,?,?,?)", tx.ID, id, state.JSON(record), filepath.Base(u.path), u.Hash, u.geotiff, call); err != nil {
		return nil, err
	}
	event, err := tx.Append("object.stored", record)
	return state.Record{"object_id": id, "event_id": event}, err
}

func Attach(tx *state.Tx, id string, place any) (int64, error) {
	record, _, err := Get(tx, id)
	if err != nil {
		return 0, err
	}

	if record["geofeature_id"] == place {
		var event int64
		err = tx.QueryRow("SELECT max(event_id) FROM events WHERE run_id=? AND kind IN ('object.stored','object.changed') AND json_extract(record,'$.object_id')=?", tx.ID, id).Scan(&event)
		return event, err
	}
	if err = entities.RequirePlace(tx, place); err != nil {
		return 0, err
	}
	if place == nil {
		delete(record, "geofeature_id")
	} else {
		record["geofeature_id"] = place
	}
	record["time"] = tx.Now
	if _, err = tx.Exec("UPDATE objects SET record=? WHERE run_id=? AND object_id=?", state.JSON(record), tx.ID, id); err != nil {
		return 0, err
	}
	event, err := tx.Append("object.changed", record)
	return event, err
}

func Delete(tx *state.Tx, id, by string) (int64, error) {
	if _, _, err := Get(tx, id); err != nil {
		return 0, err
	}
	shown, err := entities.ImageryShows(tx, id)
	if err != nil {
		return 0, err
	}
	if shown {
		return 0, state.Conflict("object_shown", "Imagery still shows this Object")
	}
	record := state.Record{"object_id": id, "requested_by": by, "time": tx.Now}
	if _, err := tx.Exec("UPDATE objects SET deletion=? WHERE run_id=? AND object_id=?", state.JSON(record), tx.ID, id); err != nil {
		return 0, err
	}
	event, err := tx.Append("object.deleted", record)
	return event, err
}

func List(tx *state.Tx, place *string) ([]json.RawMessage, error) {
	query := "SELECT record FROM objects WHERE run_id=? AND deletion IS NULL"
	args := []any{tx.ID}
	if place != nil {
		query += " AND geofeature_id=?"
		args = append(args, *place)
	}
	return state.Records(tx.Tx, query+" ORDER BY object_id", args...)
}

func CreatedFor(tx *state.Tx, id any, call int64) (bool, error) {
	var exists bool
	err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM objects WHERE run_id=? AND object_id=? AND creating_call=? AND deletion IS NULL)", tx.ID, id, call).Scan(&exists)
	return exists, err
}
