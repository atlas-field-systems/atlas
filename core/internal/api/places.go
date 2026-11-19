package api

import (
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/objects"
	"github.com/atlas-field-systems/atlas/core/internal/tasks"
)

func (s *Server) placeRoutes(add register) {
	add("POST /entities/geofeatures", "reader", "requests.geofeature", func(q *request) (response, error) {
		by, call, err := s.creator(q)
		if err != nil {
			return response{}, err
		}
		if q.body["kind"] == "imagery" {
			if err = objects.RequireGeoTIFF(q.Tx, q.body["object_id"]); err != nil {
				return response{}, err
			}
		}
		event, err := entities.CreatePlace(q.Tx, q.body, by, call)
		return ok(object{"geofeature": q.body, "event_id": event}), err
	})
	add("PUT /entities/geofeatures/{geofeature_id}", "account", "requests.geofeature", func(q *request) (response, error) {
		id := q.r.PathValue("geofeature_id")
		p := q.body
		event, err := entities.ReplacePlace(q.Tx, id, q.caller.id, p)
		if err != nil {
			return response{}, err
		}
		body := object{"geofeature": p, "event_id": event}
		if q.r.URL.Query().Get("update_tasks") == "true" {
			if err = tasks.UpdatePlace(q.Tx, p, body); err != nil {
				return response{}, err
			}
		}
		return ok(body), nil
	})
	add("DELETE /entities/geofeatures/{geofeature_id}", "account", "", func(q *request) (response, error) {
		id := q.r.PathValue("geofeature_id")
		event, err := entities.DeletePlace(q.Tx, id, q.caller.id)
		return ok(object{"event_id": event}), err
	})
}
