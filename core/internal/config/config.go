// Package config reads Core's local JSON configuration and environment overrides.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type Admin struct {
	OperatorID   string `json:"operator_id"`
	PasswordFile string `json:"password_file"`
}

type Config struct {
	ListenAddress     string  `json:"listen_address"`
	Port              int     `json:"port"`
	TLSCertificate    *string `json:"tls_certificate"`
	TLSKey            *string `json:"tls_key"`
	DataDirectory     string  `json:"data_directory"`
	FirstAdmin        *Admin  `json:"first_admin"`
	OfflineAfter      float64 `json:"offline_after_s"`
	StreamKeepalive   float64 `json:"stream_keepalive_s"`
	MaxObjectBytes    float64 `json:"max_object_bytes"`
	ClockAhead        float64 `json:"clock_ahead_s"`
	LogLevel          string  `json:"log_level"`
	LogDirectory      string  `json:"log_directory"`
	LogMessageContent bool    `json:"log_message_content"`
	LogFileLimit      float64 `json:"log_file_limit_bytes"`
	LogTotalLimit     float64 `json:"log_total_limit_bytes"`
	DebugEndpoint     bool    `json:"debug_endpoint"`
	ArchiveDirectory  string  `json:"archive_directory"`
}

func Read(path string, env []string) (Config, error) {
	c := Config{
		ListenAddress: "127.0.0.1", Port: 8443, DataDirectory: "/var/lib/atlas-core",
		OfflineAfter: 30, StreamKeepalive: 10, MaxObjectBytes: 100000000, ClockAhead: 10,
		LogLevel: "trace", LogMessageContent: true, LogFileLimit: 64 << 20, LogTotalLimit: 2 << 30,
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); err != nil {
		return c, err
	}
	if fields == nil {
		return c, errors.New("config must be an object")
	}
	for _, item := range env {
		key, value, _ := strings.Cut(item, "=")
		suffix, ok := strings.CutPrefix(key, "ATLAS_CORE_")
		if !ok {
			continue
		}
		raw := []byte(value)
		if !json.Valid(raw) {
			raw, _ = json.Marshal(value)
		}
		fields[strings.ToLower(suffix)] = raw
	}
	defaults, _ := json.Marshal(c)
	var keys map[string]json.RawMessage
	json.Unmarshal(defaults, &keys)
	for k, v := range fields {
		if _, ok := keys[k]; !ok {
			return c, fmt.Errorf("%s: unknown option", k)
		}
		if bytes.Equal(v, []byte("null")) && k != "tls_key" && k != "tls_certificate" && k != "first_admin" {
			return c, fmt.Errorf("%s: wrong type", k)
		}
	}
	if raw, ok := fields["port"]; ok {
		var number float64
		if err = json.Unmarshal(raw, &number); err != nil || number < 0 || number > 65535 || math.Trunc(number) != number {
			return c, errors.New("port must be an integer from 0 to 65535")
		}
		fields["port"] = json.RawMessage(strconv.Itoa(int(number)))
	}
	data, err = json.Marshal(fields)
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(data, &c); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return c, fmt.Errorf("%s: wrong type", strings.Split(typeErr.Field, ".")[0])
		}
		return c, err
	}
	if c.DataDirectory == "" || c.ListenAddress == "" {
		return c, errors.New("data_directory and listen_address must be nonempty")
	}
	abs, err := filepath.Abs(c.DataDirectory)
	if err != nil {
		return c, err
	}
	if _, set := fields["archive_directory"]; !set {
		c.ArchiveDirectory = abs + "-archive"
	}
	if _, set := fields["log_directory"]; !set {
		c.LogDirectory = filepath.Join(abs, "diagnostics")
	}
	if c.ArchiveDirectory == "" || c.LogDirectory == "" {
		return c, errors.New("archive_directory and log_directory must be nonempty")
	}
	if (c.TLSKey == nil) != (c.TLSCertificate == nil) {
		return c, errors.New("both TLS paths must be set")
	}
	if c.TLSKey != nil && (*c.TLSKey == "" || *c.TLSCertificate == "") {
		return c, errors.New("TLS paths must be nonempty")
	}
	if c.TLSKey == nil && c.ListenAddress != "localhost" && c.ListenAddress != "::1" && c.ListenAddress != "127.0.0.1" {
		return c, errors.New("listen_address: plain HTTP requires loopback")
	}
	for k, n := range map[string]float64{
		"offline_after_s": c.OfflineAfter, "stream_keepalive_s": c.StreamKeepalive,
		"max_object_bytes": c.MaxObjectBytes, "clock_ahead_s": c.ClockAhead,
		"log_file_limit_bytes": c.LogFileLimit, "log_total_limit_bytes": c.LogTotalLimit,
	} {
		if n <= 0 {
			return c, fmt.Errorf("%s must be positive", k)
		}
	}
	if c.StreamKeepalive > 2147483.647 {
		return c, errors.New("stream_keepalive_s exceeds timer limit")
	}
	switch c.LogLevel {
	case "error", "warn", "info", "debug", "trace":
	default:
		return c, errors.New("log_level: unknown level")
	}
	if c.FirstAdmin != nil && (!regexp.MustCompile("^[A-Za-z0-9]{1,4}$").MatchString(c.FirstAdmin.OperatorID) || c.FirstAdmin.PasswordFile == "") {
		return c, errors.New("first_admin requires operator_id and password_file")
	}
	return c, nil
}

func (c Config) PrepareDirs() error {
	for _, dir := range []string{c.DataDirectory, c.LogDirectory, c.ArchiveDirectory, filepath.Join(c.DataDirectory, "uploads")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	}
	resolve := func(path string) (string, error) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return "", err
		}
		return filepath.EvalSymlinks(abs)
	}
	archive, err := resolve(c.ArchiveDirectory)
	if err != nil {
		return err
	}
	for _, dir := range []string{c.DataDirectory, c.LogDirectory} {
		base, err := resolve(dir)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(base, archive)
		if err != nil {
			return err
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("archive_directory must be outside data_directory and log_directory")
		}
	}
	return nil
}

// Redacted returns the resolved configuration suitable for diagnostics and Reset.
func (c Config) Redacted() Config {
	if c.FirstAdmin != nil {
		admin := *c.FirstAdmin
		admin.PasswordFile = "[redacted]"
		c.FirstAdmin = &admin
	}
	return c
}
