// Package fusion follows Observations in event order. A replacement module
// sees matching Tracks and proposes changes; Entities owns their storage.
package fusion

import (
	"context"
	"encoding/json"

	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type Change struct {
	Put    state.Record
	Remove string
}

type Module func(observation state.Record, tracks []state.Record) ([]Change, error)

// OnePerObservation keeps the latest sighting from each Asset and Observation ID.
func OnePerObservation(o state.Record, tracks []state.Record) ([]Change, error) {
	track := state.Record{"time": o["time"], "sources": []any{state.Record{"asset_id": o["asset_id"], "observation_id": o["observation_id"]}}}
	if len(tracks) > 0 {
		old := tracks[0]
		if old["time"].(float64) > o["time"].(float64) {
			return nil, nil
		}
		track["track_id"] = old["track_id"]
	}
	for _, key := range []string{"entity_type", "details", "position", "uncertainty"} {
		if (key == "position" || key == "uncertainty") && o["kind"] != "coordinates" {
			continue
		}
		if value, ok := o[key]; ok {
			track[key] = value
		}
	}
	return []Change{{Put: track}}, nil
}

// Drain commits derived Tracks and their source-event checkpoint together.
func Drain(ctx context.Context, run *state.Run, observe Module) error {
	const pageSize = 100
	for {
		count := 0
		err := run.Do(ctx, func(tx *state.Tx) error {
			batch, err := state.Events(tx.Tx, ` AND kind='report.observation' AND clock_ahead=0
				AND event_id>coalesce((SELECT after_event_id FROM fusion_cursor WHERE run_id=e.run_id),0)
				ORDER BY event_id LIMIT ?`, tx.ID, pageSize)
			if err != nil {
				return err
			}
			count = len(batch)
			for _, event := range batch {
				var o state.Record
				if err := json.Unmarshal(event.Record, &o); err != nil {
					return err
				}
				tracks, err := entities.TracksWithSource(tx, o["asset_id"].(string), o["observation_id"].(string))
				if err != nil {
					return err
				}
				changes, err := observe(o, tracks)
				if err != nil {
					tx.Record("error", "fusion", "Observation skipped", map[string]any{"event_id": event.ID, "error": err.Error()})
					continue
				}
				for _, c := range changes {
					if c.Put != nil {
						err = entities.PutTrack(tx, c.Put)
					} else {
						err = entities.RemoveTrack(tx, c.Remove)
					}
					if err != nil {
						return err
					}
				}
			}
			if count > 0 {
				_, err = tx.Exec(`INSERT INTO fusion_cursor VALUES (?,?)
					ON CONFLICT(run_id) DO UPDATE SET after_event_id=excluded.after_event_id`, tx.ID, batch[count-1].ID)
			}
			return err
		})
		if err != nil || count < pageSize {
			return err
		}
	}
}
