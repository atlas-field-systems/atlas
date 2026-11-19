package entities

import (
	"database/sql"
	"errors"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func AssetForKey(tx *state.Tx, key string) (string, error) {
	var id string
	err := tx.QueryRow("SELECT asset_id FROM assets WHERE run_id=? AND key_id=? AND removed=0", tx.ID, key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func CarriedBy(tx *state.Tx, gateway string) ([]string, error) {
	return state.Column[string](tx.Tx, "SELECT asset_id FROM assets WHERE run_id=? AND gateway_id=? AND removed=0 ORDER BY asset_id", tx.ID, gateway)
}

func GatewayCarries(tx *state.Tx, gateway, id string) (bool, error) {
	var found bool
	err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM assets WHERE run_id=? AND gateway_id=? AND asset_id=? AND removed=0)", tx.ID, gateway, id).Scan(&found)
	return found, err
}

func Register(tx *state.Tx, id, owner string, radio bool) error {
	reg := state.Record{"asset_id": id, "time": tx.Now}
	contact := state.Record{"asset_id": id, "time": tx.Now, "contact": "online"}
	column := "key_id"
	if radio {
		reg["requested_by"] = owner
		contact["contact"] = "offline"
		column = "gateway_id"
	}
	_, err := tx.Exec("INSERT INTO assets(run_id,asset_id,"+column+",contact) VALUES (?,?,?,?)", tx.ID, id, owner, state.JSON(contact))
	if err != nil {
		return err
	}
	if _, err = tx.Append("asset.registered", reg); err != nil {
		return err
	}
	_, err = tx.Append("asset.contact", contact)
	return err
}

func HasDescription(tx *state.Tx, id string) (bool, error) {
	var yes bool
	err := tx.QueryRow("SELECT description IS NOT NULL FROM assets WHERE run_id=? AND asset_id=? AND removed=0", tx.ID, id).Scan(&yes)
	if errors.Is(err, sql.ErrNoRows) {
		return false, state.Missing("No such Asset")
	}
	return yes, err
}

func Describe(tx *state.Tx, id string, description state.Record) (int64, error) {
	if _, err := tx.Exec("UPDATE assets SET description=? WHERE run_id=? AND asset_id=?", state.JSON(description), tx.ID, id); err != nil {
		return 0, err
	}
	return tx.Append("asset.described", description)
}

func Remove(tx *state.Tx, id string) error {
	result, err := tx.Exec("UPDATE assets SET removed=1 WHERE run_id=? AND asset_id=? AND removed=0", tx.ID, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return state.Missing("No such Asset")
	}
	return err
}

func NoteHeard(tx *state.Tx, id string) error {
	_, err := tx.Exec(`INSERT INTO asset_heard VALUES (?,?,?)
		ON CONFLICT(run_id,asset_id) DO UPDATE SET last_heard=excluded.last_heard`, tx.ID, id, tx.Now)
	return err
}

func LastHeard(tx *state.Tx, id string, fallback any) (int64, error) {
	var at int64
	err := tx.QueryRow("SELECT coalesce((SELECT last_heard FROM asset_heard WHERE run_id=? AND asset_id=?),?)", tx.ID, id, fallback).Scan(&at)
	return at, err
}

func SetContact(tx *state.Tx, id string, record state.Record) (bool, error) {
	var prior string
	err := tx.QueryRow("SELECT json_extract(contact,'$.contact') FROM assets WHERE run_id=? AND asset_id=? AND removed=0", tx.ID, id).Scan(&prior)
	if errors.Is(err, sql.ErrNoRows) {
		return false, state.Missing("No such Asset")
	}
	if err != nil {
		return false, err
	}
	if record["contact"] == "online" {
		if err = NoteHeard(tx, id); err != nil {
			return false, err
		}
	}
	if record["contact"] == prior {
		return false, nil
	}
	if _, err = tx.Exec("UPDATE assets SET contact=? WHERE run_id=? AND asset_id=?", state.JSON(record), tx.ID, id); err != nil {
		return false, err
	}
	_, err = tx.Append("asset.contact", record)
	return true, err
}

func Assigned(tx *state.Tx, id string) (bool, error) {
	var taken bool
	err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM assets WHERE asset_id=? AND run_id=?)", id, tx.ID).Scan(&taken)
	return taken, err
}

func OnlineIP(tx *state.Tx) ([]state.ContactArrival, error) {
	return state.ContactArrivals(tx, `SELECT 'asset', a.asset_id, h.last_heard
        FROM assets a LEFT JOIN asset_heard h USING(run_id,asset_id)
        WHERE a.run_id=? AND a.removed=0 AND a.gateway_id IS NULL
        AND json_extract(a.contact,'$.contact')='online'`)
}
