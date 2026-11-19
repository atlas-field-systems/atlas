package api

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/fusion"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

// Follow resumes Fusion at its committed cursor and restarts contact deadlines.
// A resumed deadline never advances the persisted last-heard evidence.
func (s *Server) Follow(ctx context.Context, ready chan<- error) {
	s.resumedAt = s.Clock.Now().UnixMilli()
	var fired clock.Timer
	defer func() {
		if fired.Cancel != nil {
			fired.Cancel()
		}
	}()
	for ctx.Err() == nil {
		wake := s.Store.Changed()
		err := fusion.Drain(ctx, s.Run, s.Fusion)
		var next time.Time
		if err == nil {
			next, err = s.expireContacts(ctx)
		}
		if err != nil && ctx.Err() == nil {
			if ready != nil {
				ready <- err
				return
			}
			fmt.Fprintln(os.Stderr, "Core follower:", err)
			next = s.Clock.Now().Add(time.Second)
		}
		timer := clock.Timer{Cancel: func() {}}
		if !next.IsZero() {
			timer = s.Clock.At(next)
		}
		if ready != nil {
			ready <- nil
			ready = nil
		}
		if fired.Cancel != nil {
			fired.Cancel()
			fired = clock.Timer{}
		}
		select {
		case <-ctx.Done():
			timer.Cancel()
			return
		case <-wake:
			timer.Cancel()
		case <-timer.C:
			fired = timer
		}
	}
}

func (s *Server) expireContacts(ctx context.Context) (time.Time, error) {
	timeout := max(int64(1), int64(s.Config.OfflineAfter*1000))
	var next time.Time
	err := s.Do(ctx, func(tx *state.Tx) error {
		assets, err := entities.OnlineIP(tx)
		if err != nil {
			return err
		}
		identities, err := administration.Online(tx)
		if err != nil {
			return err
		}
		for _, arrival := range append(assets, identities...) {
			kind, id, at := arrival.Kind, arrival.ID, arrival.LastHeard
			heard := s.resumedAt
			if at != nil {
				heard = *at
			}
			deadline := max(s.resumedAt, heard) + timeout
			remaining := deadline - tx.Now
			if remaining > 0 {
				if next.IsZero() || deadline < next.UnixMilli() {
					next = time.UnixMilli(deadline)
				}
				continue
			}
			_, err = s.contact(&request{Tx: tx}, kind, id, object{"time": heard, kind + "_id": id, "contact": "offline"})
			if err != nil {
				return err
			}
		}
		return nil
	})
	return next, err
}
