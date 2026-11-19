// Package tasks owns Task admission, reported queue state, and cancellation.
package tasks

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func Request(tx *state.Tx, id, by string, body state.Record) (state.Record, error) {
	c, err := entities.RequireOnline(tx, id)
	if err != nil {
		return nil, err
	}
	tasks := body["tasks"].([]any)
	now := body["now"] == true
	if now && len(tasks) != 1 {
		return nil, state.Invalid("Run now requires exactly one Task")
	}
	for _, raw := range tasks {
		if raw.(state.Record)["kind"] == "failsafe" && !now {
			return nil, state.Invalid("Failsafe must be the only Task and use now")
		}
	}
	if c.Flying() && !c.Critical {
		return nil, state.Conflict("no_critical_battery_rule", "Report a critical battery rule before sending Tasks")
	}
	var prev, held int
	err = tx.QueryRow("SELECT coalesce((SELECT max(task_id) FROM tasks WHERE run_id=?1 AND asset_id=?2),0),coalesce((SELECT json_array_length(task_ids) FROM queues WHERE run_id=?1 AND asset_id=?2),0)", tx.ID, id).Scan(&prev, &held)
	if err != nil {
		return nil, err
	}
	for _, raw := range tasks {
		task := raw.(map[string]any)
		if task["kind"] == "settings" {
			err = c.CheckSettings(task["settings"].(map[string]any))
		} else {
			err = c.Command(task)
		}
		if err != nil {
			return nil, err
		}
	}
	if !now && held+len(tasks) > 64 {
		return nil, state.Conflict("queue_full", "Reported queue is full")
	}
	last := prev + len(tasks)
	if last > 9999 {
		return nil, state.Conflict("task_ids_exhausted", "Task IDs exhausted")
	}
	ids := make([]int, len(tasks))
	batch := make([]state.Record, len(tasks))
	for i, raw := range tasks {
		t := raw.(map[string]any)
		if err = entities.CopyPlace(tx, t); err != nil {
			return nil, err
		}
		ids[i] = prev + i + 1
		t["time"], t["asset_id"], t["task_id"], t["send_last"], t["requested_by"] = tx.Now, id, ids[i], last, by
		if now {
			t["now"] = true
		}
		batch[i] = t
	}
	event, err := tx.AppendTasks("tasks.requested", batch)
	if err != nil {
		return nil, err
	}
	for i, t := range batch {
		if _, err = tx.Exec("INSERT INTO tasks(run_id,asset_id,task_id,body,requested_by,request_event,state,state_time) VALUES (?,?,?,?,?,?,'sent',?)", tx.ID, id, ids[i], state.JSON(t), by, event, tx.Now); err != nil {
			return nil, err
		}
	}
	tx.Record("trace", "tasks", "Tasks admitted", state.Record{"asset_id": id, "event_id": event, "task_ids": ids})
	return state.Record{"task_ids": ids, "event_id": event}, nil
}

func Cancel(tx *state.Tx, id, by string, tid int) (int64, error) {
	var status string
	err := tx.QueryRow("SELECT state FROM tasks WHERE run_id=? AND asset_id=? AND task_id=?", tx.ID, id, tid).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, state.Missing("No such Task")
	}
	if err != nil {
		return 0, err
	}
	if status != "sent" && status != "queued" && status != "active" {
		return 0, state.Conflict("task_ended", "Task already ended")
	}
	return tx.Append("cancel.requested", state.Record{"asset_id": id, "task_id": tid, "time": tx.Now, "requested_by": by})
}

func List(tx *state.Tx, id string) (state.Record, error) {
	if err := entities.RequireAsset(tx, id); err != nil {
		return nil, err
	}
	var held string
	err := tx.QueryRow(`SELECT coalesce((SELECT task_ids FROM queues WHERE run_id=?1 AND asset_id=?2),'[]')`, tx.ID, id).Scan(&held)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, state.Missing("No such Asset")
	}
	if err != nil {
		return nil, err
	}
	items, err := state.Records(tx.Tx, `SELECT json_patch(
        json_object('task',json(body),'state',state,'state_time',state_time),
        CASE WHEN object_ids IS NULL THEN '{}' ELSE json_object('object_ids',json(object_ids)) END)
        FROM tasks WHERE run_id=? AND asset_id=? ORDER BY task_id`, tx.ID, id)
	if err != nil {
		return nil, err
	}
	return state.Record{"items": items, "held": json.RawMessage(held)}, nil
}

func LastID(tx *state.Tx, id string) (int, error) {
	var last int
	err := tx.QueryRow("SELECT coalesce(max(task_id),0) FROM tasks WHERE run_id=? AND asset_id=?", tx.ID, id).Scan(&last)
	return last, err
}
