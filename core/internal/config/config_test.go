package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestKeepaliveTimerLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		value    string
		accepted bool
	}{{"2147483.647", true}, {"2147483.648", false}} {
		_, err := Read(path, []string{"ATLAS_CORE_STREAM_KEEPALIVE_S=" + tc.value})
		if (err == nil) != tc.accepted {
			t.Fatalf("%s: %v", tc.value, err)
		}
	}
}
