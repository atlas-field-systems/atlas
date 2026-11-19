package administration

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"github.com/atlas-field-systems/atlas/core/internal/state"
)

func CreateAccount(tx *state.Tx, id string, admin bool, hash string) error {
	var taken bool
	err := tx.QueryRow(`SELECT EXISTS(
        SELECT 1 FROM accounts WHERE operator_id=?1
        UNION ALL SELECT 1 FROM asset_keys WHERE key_id=?1
        UNION ALL SELECT 1 FROM gateways WHERE gateway_id=?1 AND removed=0
        UNION ALL SELECT 1 FROM plugins WHERE plugin_id=?1 AND removed=0)`, id).Scan(&taken)
	if err != nil {
		return err
	}
	if taken {
		return state.Conflict("id_taken", "That identity is in use")
	}
	_, err = tx.Exec("INSERT INTO accounts VALUES (?,?,?)", id, admin, hash)
	return err
}

func DeleteAccount(tx *state.Tx, id string) error {
	result, err := tx.Exec("DELETE FROM accounts WHERE operator_id=?", id)
	return requireRow(result, err, "No such account")
}

func PasswordHash(tx *sql.Tx, id string) (string, error) {
	var hash string
	err := tx.QueryRow("SELECT password_hash FROM accounts WHERE operator_id=?", id).Scan(&hash)
	return hash, err
}

func StartSession(tx *state.Tx, id string) (string, error) {
	key, err := RandomToken(32, base64.RawURLEncoding)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec("INSERT INTO sessions(token_hash,run_id,operator_id,created_at) VALUES (?,?,?,?)", Digest(key), tx.ID, id, tx.Now)
	return key, err
}

func EndSession(tx *state.Tx, tokenHash string) error {
	_, err := tx.Exec("UPDATE sessions SET ended=1 WHERE token_hash=? AND run_id=?", tokenHash, tx.ID)
	return err
}

func KeyOwner(tx *sql.Tx, token string) (kind, id string, err error) {
	err = tx.QueryRow(`SELECT 'asset',key_id FROM asset_keys WHERE key_hash=?1
        UNION ALL SELECT 'gateway',gateway_id FROM gateways WHERE key_hash=?1 AND removed=0
        UNION ALL SELECT 'plugin',plugin_id FROM plugins WHERE key_hash=?1 AND removed=0`, Digest(token)).Scan(&kind, &id)
	return
}

func SessionOwner(tx *sql.Tx, run int64, hash string) (id string, admin, ended bool, err error) {
	err = tx.QueryRow(`SELECT operator_id,admin,ended FROM sessions JOIN accounts USING(operator_id)
        WHERE run_id=? AND token_hash=?`, run, hash).Scan(&id, &admin, &ended)
	return
}

func Bootstrap(ctx context.Context, s *state.Run) error {
	a := s.Config.FirstAdmin
	if a == nil {
		return nil
	}
	return s.Store.Write(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM accounts)").Scan(&exists); err != nil || exists {
			return err
		}
		b, err := os.ReadFile(a.PasswordFile)
		if err != nil {
			return err
		}
		password := strings.TrimSuffix(string(b), "\n")
		if strings.HasSuffix(string(b), "\r\n") {
			password = strings.TrimSuffix(password, "\r")
		}
		if err = s.Protocol.Check("requests.account", state.Record{"operator_id": a.OperatorID, "admin": true, "password": password}); err != nil {
			return fmt.Errorf("first_admin.password_file: %w", err)
		}
		hash, err := HashPassword(password)
		if err != nil {
			return err
		}
		_, err = tx.Exec("INSERT INTO accounts VALUES (?,1,?)", a.OperatorID, hash)
		return err
	})
}
