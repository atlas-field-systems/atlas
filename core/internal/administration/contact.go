// Package administration owns provisioned identities, credentials and their contact.
package administration

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func GatewayOnline(tx *state.Tx, id string) (bool, error) {
	var online bool
	err := tx.QueryRow(`SELECT coalesce(contact_run_id=? AND json_extract(contact,'$.contact')='online',0)
		 FROM gateways WHERE gateway_id=? AND removed=0`, tx.ID, id).Scan(&online)
	if errors.Is(err, sql.ErrNoRows) {
		return false, state.Missing("No such gateway")
	}
	return online, err
}

func ListPlugins(tx *state.Tx) ([]state.Record, error) {
	items, err := state.Records(tx.Tx, `SELECT json_object(
        'plugin_id',plugin_id,'description',json(description),
        'contact',json(CASE WHEN contact_run_id=? AND contact IS NOT NULL THEN contact
            ELSE json_object('time',?,'plugin_id',plugin_id,'contact','offline') END))
        FROM plugins WHERE removed=0 ORDER BY plugin_id`, tx.ID, tx.Now)
	if err != nil {
		return nil, err
	}
	list := []state.Record{}
	for _, raw := range items {
		var p state.Record
		if err = json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		open, err := state.Events(tx.Tx, " AND e.kind='plugin.called' AND e.plugin_id=? AND NOT EXISTS(SELECT 1 FROM events a WHERE "+state.SettlementMatch+") ORDER BY e.event_id", tx.ID, p["plugin_id"])
		if err != nil {
			return nil, err
		}
		p["unanswered"] = open
		list = append(list, p)
	}
	return list, nil
}

func GatewayContacts(tx *state.Tx) ([]json.RawMessage, error) {
	return state.Records(tx.Tx, `SELECT CASE WHEN contact_run_id=? AND contact IS NOT NULL THEN contact
		ELSE json_object('time',?,'gateway_id',gateway_id,'contact','offline') END
		FROM gateways WHERE removed=0`, tx.ID, tx.Now)
}

func SetContact(tx *state.Tx, kind, id string, record state.Record) (bool, error) {
	if kind != "gateway" && kind != "plugin" {
		return false, errors.New("unknown contact identity")
	}
	table, column := kind+"s", kind+"_id"
	var prior string
	err := tx.QueryRow("SELECT coalesce(CASE WHEN contact_run_id=? THEN json_extract(contact,'$.contact') END,'offline') FROM "+table+" WHERE "+column+"=? AND removed=0", tx.ID, id).Scan(&prior)
	if errors.Is(err, sql.ErrNoRows) {
		return false, state.Missing("No such identity")
	}
	if err != nil {
		return false, err
	}
	if record["contact"] == "online" {
		if _, err = tx.Exec(`INSERT INTO identity_heard VALUES(?,?,?,?) ON CONFLICT(run_id,kind,id) DO UPDATE SET time=excluded.time`, tx.ID, kind, id, tx.Now); err != nil {
			return false, err
		}
	}
	if record["contact"] == prior {
		return false, nil
	}
	if _, err = tx.Exec("UPDATE "+table+" SET contact=?,contact_run_id=? WHERE "+column+"=?", state.JSON(record), tx.ID, id); err != nil {
		return false, err
	}
	_, err = tx.Append(kind+".contact", record)
	return true, err
}

func Online(tx *state.Tx) ([]state.ContactArrival, error) {
	return state.ContactArrivals(tx, `SELECT 'plugin', p.plugin_id, h.time FROM plugins p
        LEFT JOIN identity_heard h ON h.id=p.plugin_id AND h.kind='plugin' AND h.run_id=?1
        WHERE p.contact_run_id=?1 AND p.removed=0 AND json_extract(p.contact,'$.contact')='online'
        UNION ALL SELECT 'gateway',g.gateway_id,h.time FROM gateways g
        LEFT JOIN identity_heard h ON h.id=g.gateway_id AND h.kind='gateway' AND h.run_id=?1
        WHERE g.contact_run_id=?1 AND g.removed=0 AND json_extract(g.contact,'$.contact')='online'`)
}

func DescribePlugin(tx *state.Tx, id string, record state.Record) (int64, error) {
	if _, err := tx.Exec("UPDATE plugins SET description=? WHERE plugin_id=?", state.JSON(record), id); err != nil {
		return 0, err
	}
	return tx.Append("plugin.described", record)
}

func PluginDescription(tx *state.Tx, id string) (*string, error) {
	var online bool
	var description *string
	err := tx.QueryRow(`SELECT coalesce(contact_run_id=? AND json_extract(contact,'$.contact')='online',0),description
        FROM plugins WHERE plugin_id=? AND removed=0`, tx.ID, id).Scan(&online, &description)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, state.Missing("No such Plugin")
	}
	if err != nil {
		return nil, err
	}
	if !online {
		return nil, state.Conflict("plugin_offline", "Plugin is offline")
	}
	return description, nil
}

func PluginKnown(tx *state.Tx, id string) (bool, error) {
	var known bool
	err := tx.QueryRow(`SELECT EXISTS(
        SELECT 1 FROM plugins WHERE plugin_id=?1 AND removed=0
        UNION ALL SELECT 1 FROM events WHERE run_id=?2 AND plugin_id=?1 AND kind='plugin.removed')`, id, tx.ID).Scan(&known)
	return known, err
}
