package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/unicode"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

// Stored retry hashes are part of the SQLite format. Match the original
// JSON.stringify field order and URLSearchParams form encoding on resumed runs.
func (s *Server) requestFingerprint(r *http.Request, pattern string, body []byte) (string, error) {
	_, route, _ := strings.Cut(pattern, " ")
	var params []string
	for _, segment := range strings.Split(route, "/") {
		if strings.HasPrefix(segment, "{") {
			name := strings.Trim(segment, "{}")
			params = append(params, state.JSON(name)+":"+state.JSON(r.PathValue(name)))
			route = strings.Replace(route, segment, ":"+name, 1)
		}
	}
	fields := struct {
		Method string          `json:"method"`
		Route  string          `json:"route"`
		Params json.RawMessage `json:"params"`
		Query  string          `json:"query"`
	}{r.Method, route, json.RawMessage("{" + strings.Join(params, ",") + "}"), formQuery(r.URL.RawQuery)}
	raw, err := json.Marshal(fields)
	if err != nil {
		return "", err
	}
	prefix, err := s.Protocol.CanonicalJSON(raw)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	io.WriteString(hash, strings.TrimSuffix(prefix, "}")+`,"body":"`)
	b64 := base64.NewEncoder(base64.StdEncoding, hash)
	b64.Write(body)
	b64.Close()
	io.WriteString(hash, `"}`)
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// URLSearchParams preserves order and duplicate names. In form data, '*' is
// literal, spaces become '+', and '~' is escaped.
func formQuery(query string) string {
	var pairs []string
	encode := func(part string) string {
		value, err := url.QueryUnescape(part)
		if err != nil {
			// A literal percent that does not begin an escape is data.
			var valid strings.Builder
			for i := 0; i < len(part); i++ {
				if part[i] == '%' && (i+2 >= len(part) || !hexDigit(part[i+1]) || !hexDigit(part[i+2])) {
					valid.WriteString("%25")
				} else {
					valid.WriteByte(part[i])
				}
			}
			value, _ = url.QueryUnescape(valid.String())
		}
		if !utf8.ValidString(value) {
			value, _ = unicode.UTF8.NewDecoder().String(value)
		}
		return strings.ReplaceAll(strings.ReplaceAll(url.QueryEscape(value), "~", "%7E"), "%2A", "*")
	}
	for _, part := range strings.Split(query, "&") {
		if part == "" {
			continue
		}
		key, val, _ := strings.Cut(part, "=")
		pairs = append(pairs, encode(key)+"="+encode(val))
	}
	return strings.Join(pairs, "&")
}

func hexDigit(b byte) bool {
	return b >= '0' && b <= '9' || b >= 'a' && b <= 'f' || b >= 'A' && b <= 'F'
}
