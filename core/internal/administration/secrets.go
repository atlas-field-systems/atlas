package administration

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"strings"

	"golang.org/x/crypto/scrypt"
)

func RandomToken(n int, encoding *base64.Encoding) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return encoding.EncodeToString(b), nil
}

func Digest(value string) string { d := sha256.Sum256([]byte(value)); return hex.EncodeToString(d[:]) }

const hashPrefix = "scrypt$16384$8$1$"

func HashPassword(password string) (string, error) {
	salt, err := RandomToken(16, base64.StdEncoding)
	if err != nil {
		return "", err
	}
	hash, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return hashPrefix + salt + "$" + base64.StdEncoding.EncodeToString(hash), nil
}

func VerifyPassword(stored, password string) bool {
	suffix, ok := strings.CutPrefix(stored, hashPrefix)
	if !ok {
		return false
	}
	salt, encoded, ok := strings.Cut(suffix, "$")
	if !ok {
		return false
	}
	expected, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(expected) != 64 {
		return false
	}
	actual, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}
