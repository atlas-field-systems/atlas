// Package diagnostics owns Core's rotating per-run log and loss accounting.
package diagnostics

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/config"
)

type Gap struct {
	Lost int64  `json:"lost"`
	From int64  `json:"from_n"`
	To   int64  `json:"to_n"`
	At   int64  `json:"at"`
	Why  string `json:"why"`
}

type line struct {
	flushed chan struct{}
	n       int64
	data    []byte
}

type Log struct {
	clock                clock.Source
	config               config.Config
	dir, gapFile         string
	seq, total, fileSize int64
	file                 int
	queue                chan line
	finished             chan struct{}
	mu                   sync.Mutex
	gaps                 []Gap
	gapVersion           uint64
	saveMu               sync.Mutex
	savedVersion         uint64
	dirty, saverDone     chan struct{}
	save                 func(string, []byte) error
	closed               bool
	lifecycle            sync.RWMutex
	capped               bool
	reported             int64
}

func files(dir string) ([]int, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ids := []int{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "core-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(name, "core-"), ".jsonl"))
		if err == nil {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	return ids, nil
}

func read(dir string, visit func([]byte) bool) error {
	ids, err := files(dir)
	if err != nil {
		return err
	}
	for _, id := range ids {
		f, err := os.Open(filepath.Join(dir, fmt.Sprintf("core-%d.jsonl", id)))
		if err != nil {
			return err
		}
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 65536), 64<<20)
		for scanner.Scan() {
			if !visit(scanner.Bytes()) {
				return f.Close()
			}
		}
		if err = errors.Join(scanner.Err(), f.Close()); err != nil {
			return err
		}
	}
	return nil
}

func LastTime(root string, id int64) (int64, error) {
	var latest int64
	err := read(filepath.Join(root, fmt.Sprintf("run-%d", id)), func(b []byte) bool {
		var r struct{ At int64 }
		if json.Unmarshal(b, &r) == nil && r.At > latest {
			latest = r.At
		}
		return true
	})
	return latest, err
}

func Open(c config.Config, id int64, source clock.Source) (*Log, error) {
	return openLog(c, id, source, writeLedger)
}

func openLog(c config.Config, id int64, source clock.Source, save func(string, []byte) error) (*Log, error) {
	name := fmt.Sprintf("run-%d", id)
	l := &Log{
		clock: source, config: c,
		dir:     filepath.Join(c.LogDirectory, name),
		gapFile: filepath.Join(c.DataDirectory, "diagnostic-gaps", name+".json"),
		queue:   make(chan line, 10000), finished: make(chan struct{}),
		dirty: make(chan struct{}, 1), saverDone: make(chan struct{}), save: save,
	}
	for _, dir := range []string{l.dir, filepath.Dir(l.gapFile)} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
	}
	if err := read(l.dir, func(b []byte) bool {
		var r struct {
			N    int64
			Area string
			Gaps []Gap
		}
		if json.Unmarshal(b, &r) == nil {
			l.seq = max(l.seq, r.N)
			if r.Area == "log" {
				l.gaps = append(l.gaps, r.Gaps...)
				for _, g := range r.Gaps {
					l.reported = max(l.reported, g.To)
				}
			}
		}
		return true
	}); err != nil {
		return nil, err
	}
	if raw, err := os.ReadFile(l.gapFile); err == nil {
		if err = json.Unmarshal(raw, &l.gaps); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	} else if len(l.gaps) > 0 {
		// Warnings may have reached disk just before an interrupted ledger write.
		l.gapVersion++
		l.dirty <- struct{}{}
	}
	sort.SliceStable(l.gaps, func(i, j int) bool { return l.gaps[i].From < l.gaps[j].From })
	for _, g := range l.gaps {
		if g.Why == "total limit" {
			l.capped = true
		}
		l.seq = max(l.seq, g.To)
	}
	ids, err := files(l.dir)
	if err != nil {
		return nil, err
	}
	for _, idx := range ids {
		stat, err := os.Stat(filepath.Join(l.dir, fmt.Sprintf("core-%d.jsonl", idx)))
		if err != nil {
			return nil, err
		}
		l.file = idx + 1
		l.total += stat.Size()
	}
	go func() {
		defer close(l.saverDone)
		for range l.dirty {
			l.persist()
		}
	}()
	go l.write()
	return l, nil
}

var levels = map[string]int{"error": 0, "warn": 1, "info": 2, "debug": 3, "trace": 4}

