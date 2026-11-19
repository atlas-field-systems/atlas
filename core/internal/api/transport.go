// The HTTP parser can reject a malformed request target before routing. Give
// those 400 responses the same JSON representation as application refusals.
package api

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

type listener struct{ net.Listener }
type connection struct {
	net.Conn
	handling atomic.Bool
}

type connKey struct{}

func (l listener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &connection{Conn: c}, nil
}

func (c *connection) Write(b []byte) (int, error) {
	if !c.handling.Load() && bytes.HasPrefix(b, []byte("HTTP/1.1 400 Bad Request\r\n")) {
		_, err := io.WriteString(c.Conn, "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{\"error\":\"invalid\",\"explanation\":\"Malformed HTTP request\"}\n")
		if err != nil {
			return 0, err
		}
		return len(b), nil
	}
	return c.Conn.Write(b)
}

func (s *Server) HTTP(l net.Listener) (*http.Server, net.Listener) {
	return &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 30 * time.Second,
		ConnContext: func(ctx context.Context, c net.Conn) context.Context {
			return context.WithValue(ctx, connKey{}, c.(*connection))
		},
		ConnState: func(c net.Conn, state http.ConnState) {
			if state == http.StateIdle {
				c.(*connection).handling.Store(false)
			}
		},
	}, listener{l}
}
