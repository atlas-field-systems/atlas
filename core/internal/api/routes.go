package api

import (
	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/entities"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type register func(pattern, access, definition string, serve func(*request) (response, error))

func (s *Server) routes(add register) {
	add("GET /about", "public", "", func(q *request) (response, error) {
		v := s.Protocol.Versions
		return ok(object{"core_version": v.Core, "protocol_version": v.Protocol, "definitions_hash": v.Hash, "run_id": s.Run.ID, "stream_keepalive_s": s.Config.StreamKeepalive}), nil
	})
	add("POST /administration/login", "public", "requests.login", s.login)
	add("GET /administration/me", "account", "", func(q *request) (response, error) {
		return ok(object{"operator_id": q.caller.id, "admin": q.caller.admin}), nil
	})
	add("POST /administration/logout", "account", "", func(q *request) (response, error) {
		err := administration.EndSession(q.Tx, q.caller.token)
		reply := ok(object{})
		reply.cookie = expiredCookie
		return reply, err
	})
	add("POST /administration/accounts", "admin", "requests.account", func(q *request) (response, error) {
		id := q.body["operator_id"].(string)
		assigned, err := entities.Assigned(q.Tx, id)
		if err != nil {
			return response{}, err
		}
		if assigned {
			return response{}, state.Conflict("id_taken", "That identity is in use")
		}
		err = administration.CreateAccount(q.Tx, id, q.body["admin"].(bool), q.password.hash)
		return response{status: 201, body: object{"operator_id": id}}, err
	})
	add("DELETE /administration/accounts/{operator_id}", "admin", "", func(q *request) (response, error) {
		return ok(object{}), administration.DeleteAccount(q.Tx, q.r.PathValue("operator_id"))
	})
	for _, identity := range administration.Identities {
		base := "/administration/" + identity.Path
		subject := base + "/{" + identity.Column + "}"
		add("POST "+base, "admin", "", func(q *request) (response, error) {
			issue, err := identity.Provision(q.Tx, q.caller.id)
			return response{status: 201, body: issue.Shown, ack: issue.Acknowledgment}, err
		})
		add("POST "+subject+"/key", "admin", "", func(q *request) (response, error) {
			issue, err := identity.Replace(q.Tx, q.r.PathValue(identity.Column))
			return response{status: 200, body: issue.Shown, ack: issue.Acknowledgment}, err
		})
		add("DELETE "+subject, "admin", "", func(q *request) (response, error) {
			id := q.r.PathValue(identity.Column)
			body, err := identity.Remove(q.Tx, id, q.caller.id)
			if err != nil {
				return response{}, err
			}
			switch identity.Kind {
			case "gateway":
				err = s.disconnectRadios(q, id, q.Now)
			case "plugin":
				err = q.DropRequests("plugin", id)
			}
			return ok(body), err
		})
	}
	s.readRoutes(add)
	s.historyRoutes(add)
	s.assetRoutes(add)
	s.taskRoutes(add)
	s.objectRoutes(add)
	s.placeRoutes(add)

	s.pluginRoutes(add)
}

func (s *Server) login(q *request) (response, error) {
	id := q.body["operator_id"].(string)
	key, err := administration.StartSession(q.Tx, id)
	return response{status: 200, body: object{"operator_id": id, "logged_in": true}, cookie: "atlas_session=" + key + "; Path=/; HttpOnly; Secure; SameSite=Strict"}, err
}
