package entities

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/state"
)

type Capabilities struct {
	commands, settings []string
	cameras            []struct {
		ID string `json:"camera_id"`
	}
	ip               bool
	Online, Critical bool
	keepalive        float64
}

func Admission(tx *state.Tx, id string) (Capabilities, error) {
	var c Capabilities
	var description, policy *string
	var gateway *string
	err := tx.QueryRow(`SELECT a.description, a.gateway_id, json_extract(a.contact,'$.contact')='online',
		(SELECT json_extract(record,'$.settings.failsafe_policy') FROM events
		 WHERE run_id=a.run_id AND asset_id=a.asset_id AND kind='report.settings' AND clock_ahead=0
		   AND json_type(record,'$.settings.failsafe_policy')='array'
		 ORDER BY order_time DESC,event_id DESC LIMIT 1)
		FROM assets a WHERE a.run_id=? AND a.asset_id=? AND removed=0`, tx.ID, id).
		Scan(&description, &gateway, &c.Online, &policy)
	if errors.Is(err, sql.ErrNoRows) {
		return c, state.Missing("No such Asset")
	}
	if err != nil {
		return c, err
	}
	c.ip = gateway == nil
	if gateway != nil && c.Online {
		c.Online, err = administration.GatewayOnline(tx, *gateway)
		if err != nil {
			return c, err
		}
	}
	if description == nil {
		return c, state.Conflict("not_supported", "Asset has no description")
	}
	var d struct {
		Commands, Settings []string
		Cameras            []struct {
			ID string `json:"camera_id"`
		}
	}
	if err = json.Unmarshal([]byte(*description), &d); err != nil {
		return c, err
	}
	c.commands, c.settings, c.cameras = d.Commands, d.Settings, d.Cameras
	c.keepalive = tx.Config.StreamKeepalive
	if policy != nil {
		var rules []any
		if err = json.Unmarshal([]byte(*policy), &rules); err != nil {
			return c, err
		}
		c.Critical = hasCritical(rules)
	}
	return c, nil
}

func hasCritical(rules []any) bool {
	for _, raw := range rules {
		rule := raw.(map[string]any)
		for _, raw := range rule["conditions"].([]any) {
			cond := raw.(map[string]any)
			if cond["kind"] == "battery_below" && cond["critical"] == true {
				return true
			}
		}
	}
	return false
}

func (c Capabilities) Command(cmd state.Record) error {
	if !slices.Contains(c.commands, cmd["kind"].(string)) {
		return state.Conflict("not_supported", "Command is not declared")
	}
	if cmd["kind"] == "capture" {
		for _, camera := range c.cameras {
			if camera.ID == cmd["camera_id"] {
				return nil
			}
		}
		return state.Conflict("not_supported", "Camera is not declared")
	}
	return nil
}

func (c Capabilities) CheckSettings(values state.Record) error {
	if loss, ok := values["link_loss_after_s"].(float64); ok && c.ip && loss <= c.keepalive {
		return state.Conflict("invalid_link_loss", "link_loss_after_s must exceed Core stream_keepalive_s")
	}
	policy, ok := values["failsafe_policy"].([]any)
	for _, raw := range policy {
		if err := c.Command(raw.(map[string]any)["response"].(map[string]any)); err != nil {
			return err
		}
	}
	for name := range values {
		if !slices.Contains(c.settings, name) {
			return state.Conflict("not_supported", "Setting is not declared")
		}
	}
	if ok && slices.Contains(c.commands, "takeoff") && !hasCritical(policy) {
		return state.Conflict("no_critical_battery_rule", "Policy needs a critical battery rule")
	}
	return nil
}

func (c Capabilities) Flying() bool { return slices.Contains(c.commands, "takeoff") }

func RequireOnline(tx *state.Tx, id string) (Capabilities, error) {
	c, err := Admission(tx, id)
	if err == nil && !c.Online {
		err = state.Conflict("asset_offline", "Asset is offline")
	}
	return c, err
}

func RequestSettings(tx *state.Tx, id, by string, settings state.Record) (int64, error) {
	c, err := RequireOnline(tx, id)
	if err != nil {
		return 0, err
	}
	if err = c.CheckSettings(settings); err != nil {
		return 0, err
	}
	return tx.Append("settings.requested", state.Record{"time": tx.Now, "asset_id": id, "settings": settings, "requested_by": by})
}
