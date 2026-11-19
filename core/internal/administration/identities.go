package administration

import (
	"database/sql"
	"encoding/base64"

	"github.com/atlas-field-systems/atlas/core/internal/state"
	"github.com/atlas-field-systems/atlas/core/internal/store"
)

// Identity describes the fixed route and schema of each provisioned credential.
type Identity struct {
	Path, Column, Kind string
	table              string
}

var Identities = [...]Identity{
	{"asset-keys", "key_id", "asset", "asset_keys"},
	{"gateways", "gateway_id", "gateway", "gateways"},
	{"plugins", "plugin_id", "plugin", "plugins"},
}

type Issue struct{ Shown, Acknowledgment state.Record }

func (i Identity) Provision(tx *state.Tx, by string) (Issue, error) {
	id, err := NextGlobalID(tx.Tx)
	if err != nil {
		return Issue{}, err
	}
	key, err := RandomToken(16, base64.RawURLEncoding)
	if err != nil {
		return Issue{}, err
	}
	columns, values := i.Column+",key_hash", "?,?"
	args := []any{id, Digest(key)}
	if i.Kind != "asset" {
		columns += ",contact_run_id"
		values += ",?"
		args = append(args, tx.ID)
	}
	if _, err = tx.Exec("INSERT INTO "+i.table+"("+columns+") VALUES ("+values+")", args...); err != nil {
		return Issue{}, err
	}
	issued := Issue{state.Record{i.Column: id, "key": key}, state.Record{i.Column: id, "issued": true}}
	if i.Kind != "asset" {
		event, err := tx.Append(i.Kind+".provisioned", state.Record{"time": tx.Now, i.Column: id, "requested_by": by})
		if err != nil {
			return Issue{}, err
		}
		issued.Shown["event_id"], issued.Acknowledgment["event_id"] = event, event
	}
	return issued, nil
}

func requireRow(result sql.Result, err error, missing string) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return state.Missing(missing)
	}
	return err
}

func (i Identity) Replace(tx *state.Tx, id string) (Issue, error) {
	key, err := RandomToken(16, base64.RawURLEncoding)
	if err != nil {
		return Issue{}, err
	}
	q := "UPDATE " + i.table + " SET key_hash=? WHERE " + i.Column + "=?"
	if i.Kind != "asset" {
		q += " AND removed=0"
	}
	result, err := tx.Exec(q, Digest(key), id)
	return Issue{state.Record{i.Column: id, "key": key}, state.Record{i.Column: id, "replaced": true}}, requireRow(result, err, "No such identity")
}

func (i Identity) Remove(tx *state.Tx, id, by string) (state.Record, error) {
	if i.Kind == "asset" {
		result, err := tx.Exec("DELETE FROM asset_keys WHERE key_id=?", id)
		return state.Record{}, requireRow(result, err, "No such identity")
	}
	var at int64
	if err := tx.QueryRow("SELECT coalesce((SELECT time FROM identity_heard WHERE run_id=? AND kind=? AND id=?),?)", tx.ID, i.Kind, id, tx.Now).Scan(&at); err != nil {
		return nil, err
	}
	contact := state.Record{"time": at, i.Column: id, "contact": "offline"}
	result, err := tx.Exec("UPDATE "+i.table+" SET removed=1,key_hash=NULL,contact_run_id=?,contact=? WHERE "+i.Column+"=? AND removed=0", tx.ID, state.JSON(contact), id)
	if err = requireRow(result, err, "No such identity"); err != nil {
		return nil, err
	}
	event, err := tx.Append(i.Kind+".removed", state.Record{"time": tx.Now, i.Column: id, "requested_by": by})
	return state.Record{"event_id": event}, err
}

func NextGlobalID(tx *sql.Tx) (string, error) {
	for {
		var n int64
		err := tx.QueryRow("INSERT INTO asset_ids VALUES (1,1) ON CONFLICT(only) DO UPDATE SET last_seq=last_seq+1 RETURNING last_seq").Scan(&n)
		if err != nil {
			return "", err
		}
		id, err := store.ShortID(n)
		if err != nil {
			return "", state.Refusal{Status: 409, Code: "asset_ids_exhausted", Reason: "All short IDs have been assigned"}
		}
		var exists bool
		if err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM accounts WHERE operator_id=?)", id).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return id, nil
		}
	}
}
