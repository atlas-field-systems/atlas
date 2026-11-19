package reset

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/config"
	"github.com/atlas-field-systems/atlas/core/internal/diagnostics"
	"github.com/atlas-field-systems/atlas/core/internal/protocol"
	"github.com/atlas-field-systems/atlas/core/internal/store"
)

var scoped = []string{"events", "identity_heard", "asset_key_mismatches", "sessions", "asset_heard", "assets", "tracks", "geofeatures", "tasks", "queues", "objects", "fusion_cursor", "idempotency_keys"}

type Exporter struct {
	Clock    clock.Source
	Config   config.Config
	Store    *store.Store
	Versions protocol.Versions
}

func (e Exporter) archivePath(run store.Run) string {
	name := fmt.Sprintf("core-run-%d-%s.zip", run.ID, time.UnixMilli(run.StartedAt).UTC().Format("20060102T150405Z"))
	return filepath.Join(e.Config.ArchiveDirectory, name)
}

func (e Exporter) clear(tx *sql.Tx, id int64, name string) error {
	for _, table := range scoped {
		if _, err := tx.Exec("DELETE FROM "+table+" WHERE run_id=?", id); err != nil {
			return err
		}
	}
	for _, table := range []string{"gateways", "plugins"} {
		if _, err := tx.Exec("DELETE FROM "+table+" WHERE removed=1 AND contact_run_id=?", id); err != nil {
			return err
		}
	}
	_, err := tx.Exec("UPDATE runs SET ended_at=?,outcome='archived',zip_name=? WHERE run_id=?", e.Clock.Now().UnixMilli(), name, id)
	return err
}

func (e Exporter) clearFiles(id int64) error {
	name := fmt.Sprintf("run-%d", id)
	ledger := filepath.Join(e.Config.DataDirectory, "diagnostic-gaps", name+".json")
	for _, path := range []string{
		filepath.Join(e.Config.DataDirectory, "objects", name),
		filepath.Join(e.Config.LogDirectory, name),
		ledger, ledger + ".partial",
	} {
		if err := os.RemoveAll(path); err != nil {
			return err
		}
	}
	return nil
}

func (e Exporter) Recover(ctx context.Context) error {
	var recovered int64
	err := e.Store.Write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query("SELECT run_id FROM runs WHERE outcome='archived'")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err = rows.Scan(&id); err != nil {
				return err
			}
			if err = e.clearFiles(id); err != nil {
				return err
			}
		}
		if err = rows.Err(); err != nil {
			return err
		}
		var run store.Run
		err = tx.QueryRow("SELECT run_id,started_at FROM runs WHERE ended_at IS NULL").Scan(&run.ID, &run.StartedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		final := e.archivePath(run)
		if err = os.Remove(final + ".partial"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if _, err = os.Stat(final); errors.Is(err, os.ErrNotExist) {
			return nil
		} else if err != nil {
			return err
		}
		if err = Verify(final, run.ID); err != nil {
			fmt.Fprintf(os.Stderr, "Reset ZIP check failed; resuming run %d: %v\n", run.ID, err)
			return nil
		}
		recovered = run.ID
		return e.clear(tx, run.ID, filepath.Base(final))
	})
	if err == nil && recovered != 0 {
		return e.clearFiles(recovered)
	}
	return err
}

func (e Exporter) Stop(ctx context.Context, run store.Run, gaps []diagnostics.Gap) (string, error) {
	final := e.archivePath(run)
	partial := final + ".partial"
	var published bool
	err := e.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := os.Lstat(final); err == nil {
			return errors.New("refusing to overwrite final Reset ZIP")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		a, err := Create(partial)
		if err != nil {
			return err
		}
		defer func() {
			if !published {
				_ = a.Abort()
			}
		}()
		if err = e.export(tx, a, run, gaps); err != nil {
			return err
		}
		if err = Verify(partial, run.ID); err != nil {
			return err
		}
		// Link publishes atomically and refuses a pre-existing final filename.
		if err = os.Link(partial, final); err != nil {
			return err
		}
		published = true
		if err = os.Remove(partial); err != nil {
			return err
		}
		dir, err := os.Open(e.Config.ArchiveDirectory)
		if err != nil {
			return err
		}
		err = errors.Join(dir.Sync(), dir.Close())
		if err != nil {
			return err
		}
		return e.clear(tx, run.ID, filepath.Base(final))
	})
	if err != nil {
		if !published {
			markErr := e.Store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec("UPDATE runs SET ended_at=?,outcome='archive_failed' WHERE run_id=?", e.Clock.Now().UnixMilli(), run.ID)
				return err
			})
			err = errors.Join(err, markErr)
		}
		return "", err
	}
	return final, e.clearFiles(run.ID)
}

