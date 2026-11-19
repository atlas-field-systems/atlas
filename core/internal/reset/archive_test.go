package reset

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A central-directory reader can recover the original files despite damage to
// their local headers. The run must survive if the two directory views disagree.
func TestVerifyChecksLocalMembers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "run.zip")
	a, err := Create(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"README.md", "summary.md", "events.jsonl", "config.json", "versions.json"} {
		if _, err = a.Add(name, strings.NewReader(name)); err != nil {
			t.Fatal(err)
		}
	}
	if err = a.Finish(Manifest{RunID: 7}); err != nil {
		t.Fatal(err)
	}
	if err = Verify(path, 7); err != nil {
		t.Fatal(err)
	}
	valid, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		marker []byte
		field  int
	}{
		{"name", []byte("README.md"), 0},
		{"descriptor size", []byte{'P', 'K', 7, 8}, 8},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := bytes.Clone(valid)
			i := bytes.Index(data, tc.marker)
			if i < 0 {
				t.Fatal("missing local marker")
			}
			data[i+tc.field] ^= 1
			if err := os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := Verify(path, 7); err == nil {
				t.Fatal("accepted damaged local member")
			}
		})
	}
}
