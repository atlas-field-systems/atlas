package diagnostics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/config"
)

// Block the loss-accounting writer before it publishes the first ledger. Requests can still enqueue logs,
// and a debug read must flush the records accepted during the blocked write.
func TestDebugReadDuringGapWrite(t *testing.T) {
	root := t.TempDir()
	cfg := config.Config{DataDirectory: root, LogDirectory: filepath.Join(root, "log"), LogLevel: "info", LogFileLimit: 65536, LogTotalLimit: 65536}
	blocked, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	l, err := openLog(cfg, 1, clock.System{}, func(path string, data []byte) error {
		once.Do(func() { close(blocked); <-release })
		return writeLedger(path, data)
	})
	if err != nil {
		t.Fatal(err)
	}
	first := filepath.Join(l.dir, "core-0.jsonl")
	if err = os.Mkdir(first, 0700); err != nil {
		t.Fatal(err)
	}
	l.Record("info", "core", "first", nil)
	select {
	case <-blocked:
	case <-time.After(5 * time.Second):
		t.Fatal("writer did not reach the ledger")
	}
	if err = os.Remove(first); err != nil {
		t.Fatal(err)
	}
	accepted := make(chan struct{})
	go func() {
		l.Record("info", "api", "request completed", map[string]any{"route": "/about"})
		close(accepted)
	}()
	select {
	case <-accepted:
	case <-time.After(time.Second):
		t.Fatal("logging blocked the request on disk I/O")
	}
	type readResult struct {
		lines [][]byte
		err   error
	}
	reading := make(chan readResult, 1)
	go func() { lines, err := l.ReadAfter(0); reading <- readResult{lines, err} }()
	// Allow atomic publication of the gap record to complete now.
	close(release)
	result := <-reading
	l.Close()
	if result.err != nil {
		t.Fatal(result.err)
	}
	var found bool
	for _, line := range result.lines {
		var record struct{ Route string }
		if err = json.Unmarshal(line, &record); err != nil {
			t.Fatal(err)
		}
		if record.Route == "/about" {
			found = true
		}
	}
	if !found {
		t.Fatal("debug read omitted the request queued during gap persistence")
	}
	gaps, err := os.ReadFile(l.gapFile)
	if err != nil {
		t.Fatal(err)
	}
	var entries []Gap
	if err = json.Unmarshal(gaps, &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Lost != 1 || entries[0].From != 1 {
		t.Fatalf("wrong gap accounting: %s", gaps)
	}
}
