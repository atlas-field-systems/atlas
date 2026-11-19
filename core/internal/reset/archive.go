// Package reset writes and verifies Core run archives.
package reset

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
)

// Digest describes the uncompressed contents recorded in manifest.json.
type Digest struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	RunID     int64             `json:"run_id"`
	StartedAt int64             `json:"started_at"`
	EndedAt   int64             `json:"ended_at"`
	Files     map[string]Digest `json:"files"`
	Resumes   []json.RawMessage `json:"resumes"`
	Gaps      []json.RawMessage `json:"gaps"`
}

type Archive struct {
	file   *os.File
	writer *zip.Writer
	files  map[string]Digest
}

func Create(path string) (*Archive, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	return &Archive{file: file, writer: zip.NewWriter(file), files: make(map[string]Digest)}, nil
}

func (a *Archive) Add(name string, contents io.Reader) (Digest, error) {
	return a.write(name, func(w io.Writer) error { _, err := io.Copy(w, contents); return err })
}

func (a *Archive) write(name string, produce func(io.Writer) error) (Digest, error) {
	if !fs.ValidPath(name) || name == "." || name == "manifest.json" {
		return Digest{}, fmt.Errorf("invalid archive member %q", name)
	}
	if _, found := a.files[name]; found {
		return Digest{}, fmt.Errorf("duplicate archive member %q", name)
	}
	member, err := a.writer.Create(name)
	if err != nil {
		return Digest{}, err
	}
	hash := sha256.New()
	count := new(byteCount)
	err = produce(io.MultiWriter(member, hash, count))
	size := int64(*count)
	if err != nil {
		return Digest{}, err
	}
	digest := Digest{size, hex.EncodeToString(hash.Sum(nil))}
	a.files[name] = digest
	return digest, nil
}

func (a *Archive) Finish(manifest Manifest) error {
	manifest.Files = a.files
	w, err := a.writer.Create("manifest.json")
	if err == nil {
		err = json.NewEncoder(w).Encode(manifest)
	}
	if err == nil {
		err = a.writer.Close()
	}
	if err == nil {
		err = a.file.Sync()
	}
	return errors.Join(err, a.file.Close())
}

// Abort discards an unpublished archive, including one which failed readback.
func (a *Archive) Abort() error {
	_ = a.file.Close()
	return os.Remove(a.file.Name())
}

func Verify(path string, runID int64) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		return err
	}
	if err = checkLocalHeaders(file, info.Size(), reader.File); err != nil {
		return err
	}
	members := make(map[string]*zip.File, len(reader.File))
	for _, f := range reader.File {
		if _, exists := members[f.Name]; exists {
			return fmt.Errorf("duplicate archive member %q", f.Name)
		}
		members[f.Name] = f
	}
	manifestEntry := members["manifest.json"]
	if manifestEntry == nil {
		return errors.New("missing manifest")
	}
	stream, err := manifestEntry.Open()
	if err != nil {
		return err
	}
	raw, readErr := io.ReadAll(stream)
	err = errors.Join(readErr, stream.Close())
	if err != nil {
		return err
	}
	var manifest Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		return err
	}
	delete(members, "manifest.json")
	if manifest.RunID != runID || len(manifest.Files) != len(members) {
		return errors.New("manifest does not match archive")
	}
	for _, name := range []string{"README.md", "summary.md", "events.jsonl", "config.json", "versions.json"} {
		if members[name] == nil {
			return fmt.Errorf("missing %s", name)
		}
	}
	for name, f := range members {
		expected, ok := manifest.Files[name]
		if !ok || expected.Size < 0 || uint64(expected.Size) != f.UncompressedSize64 {
			return fmt.Errorf("size mismatch for %q", name)
		}
		r, err := f.Open()
		if err != nil {
			return err
		}
		h := sha256.New()
		n, readErr := io.Copy(h, r)
		if err = errors.Join(readErr, r.Close()); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if n != expected.Size || hex.EncodeToString(h.Sum(nil)) != expected.SHA256 {
			return fmt.Errorf("digest mismatch for %q", name)
		}
	}
	return nil
}

type byteCount int64

func (c *byteCount) Write(p []byte) (int, error) { *c += byteCount(len(p)); return len(p), nil }