func (e Exporter) export(tx *sql.Tx, a *Archive, run store.Run, gaps []diagnostics.Gap) error {
	manifest := Manifest{RunID: run.ID, StartedAt: run.StartedAt, EndedAt: e.Clock.Now().UnixMilli(), Resumes: []json.RawMessage{}, Gaps: []json.RawMessage{}}
	var resumes string
	if err := tx.QueryRow("SELECT resumes FROM runs WHERE run_id=?", run.ID).Scan(&resumes); err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(resumes), &manifest.Resumes); err != nil {
		return err
	}
	for _, r := range manifest.Resumes {
		var gap map[string]any
		if err := json.Unmarshal(r, &gap); err != nil {
			return err
		}
		gap["why"] = "unexpected stop"
		b, err := json.Marshal(gap)
		if err != nil {
			return err
		}
		manifest.Gaps = append(manifest.Gaps, b)
	}
	name := fmt.Sprintf("run-%d", run.ID)
	for _, gap := range gaps {
		b, err := json.Marshal(gap)
		if err != nil {
			return err
		}
		manifest.Gaps = append(manifest.Gaps, b)
	}
	var err error
	if _, err = a.Add("README.md", strings.NewReader("# Core Reset archive\n\nsummary.md describes the run. events.jsonl contains ordered events. state/ holds current table rows, objects/ holds Object files and diagnostics/ holds Core logs. manifest.json lists file digests, resumes and gaps.\n")); err != nil {
		return err
	}
	if _, err = a.write("summary.md", func(w io.Writer) error { return summary(tx, w, manifest) }); err != nil {
		return err
	}
	if _, err = a.write("events.jsonl", func(w io.Writer) error {
		return eachRow(tx, "SELECT event_id,time,kind,record,requested_by,clock_ahead FROM events WHERE run_id=? ORDER BY event_id", run.ID, func(row map[string]any) error {
			row["record"] = json.RawMessage(row["record"].(string))
			if row["requested_by"] == nil {
				delete(row, "requested_by")
			}
			if row["clock_ahead"] == int64(0) {
				delete(row, "clock_ahead")
			} else {
				row["clock_ahead"] = true
			}
			return json.NewEncoder(w).Encode(row)
		})
	}); err != nil {
		return err
	}
	for _, table := range append(append([]string{}, scoped...), "gateways", "plugins") {
		if table == "events" {
			continue
		}
		column := "run_id"
		if table == "gateways" || table == "plugins" {
			column = "contact_run_id"
		}
		_, err = a.write("state/"+table+".jsonl", func(w io.Writer) error {
			return eachRow(tx, "SELECT * FROM "+table+" WHERE "+column+"=? ORDER BY rowid", run.ID, func(row map[string]any) error {
				for k := range row {
					if diagnostics.SecretField(k) {
						row[k] = "[redacted]"
					}
				}
				return json.NewEncoder(w).Encode(row)
			})
		})
		if err != nil {
			return err
		}
	}
	err = eachRow(tx, "SELECT object_id,file,sha256,json_extract(record,'$.size_bytes') size FROM objects WHERE run_id=? ORDER BY object_id", run.ID, func(row map[string]any) error {
		file := row["file"].(string)
		if filepath.Base(file) != file {
			return errors.New("invalid Object file")
		}
		d, err := addFile(a, "objects/"+row["object_id"].(string), filepath.Join(e.Config.DataDirectory, "objects", name, file))
		if err != nil {
			return err
		}
		if d.SHA256 != row["sha256"] || d.Size != row["size"] {
			return fmt.Errorf("Object %v differs from stored evidence", row["object_id"])
		}
		return nil
	})
	if err != nil {
		return err
	}
	logs := filepath.Join(e.Config.LogDirectory, name)
	entries, err := os.ReadDir(logs)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if _, err = addFile(a, "diagnostics/"+entry.Name(), filepath.Join(logs, entry.Name())); err != nil {
			return err
		}
	}
	for name, value := range map[string]any{"config.json": e.Config.Redacted(), "versions.json": e.Versions} {
		if _, err = a.write(name, func(w io.Writer) error { return json.NewEncoder(w).Encode(value) }); err != nil {
			return err
		}
	}
	return a.Finish(manifest)
}

