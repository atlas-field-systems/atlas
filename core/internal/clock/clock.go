// Package clock supplies Core's time source and cancellable deadlines.
package clock

import (
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"
)

type Source interface {
	Now() time.Time
	At(time.Time) Timer
}

type Timer struct {
	C      <-chan time.Time
	Cancel func()
}

type System struct{}

func (System) Now() time.Time { return time.Now() }
func (System) At(at time.Time) Timer {
	t := time.NewTimer(time.Until(at))
	return Timer{t.C, func() { t.Stop() }}
}

type message struct {
	Op string `json:"op"`
	ID uint64 `json:"id,omitempty"`
	At int64  `json:"at,omitempty"`
}

type Host struct {
	enc                 *json.Encoder
	mu                  sync.Mutex
	seq                 uint64
	waiting             map[uint64]chan time.Time
	stopping, grace     chan struct{}
	stopOnce, graceOnce sync.Once
}

func NewHost(pipe io.ReadWriter) *Host {
	h := &Host{enc: json.NewEncoder(pipe), waiting: map[uint64]chan time.Time{}, stopping: make(chan struct{}), grace: make(chan struct{})}
	go func() {
		dec := json.NewDecoder(pipe)
		for {
			var m message
			if dec.Decode(&m) != nil {
				// Losing the host is a crash. Leave the open run for recovery.
				os.Exit(1)
			}
			switch m.Op {
			case "stop":
				h.stopOnce.Do(func() { close(h.stopping) })
			case "grace":
				h.graceOnce.Do(func() { close(h.grace) })
			case "time", "fire":
				h.mu.Lock()
				ch := h.waiting[m.ID]
				delete(h.waiting, m.ID)
				h.mu.Unlock()
				if ch != nil {
					ch <- time.UnixMilli(m.At)
				}
			}
		}
	}()
	return h
}

func (h *Host) Stopping() <-chan struct{} { return h.stopping }
func (h *Host) Grace() <-chan struct{}    { return h.grace }
func (h *Host) request(op string, at int64) (uint64, chan time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	id := h.seq
	ch := make(chan time.Time, 1)
	h.waiting[id] = ch
	if h.enc.Encode(message{op, id, at}) != nil {
		os.Exit(1)
	}
	return id, ch
}

func (h *Host) Now() time.Time { _, ch := h.request("now", 0); return <-ch }
func (h *Host) At(at time.Time) Timer {
	id, ch := h.request("timer", at.UnixMilli())
	// Cancel also acknowledges completion of a fired timer to the host clock.
	return Timer{ch, sync.OnceFunc(func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.waiting, id)
		h.enc.Encode(message{Op: "cancel", ID: id})
	})}
}
