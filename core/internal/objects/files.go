// Package objects owns Object files and their metadata.
package objects

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type Upload struct {
	path, ContentType, Hash string
	size                    int64
	geotiff, Retained       bool
}

func directory(run *state.Run) string {
	return filepath.Join(run.Config.DataDirectory, "objects", fmt.Sprintf("run-%d", run.ID))
}

func CleanUploads(ctx context.Context, run *state.Run) error {
	dir := directory(run)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return run.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, path := range []string{filepath.Join(run.Config.DataDirectory, "uploads"), dir} {
			entries, err := os.ReadDir(path)
			if err != nil {
				return err
			}
			for _, entry := range entries {
				if path == dir {
					var kept bool
					if err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM objects WHERE run_id=? AND file=?)", run.ID, entry.Name()).Scan(&kept); err != nil {
						return err
					}
					if kept {
						continue
					}
				}
				if err = os.Remove(filepath.Join(path, entry.Name())); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func Receive(run *state.Run, src io.Reader, contentType string) (result *Upload, err error) {
	file, err := os.CreateTemp(directory(run), "upload-")
	if err != nil {
		return nil, err
	}
	path := file.Name()
	defer func() {
		file.Close()
		if err != nil {
			os.Remove(path)
		}
	}()
	digest := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, digest), src)
	if err != nil {
		return nil, err
	}
	if err = file.Sync(); err != nil {
		return nil, err
	}
	tiff, err := geoTIFF(file, size)
	if err != nil {
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	for _, dir := range []string{directory(run), filepath.Dir(directory(run)), run.Config.DataDirectory} {
		d, err := os.Open(dir)
		if err != nil {
			return nil, err
		}
		if err = errors.Join(d.Sync(), d.Close()); err != nil {
			return nil, err
		}
	}
	return &Upload{path: path, size: size, Hash: hex.EncodeToString(digest.Sum(nil)), ContentType: contentType, geotiff: tiff}, nil
}

// Discard removes an upload whose transaction failed or replayed an acknowledgment.
func (u *Upload) Discard() {
	if !u.Retained {
		os.Remove(u.path)
	}
}

func geoTIFF(file io.ReaderAt, size int64) (bool, error) {
	if size < 8 {
		return false, nil
	}
	var header [8]byte
	if _, err := file.ReadAt(header[:], 0); err != nil {
		return false, err
	}
	var order binary.ByteOrder
	switch string(header[:2]) {
	case "MM":
		order = binary.BigEndian
	case "II":
		order = binary.LittleEndian
	default:
		return false, nil
	}
	if order.Uint16(header[2:]) != 42 {
		return false, nil
	}
	offset := int64(order.Uint32(header[4:]))
	if offset == 0 || offset+2 > size {
		return false, nil
	}
	if _, err := file.ReadAt(header[:2], offset); err != nil {
		return false, err
	}
	length := int(order.Uint16(header[:2])) * 12
	if offset+2+int64(length)+4 > size {
		return false, nil
	}
	entries := make([]byte, length)
	if _, err := file.ReadAt(entries, offset+2); err != nil {
		return false, err
	}
	for i := 0; i < len(entries); i += 12 {
		if order.Uint16(entries[i:]) == 34735 {
			return true, nil
		}
	}
	return false, nil
}

func OpenFile(tx *state.Tx, id string) (*os.File, state.Record, error) {
	record, name, err := Get(tx, id)
	if err != nil {
		return nil, nil, err
	}
	if filepath.Base(name) != name {
		return nil, nil, errors.New("invalid Object file")
	}
	f, err := os.Open(filepath.Join(directory(tx.Run), name))
	return f, record, err
}
