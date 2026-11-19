package tasks

import "github.com/atlas-field-systems/atlas/core/internal/state"

func Drop(tx *state.Tx, id string, restart bool) error {
	if err := tx.DropRequests("asset", id); err != nil {
		return err
	}
	states := "'sent'"
	if restart {
		states = "'sent','queued','active'"
		if _, err := tx.Exec("DELETE FROM queues WHERE run_id=? AND asset_id=?", tx.ID, id); err != nil {
			return err
		}
	}
	ids, err := state.Column[int](tx.Tx, "SELECT task_id FROM tasks WHERE run_id=? AND asset_id=? AND state IN ("+states+") ORDER BY task_id", tx.ID, id)
	if err != nil {
		return err
	}
	for _, n := range ids {
		if _, err = tx.Exec("UPDATE tasks SET state='dropped',state_time=? WHERE run_id=? AND asset_id=? AND task_id=?", tx.Now, tx.ID, id, n); err != nil {
			return err
		}
		if _, err = tx.Append("task.dropped", state.Record{"asset_id": id, "time": tx.Now, "task_id": n}); err != nil {
			return err
		}
	}
	return nil
}

func ApplyStatus(tx *state.Tx, id string, r state.Record, event int64, ahead bool) error {
	var err error
	switch r["kind"] {
	case "task":
		var objects any
		if r["task_state"] == "completed" && r["object_ids"] != nil {
			objects = state.JSON(r["object_ids"])
		}
		states := "'sent','queued','active'"
		switch r["task_state"] {
		case "queued":
			states = "'sent'"
		case "active":
			states = "'sent','queued'"
		}
		_, err = tx.Exec("UPDATE tasks SET state=?,state_time=?,object_ids=? WHERE run_id=? AND asset_id=? AND task_id=? AND state IN ("+states+")", r["task_state"], r["time"], objects, tx.ID, id, r["task_id"])
	case "queue":
		ids := state.JSON(r["task_ids"])
		_, err = tx.Exec("UPDATE tasks SET state='queued',state_time=? WHERE run_id=? AND asset_id=? AND state='sent' AND task_id IN (SELECT value FROM json_each(?))", r["time"], tx.ID, id, ids)
		if err == nil && !ahead {
			_, err = tx.Exec(`INSERT INTO queues VALUES (?,?,?,?,?) ON CONFLICT(run_id,asset_id) DO UPDATE
                SET task_ids=excluded.task_ids, report_time=excluded.report_time, event_id=excluded.event_id
                WHERE (excluded.report_time,excluded.event_id)>(queues.report_time,queues.event_id)`, tx.ID, id, ids, r["time"], event)
		}
	}
	return err
}