func (l *Log) Record(level, area, msg string, fields map[string]any) {
	if levels[level] > levels[l.config.LogLevel] {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	l.seq++
	record := map[string]any{"level": level, "area": area, "msg": msg, "at": l.clock.Now().UnixMilli(), "n": l.seq}
	for k, v := range fields {
		if SecretField(k) {
			record[k] = "[redacted]"
		} else {
			record[k] = redact(v)
		}
	}
	b, err := json.Marshal(record)
	if err != nil {
		l.gap(l.seq, "encoding failure")
		return
	}
	select {
	case l.queue <- line{n: l.seq, data: append(b, '\n')}:
	default:
		l.gap(l.seq, "queue full")
	}
}

func (l *Log) gap(n int64, why string) {
	// Queue overflow is observed by producers while the writer may still lose an
	// older record. Keep ranges ordered by sequence for crash recovery and paging.
	i := sort.Search(len(l.gaps), func(i int) bool { return l.gaps[i].From > n })
	if i > 0 && l.gaps[i-1].Why == why && l.gaps[i-1].To+1 == n {
		l.gaps[i-1].To = n
		l.gaps[i-1].Lost++
		if i < len(l.gaps) && l.gaps[i].Why == why && l.gaps[i].From == n+1 {
			l.gaps[i-1].To = l.gaps[i].To
			l.gaps[i-1].Lost += l.gaps[i].Lost
			l.gaps = slices.Delete(l.gaps, i, i+1)
		}
	} else if i < len(l.gaps) && l.gaps[i].Why == why && l.gaps[i].From == n+1 {
		l.gaps[i].From = n
		l.gaps[i].Lost++
	} else {
		l.gaps = slices.Insert(l.gaps, i, Gap{1, n, n, l.clock.Now().UnixMilli(), why})
	}
	l.gapVersion++
	select {
	case l.dirty <- struct{}{}:
	default:
	}
}

func (l *Log) append(data []byte) string {
	size := int64(len(data))
	if l.capped || float64(l.total+size) > l.config.LogTotalLimit {
		l.capped = true
		return "total limit"
	}
	if float64(l.fileSize+size) > l.config.LogFileLimit {
		l.file++
		l.fileSize = 0
	}
	file, err := os.OpenFile(filepath.Join(l.dir, fmt.Sprintf("core-%d.jsonl", l.file)), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err == nil {
		_, err = file.Write(data)
		err = errors.Join(err, file.Close())
	}
	if err != nil {
		return "write failure"
	}
	l.total += size
	l.fileSize += size
	return ""
}

func writeLedger(path string, data []byte) error {
	file, err := os.OpenFile(path+".partial", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	if err = errors.Join(err, file.Close()); err != nil {
		return err
	}
	if err = os.Rename(path+".partial", path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

// Serialize ledger flushes independently of log appends. Many losses while a
// flush is on disk become one snapshot on the next pass.
func (l *Log) persist() {
	l.saveMu.Lock()
	defer l.saveMu.Unlock()
	l.mu.Lock()
	version := l.gapVersion
	if version == l.savedVersion {
		l.mu.Unlock()
		return
	}
	raw, _ := json.Marshal(l.gaps)
	l.mu.Unlock()
	if err := l.save(l.gapFile, raw); err != nil {
		fmt.Fprintln(os.Stderr, "diagnostic loss accounting:", err)
		return
	}
	l.savedVersion = version
}

func (l *Log) report() {
	if l.capped {
		return
	}
	l.mu.Lock()
	pending := []Gap{}
	through := l.reported
	for _, gap := range l.gaps {
		if gap.To > l.reported {
			gap.From = max(gap.From, l.reported+1)
			gap.Lost = gap.To - gap.From + 1
			pending = append(pending, gap)
			through = max(through, gap.To)
		}
	}
	if len(pending) == 0 || len(l.queue) > 0 {
		l.mu.Unlock()
		return
	}
	// Reserve the number before allowing the next request to enqueue.
	l.seq++
	n := l.seq
	l.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"n": n, "at": l.clock.Now().UnixMilli(), "level": "warn", "area": "log", "msg": "diagnostic gaps", "gaps": pending})
	if why := l.append(append(data, '\n')); why == "" {
		l.reported = through
	}
}

func (l *Log) write() {
	defer close(l.finished)
	for item := range l.queue {
		if item.flushed != nil {
			l.report()
			close(item.flushed)
			continue
		}
		if why := l.append(item.data); why != "" {
			l.mu.Lock()
			l.gap(item.n, why)
			l.mu.Unlock()
		}
		if len(l.queue) == 0 {
			l.report()
		}
	}
	l.report()
	l.persist()
	close(l.dirty)
	<-l.saverDone
}

func (l *Log) Flush() {
	l.lifecycle.RLock()
	l.mu.Lock()
	closed := l.closed
	l.mu.Unlock()
	if !closed {
		done := make(chan struct{})
		l.queue <- line{flushed: done}
		<-done
	}
	l.persist()
	l.lifecycle.RUnlock()
}

func (l *Log) ReadAfter(after int64) ([][]byte, error) {
	l.Flush()
	result := [][]byte{}
	err := read(l.dir, func(b []byte) bool {
		var row struct{ N int64 }
		if json.Unmarshal(b, &row) == nil && row.N > after {
			result = append(result, append([]byte(nil), b...))
		}
		return len(result) < 1000
	})
	return result, err
}

// Gaps includes losses that a failed ledger write could not record on disk.
func (l *Log) Gaps() []Gap {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.Clone(l.gaps)
}

func (l *Log) Close() {
	l.lifecycle.Lock()
	defer l.lifecycle.Unlock()
	l.mu.Lock()
	if !l.closed {
		l.closed = true
		close(l.queue)
	}
	l.mu.Unlock()
	<-l.finished
}
