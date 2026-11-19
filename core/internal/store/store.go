// Package store owns the SQLite connection and transactions for one Core.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"

	sqlite "github.com/mattn/go-sqlite3"
)

//go:embed schema/*.sql
var schema embed.FS

type Store struct {
	db          *sql.DB
	conn        *sql.Conn
	transaction chan struct{}
	mu          sync.Mutex
	changed     chan struct{}
}

// Changed closes after the next committed change. Subscribe before reading a snapshot.
func (s *Store) Changed() <-chan struct{} { s.mu.Lock(); defer s.mu.Unlock(); return s.changed }

func Open(path string) (*Store, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	target := url.URL{Scheme: "file", Path: path, RawQuery: "_locking_mode=EXCLUSIVE&_journal_mode=WAL&_synchronous=FULL&_foreign_keys=on&_busy_timeout=0&_txlock=immediate"}
	db, err := sql.Open("sqlite3", target.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return nil, openError(err)
	}
	s := &Store{db: db, conn: conn, transaction: make(chan struct{}, 1), changed: make(chan struct{})}
	err = s.Write(ctx, func(tx *sql.Tx) error {
		var version int
		if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		if version > 1 {
			return fmt.Errorf("unsupported Core database schema %d", version)
		}
		files, err := schema.ReadDir("schema")
		if err != nil {
			return err
		}
		for _, file := range files {
			ddl, err := schema.ReadFile("schema/" + file.Name())
			if err != nil {
				return err
			}
			if _, err = tx.Exec(string(ddl)); err != nil {
				return fmt.Errorf("%s: %w", file.Name(), err)
			}
		}
		_, err = tx.Exec("PRAGMA user_version=1")
		return err
	})
	if err != nil {
		s.Close()
		return nil, openError(err)
	}
	return s, nil
}

func openError(err error) error {
	var se sqlite.Error
	if errors.As(err, &se) && se.Code == sqlite.ErrBusy {
		return fmt.Errorf("data_directory is already in use by another Core: %w", err)
	}
	return err
}

func (s *Store) Close() error {
	return errors.Join(s.conn.Close(), s.db.Close())
}

func (s *Store) Write(ctx context.Context, work func(*sql.Tx) error) error {
	// Hold the same SQLite connection and exclusive lock until shutdown. A
	// disconnected HTTP client can leave the queue, but cannot invalidate the
	// connection or split an already admitted transaction.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case s.transaction <- struct{}{}:
	}
	defer func() { <-s.transaction }()
	if err := ctx.Err(); err != nil {
		return err
	}
	tx, err := s.conn.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var before, after int64
	if err = tx.QueryRow("SELECT total_changes()").Scan(&before); err != nil {
		return err
	}
	if err = work(tx); err != nil {
		return err
	}
	if err = tx.QueryRow("SELECT total_changes()").Scan(&after); err != nil {
		return err
	}
	if err = tx.Commit(); err == nil && before != after {
		s.mu.Lock()
		close(s.changed)
		s.changed = make(chan struct{})
		s.mu.Unlock()
	}
	return err
}

type Run struct {
	ID, StartedAt int64
	Resumed       bool
}

func (s *Store) BeginRun(ctx context.Context, now int64, lastDiagnostic func(int64) (int64, error)) (Run, error) {
	var run Run
	err := s.Write(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRow("SELECT run_id,started_at FROM runs WHERE ended_at IS NULL").Scan(&run.ID, &run.StartedAt)
		if errors.Is(err, sql.ErrNoRows) {
			result, err := tx.Exec("INSERT INTO runs(started_at) VALUES (?)", now)
			if err != nil {
				return err
			}
			run.ID, err = result.LastInsertId()
			run.StartedAt = now
			return err
		}
		if err != nil {
			return err
		}
		run.Resumed = true
		last, err := lastDiagnostic(run.ID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE runs SET resumes=json_insert(resumes,'$[#]',json_object('last_sign_of_life',max(started_at,?,coalesce((SELECT max(time) FROM events WHERE run_id=?),0)),'resumed_at',?)) WHERE run_id=?`, last, run.ID, now, run.ID)
		return err
	})
	return run, err
}

// ShortID encodes the persistent sequence used for Core-assigned identities.
func ShortID(seq int64) (string, error) {
	n := seq - 1
	if n < 0 {
		return "", errors.New("short IDs exhausted")
	}
	const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	for width, power := 1, int64(1); width <= 4; width, power = width+1, power*36 {
		if n >= 26*power {
			n -= 26 * power
			continue
		}
		var b strings.Builder
		b.WriteByte(byte('A' + n/power))
		for power /= 36; power > 0; power /= 36 {
			b.WriteByte(digits[n/power%36])
		}
		return b.String(), nil
	}
	return "", errors.New("short IDs exhausted")
}
