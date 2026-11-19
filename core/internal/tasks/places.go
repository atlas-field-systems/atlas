package tasks

import (
	"encoding/json"

	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func UpdatePlace(tx *state.Tx, p, reply state.Record) error {
	updated, skipped := []state.Record{}, []state.Record{}
	tasks, err := state.Records(tx.Tx, "SELECT body FROM tasks WHERE run_id=? AND geofeature_id=? AND state IN ('sent','queued','active') ORDER BY asset_id,task_id", tx.ID, p["geofeature_id"])
	if err != nil {
		return err
	}
	groups := map[string][]state.Record{}
	order := []string{}
	for _, raw := range tasks {
		var t state.Record
		if err = json.Unmarshal(raw, &t); err != nil {
			return err
		}
		asset := t["asset_id"].(string)
		id := state.Record{"asset_id": asset, "task_id": t["task_id"]}
		c, err := entities.Admission(tx, asset)
		if err != nil {
			return err
		}
		if p["kind"] != "point" || !c.Online {
			skipped = append(skipped, id)
			continue
		}
		t["time"] = tx.Now
		if err = entities.CopyPlace(tx, t); err != nil {
			return err
		}
		if _, err = tx.Exec("UPDATE tasks SET body=? WHERE run_id=? AND asset_id=? AND task_id=?", state.JSON(t), tx.ID, asset, t["task_id"]); err != nil {
			return err
		}
		if len(groups[asset]) == 0 {
			order = append(order, asset)
		}
		groups[asset] = append(groups[asset], t)
		updated = append(updated, id)
	}
	for _, asset := range order {
		if _, err = tx.AppendTasks("tasks.updated", groups[asset]); err != nil {
			return err
		}
	}
	reply["updated_task_ids"], reply["not_updated_task_ids"] = updated, skipped
	return nil
}
