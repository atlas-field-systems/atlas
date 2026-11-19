package api

import (
	"strconv"

	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
	"github.com/atlas-field-systems/atlas/core/internal/tasks"
)

func (s *Server) taskRoutes(add register) {
	add("POST /tasks/{asset_id}", "account", "requests.tasks", func(q *request) (response, error) {
		body, err := tasks.Request(q.Tx, q.r.PathValue("asset_id"), q.caller.id, q.body)
		return response{status: 202, body: body}, err
	})
	add("PATCH /entities/assets/{asset_id}/settings", "account", "requests.settings", func(q *request) (response, error) {
		event, err := entities.RequestSettings(q.Tx, q.r.PathValue("asset_id"), q.caller.id, q.body["settings"].(object))
		return response{status: 202, body: object{"event_id": event}}, err
	})
	add("POST /tasks/{asset_id}/{task_id}/cancel", "account", "", func(q *request) (response, error) {
		id := q.r.PathValue("asset_id")
		if _, err := entities.RequireOnline(q.Tx, id); err != nil {
			return response{}, err
		}
		tid, err := strconv.Atoi(q.r.PathValue("task_id"))
		if err != nil {
			return response{}, state.Missing("No such Task")
		}
		event, err := tasks.Cancel(q.Tx, id, q.caller.id, tid)
		return response{status: 202, body: object{"event_id": event}}, err
	})
}
