package state

import (
	"database/sql"
	"encoding/json"
)

// records reads one JSON value per row, keeping numbers in Protocol records exact.
func Records(tx *sql.Tx, query string, args ...any) ([]json.RawMessage, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		items = append(items, json.RawMessage(b))
	}
	return items, rows.Err()
}

func AsOf(tx *sql.Tx) (int64, error) {
	var id int64
	err := tx.QueryRow("SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name='events'),0)").Scan(&id)
	return id, err
}

// JSON serializes validated Protocol values and Core-owned JSON metadata.
func JSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// Column collects a single column before callers change the rows it came from.
func Column[T any](tx *sql.Tx, query string, args ...any) ([]T, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []T{}
	for rows.Next() {
		var value T
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		items = append(items, value)
	}
	return items, rows.Err()
}
