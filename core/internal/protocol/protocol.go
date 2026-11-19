// Package protocol runs Atlas Protocol's packaged JavaScript validator in Core.
package protocol

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

//go:generate node ../../scripts/bundle-protocol.mjs

//go:embed validator.js.gz
var bundled []byte

//go:embed definitions.json.gz
var definitions []byte

type Versions struct {
	Core     string `json:"core_version"`
	Protocol string `json:"protocol_version"`
	Hash     string `json:"definitions_hash"`
}

type Client struct {
	Versions Versions
	Events   map[string]EventKind
	vm       *goja.Runtime
	validate goja.Callable
	mu       sync.Mutex
}

// The browser entry point needs UTF-8 and SHA-256 from its host.
const browserGlobals = `globalThis.console={log(){},warn(){},error(){}};globalThis.TextEncoder=class{encode(s){return new Uint8Array(encodeUTF8(s))}};
globalThis.TextDecoder=class{decode(bytes){return decodeUTF8(bytes)}};
globalThis.crypto={subtle:{digest:async(_,bytes)=>sha256(bytes)}};`

type EventKind struct {
	Record string
	Many   bool
}

func inflate(data []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func Start() (*Client, error) {
	script, err := inflate(bundled)
	if err != nil {
		return nil, err
	}
	files, err := inflate(definitions)
	if err != nil {
		return nil, err
	}
	vm := goja.New()
	vm.Set("definitionFiles", string(files))
	vm.Set("encodeUTF8", func(s string) goja.ArrayBuffer { return vm.NewArrayBuffer([]byte(s)) })
	vm.Set("decodeUTF8", func(b []byte) string { return string(b) })
	vm.Set("sha256", func(b []byte) goja.ArrayBuffer { h := sha256.Sum256(b); return vm.NewArrayBuffer(h[:]) })
	if _, err = vm.RunString(browserGlobals); err != nil {
		return nil, err
	}
	if _, err = vm.RunScript("atlas-protocol.js", string(script)); err != nil {
		return nil, err
	}
	p, ok := vm.Get("ready").Export().(*goja.Promise)
	if !ok {
		return nil, errors.New("packaged validator did not start")
	}
	if p.State() != goja.PromiseStateFulfilled {
		return nil, fmt.Errorf("load packaged validator: %s", p.Result())
	}
	c := &Client{vm: vm}
	var info struct {
		Versions Versions
		Events   map[string]EventKind
	}
	if err = json.Unmarshal([]byte(p.Result().String()), &info); err != nil {
		return nil, err
	}
	c.Versions, c.Events = info.Versions, info.Events
	if c.validate, ok = goja.AssertFunction(vm.Get("validate")); !ok {
		return nil, errors.New("missing validator")
	}
	return c, nil
}

type Invalid struct{ Message string }

func (e Invalid) Error() string { return e.Message }
func (c *Client) Check(name string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.CheckJSON(name, b)
}

func (c *Client) CheckJSON(name string, b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, err := c.validate(goja.Undefined(), c.vm.ToValue(name), c.vm.ToValue(string(b)))
	if err != nil {
		return err
	}
	var result struct {
		OK       bool
		Problems []struct{ Path, Message string }
	}
	if err = json.Unmarshal([]byte(v.String()), &result); err != nil {
		return err
	}
	if result.OK {
		return nil
	}
	reasons := make([]string, len(result.Problems))
	for i, p := range result.Problems {
		reasons[i] = p.Path + ": " + p.Message
	}
	return Invalid{strings.Join(reasons, "; ")}
}

// CanonicalJSON retains the credential fingerprint representation used by open runs.
func (c *Client) CanonicalJSON(raw []byte) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	j := c.vm.Get("JSON").ToObject(c.vm)
	parse, _ := goja.AssertFunction(j.Get("parse"))
	stringify, _ := goja.AssertFunction(j.Get("stringify"))
	value, err := parse(j, c.vm.ToValue(string(raw)))
	if err != nil {
		return "", err
	}
	encoded, err := stringify(j, value)
	if err != nil {
		return "", err
	}
	return encoded.String(), nil
}