func addFile(a *Archive, name, path string) (Digest, error) {
	f, err := os.Open(path)
	if err != nil {
		return Digest{}, err
	}
	defer f.Close()
	return a.Add(name, f)
}

func eachRow(tx *sql.Tx, query string, id int64, visit func(map[string]any) error) error {
	rows, err := tx.Query(query, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return err
	}
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	for rows.Next() {
		if err = rows.Scan(pointers...); err != nil {
			return err
		}
		row := make(map[string]any, len(columns))
		for i, name := range columns {
			row[name] = values[i]
		}
		if err = visit(row); err != nil {
			return err
		}
	}
	return rows.Err()
}

func summary(tx *sql.Tx, w io.Writer, m Manifest) error {
	_, err := fmt.Fprintf(w, "# Run %d\n\nStarted %s. Ended %s.\n", m.RunID, time.UnixMilli(m.StartedAt).UTC().Format(time.RFC3339Nano), time.UnixMilli(m.EndedAt).UTC().Format(time.RFC3339Nano))
	if err != nil {
		return err
	}
	for _, r := range m.Resumes {
		var resume struct {
			Last int64 `json:"last_sign_of_life"`
			At   int64 `json:"resumed_at"`
		}
		if err = json.Unmarshal(r, &resume); err != nil {
			return err
		}
		if _, err = fmt.Fprintf(w, "\nUnexpected stop after %d, resumed at %d. Estimated downtime %d ms.\n", resume.Last, resume.At, resume.At-resume.Last); err != nil {
			return err
		}
	}
	for _, query := range []string{
		`SELECT printf('Asset %s, gateway %s, first heard %d, last heard %d.',a.asset_id,
            coalesce(a.gateway_id,'none'), min(e.time), coalesce(h.last_heard,max(e.time))) AS line
         FROM assets a LEFT JOIN events e ON e.run_id=a.run_id AND e.asset_id=a.asset_id
            AND (e.kind IN ('asset.registered','asset.described','asset.contact') OR e.kind LIKE 'report.%')
         LEFT JOIN asset_heard h ON a.run_id=h.run_id AND a.asset_id=h.asset_id
         WHERE a.run_id=? GROUP BY a.asset_id ORDER BY a.asset_id`,
		`SELECT printf('Asset %s Task %d: %s (%d).',t.asset_id,t.task_id,
            CASE WHEN state='dropped' THEN 'dropped' || coalesce((
                SELECT '; later reported ' || json_extract(record,'$.task_state') FROM events
                WHERE run_id=t.run_id AND asset_id=t.asset_id AND kind='report.status'
                    AND sub_kind='task' AND task_id=t.task_id AND time>=t.state_time
                    AND json_extract(record,'$.task_state') IN ('completed','failed','cancelled')
                ORDER BY event_id DESC LIMIT 1
            ),'; no reported outcome')
            WHEN state IN ('completed','failed','cancelled') THEN state
            ELSE state || '; no reported outcome' END, t.state_time) AS line
         FROM tasks t WHERE run_id=? ORDER BY asset_id,task_id`,
		`SELECT printf('Plugin call %d: %s.',e.event_id,coalesce((
            SELECT a.kind FROM events a WHERE a.run_id=e.run_id AND a.request_id=e.event_id
                AND a.plugin_id=e.plugin_id AND a.kind IN ('plugin.result','plugin.failed','plugin.dropped')
            ORDER BY a.event_id LIMIT 1
         ),'no reported outcome')) AS line
         FROM events e WHERE run_id=? AND kind='plugin.called' ORDER BY event_id`,
	} {
		if err = eachRow(tx, query, m.RunID, func(row map[string]any) error { _, err := fmt.Fprintf(w, "\n%s\n", row["line"]); return err }); err != nil {
			return err
		}
	}
	gaps, err := json.Marshal(m.Gaps)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "\nGaps: %s.\n", gaps)
	return err
}
