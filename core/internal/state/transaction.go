// Package state is the transaction shared by Core's pillars. It holds the run,
// receive time and validated event log for one atomic change.
package state

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/config"
	"github.com/atlas-field-systems/atlas/core/internal/diagnostics"
	"github.com/atlas-field-systems/atlas/core/internal/protocol"
	"github.com/atlas-field-systems/atlas/core/internal/store"
)

type Run struct {
	Config config.Config
	store.Run
	Store    *store.Store
	Clock    clock.Source
	Protocol *protocol.Client
	Log      *diagnostics.Log
}

type Tx struct {
	*sql.Tx
	*Run
	Now      int64
	evidence []diagnostic
}

type diagnostic struct {
	level, area, msg string
	fields           map[string]any
}

func (r *Run) Do(ctx context.Context, work func(*Tx) error) error {
	var t Tx
	err := r.Store.Write(ctx, func(tx *sql.Tx) error {
		t = Tx{Tx: tx, Run: r, Now: r.Clock.Now().UnixMilli()}
		return work(&t)
	})
	if err == nil {
		for _, d := range t.evidence {
			r.Log.Record(d.level, d.area, d.msg, d.fields)
		}
	}
	return err
}

// Record a decision only if the change commits.
func (t *Tx) Record(level, area, msg string, fields map[string]any) {
	t.evidence = append(t.evidence, diagnostic{level, area, msg, fields})
}

// NextID advances the run's persistent sequence. Deleting a record never frees its ID.
func (t *Tx) NextID(kind string) (string, error) {
	switch kind {
	case "track", "geofeature", "object":
	default:
		return "", fmt.Errorf("unknown ID sequence %q", kind)
	}
	column := "last_" + kind + "_seq"
	var n int64
	err := t.QueryRow("UPDATE runs SET "+column+"="+column+"+1 WHERE run_id=? RETURNING "+column, t.ID).Scan(&n)
	if err != nil {
		return "", err
	}
	return store.ShortID(n)
}
