package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/atlas-field-systems/atlas/core/internal/objects"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type download struct {
	file        *os.File
	contentType string
	size        int64
}

func (d *download) send(w http.ResponseWriter) error {
	defer d.file.Close()
	w.Header().Set("Content-Type", d.contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(d.size, 10))
	w.WriteHeader(200)
	_, err := io.Copy(w, d.file)
	return err
}

func (s *Server) receive(w http.ResponseWriter, r *http.Request) (*objects.Upload, error) {
	typ, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
	if typ == "" {
		typ = "application/octet-stream"
	}
	u, err := objects.Receive(s.Run, http.MaxBytesReader(w, r.Body, int64(s.Config.MaxObjectBytes)), typ)
	var limit *http.MaxBytesError
	if errors.As(err, &limit) {
		return nil, state.Refusal{Status: 413, Code: "too_large", Reason: "Object exceeds max_object_bytes"}
	}
	return u, err
}

func (s *Server) objectRoutes(add register) {
	add("POST /objects", "reader", "file", func(q *request) (response, error) {
		by, call, err := s.creator(q)
		if err != nil {
			return response{}, err
		}
		v := q.r.URL.Query()
		body, err := objects.Store(q.Tx, q.upload, v.Get("name"), v.Get("geofeature_id"), by, call)
		return response{status: 201, body: body}, err
	})
	add("GET /objects/{object_id}", "reader", "", func(q *request) (response, error) {
		body, _, err := objects.Get(q.Tx, q.r.PathValue("object_id"))
		return ok(body), err
	})
	add("GET /objects/{object_id}/file", "reader", "", func(q *request) (response, error) {
		f, record, err := objects.OpenFile(q.Tx, q.r.PathValue("object_id"))
		if err != nil {
			return response{}, err
		}
		return response{status: 200, file: &download{f, record["content_type"].(string), int64(record["size_bytes"].(float64))}}, nil
	})
	add("PATCH /objects/{object_id}", "account", "requests.attach", func(q *request) (response, error) {
		id, err := objects.Attach(q.Tx, q.r.PathValue("object_id"), q.body["geofeature_id"])
		return ok(object{"event_id": id}), err
	})
	add("DELETE /objects/{object_id}", "account", "", func(q *request) (response, error) {
		id, err := objects.Delete(q.Tx, q.r.PathValue("object_id"), q.caller.id)
		return ok(object{"event_id": id}), err
	})
}
