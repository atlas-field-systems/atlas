package api

import (
	"encoding/json"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/objects"
	"github.com/atlas-field-systems/atlas/core/internal/state"
	"github.com/atlas-field-systems/atlas/core/internal/tasks"
)

func snapshot(q *request, body object, err error) (response, error) {
	if err != nil {
		return response{}, err
	}
	body["as_of"], err = state.AsOf(q.Tx.Tx)
	return ok(body), err
}

func (s *Server) readRoutes(add register) {
	for _, route := range []struct {
		path string
		list func(*state.Tx) ([]json.RawMessage, error)
	}{
		{"/entities/observations", entities.Observations}, {"/entities/tracks", entities.Tracks}, {"/entities/geofeatures", entities.Places},
	} {
		add("GET "+route.path, "reader", "", func(q *request) (response, error) {
			items, err := route.list(q.Tx)
			return snapshot(q, object{"items": items}, err)
		})
	}
	add("GET /entities/tracks/{track_id}", "reader", "", func(q *request) (response, error) {
		item, err := entities.Track(q.Tx, q.r.PathValue("track_id"))
		return snapshot(q, object{"item": item}, err)
	})
	add("GET /entities/geofeatures/{geofeature_id}", "reader", "", func(q *request) (response, error) {
		item, err := entities.Place(q.Tx, q.r.PathValue("geofeature_id"))
		return snapshot(q, object{"item": item}, err)
	})
	add("GET /entities/assets", "reader", "", func(q *request) (response, error) {
		items, err := entities.Assets(q.Tx, "")
		if err != nil {
			return response{}, err
		}
		gateways, err := administration.GatewayContacts(q.Tx)
		return snapshot(q, object{"items": items, "gateways": gateways}, err)
	})
	add("GET /entities/assets/{asset_id}", "reader", "", func(q *request) (response, error) {
		items, err := entities.Assets(q.Tx, q.r.PathValue("asset_id"))
		if err != nil {
			return response{}, err
		}
		if len(items) == 0 {
			return response{}, state.Missing("No such Asset")
		}
		return snapshot(q, object{"item": items[0]}, nil)
	})
	add("GET /entities", "reader", "", func(q *request) (response, error) { body, err := entities.Picture(q.Tx); return snapshot(q, body, err) })
	add("GET /tasks/{asset_id}", "reader", "", func(q *request) (response, error) {
		body, err := tasks.List(q.Tx, q.r.PathValue("asset_id"))
		return snapshot(q, body, err)
	})
	add("GET /objects", "reader", "", func(q *request) (response, error) {
		var place *string
		values := q.r.URL.Query()
		if values.Has("geofeature_id") {
			id := values.Get("geofeature_id")
			place = &id
		}
		items, err := objects.List(q.Tx, place)
		return snapshot(q, object{"items": items}, err)
	})
	add("GET /plugins", "reader", "", func(q *request) (response, error) {
		items, err := administration.ListPlugins(q.Tx)
		return snapshot(q, object{"items": items}, err)
	})
}
