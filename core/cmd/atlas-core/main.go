package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/atlas-field-systems/atlas/core/internal/administration"
	"github.com/atlas-field-systems/atlas/core/internal/api"
	"github.com/atlas-field-systems/atlas/core/internal/clock"
	"github.com/atlas-field-systems/atlas/core/internal/config"
	"github.com/atlas-field-systems/atlas/core/internal/diagnostics"
	"github.com/atlas-field-systems/atlas/core/internal/fusion"
	"github.com/atlas-field-systems/atlas/core/internal/objects"
	"github.com/atlas-field-systems/atlas/core/internal/protocol"
	"github.com/atlas-field-systems/atlas/core/internal/reset"
	"github.com/atlas-field-systems/atlas/core/internal/state"
	"github.com/atlas-field-systems/atlas/core/internal/store"
)

func main() {
	signals, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	path := "/etc/atlas-core/config.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	cfg, err := config.Read(path, os.Environ())
	if err != nil {
		fmt.Fprintln(os.Stderr, "config", err)
		os.Exit(2)
	}
	var host *clock.Host
	var source clock.Source = clock.System{}
	if len(os.Args) == 3 && os.Args[2] == "--host-clock" {
		host = clock.NewHost(os.NewFile(3, "atlas-host"))
		source = host
	}
	if err = run(signals, cfg, source, host); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(signals context.Context, c config.Config, source clock.Source, host *clock.Host) error {
	if err := c.PrepareDirs(); err != nil {
		return err
	}
	p, err := protocol.Start()
	if err != nil {
		return err
	}
	db, err := store.Open(filepath.Join(c.DataDirectory, "core.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	exporter := reset.Exporter{Clock: source, Config: c, Store: db, Versions: p.Versions}
	ctx := context.Background()
	if err = exporter.Recover(ctx); err != nil {
		return err
	}
	current, err := db.BeginRun(ctx, source.Now().UnixMilli(), func(id int64) (int64, error) { return diagnostics.LastTime(c.LogDirectory, id) })
	if err != nil {
		return err
	}
	log, err := diagnostics.Open(c, current.ID, source)
	if err != nil {
		return err
	}
	defer log.Close()
	core := &api.Server{Fusion: fusion.OnePerObservation, Run: &state.Run{Config: c, Log: log, Clock: source, Run: current, Protocol: p, Store: db}}
	if err = objects.CleanUploads(ctx, core.Run); err != nil {
		return err
	}
	if err = administration.Bootstrap(ctx, core.Run); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(c.ListenAddress, strconv.Itoa(c.Port)))
	if err != nil {
		return err
	}
	defer listener.Close()
	debugPath, err := core.PrepareDebug()
	if err != nil {
		return err
	}

	reloadCtx, endReload := context.WithCancel(ctx)
	var reload sync.WaitGroup
	stopReload := func() { endReload(); reload.Wait() }
	defer stopReload()
	scheme := "http"
	if c.TLSKey != nil {
		scheme = "https"
		var cert atomic.Pointer[tls.Certificate]
		load := func() error {
			pair, err := tls.LoadX509KeyPair(*c.TLSCertificate, *c.TLSKey)
			if err == nil {
				cert.Store(&pair)
			}
			return err
		}
		if err = load(); err != nil {
			return err
		}
		listener = tls.NewListener(listener, &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) { return cert.Load(), nil }})
		ticker := source.At(source.Now().Add(time.Hour))
		reload.Add(1)
		go func() {
			defer reload.Done()
			defer func() { ticker.Cancel() }()
			for {
				select {
				case <-reloadCtx.Done():
					return
				case <-ticker.C:
					fired := ticker
					ticker = source.At(source.Now().Add(time.Hour))
					if err := load(); err != nil {
						log.Record("error", "tls", "certificate reload failed", nil)
					}
					fired.Cancel()
				}
			}
		}()
	}
	server, listener := core.HTTP(listener)
	followCtx, endFollow := context.WithCancel(ctx)
	ready, finished := make(chan error, 1), make(chan struct{})
	go func() { defer close(finished); core.Follow(followCtx, ready) }()
	defer func() { endFollow(); <-finished }()
	if err = <-ready; err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	msg := "run started"
	if current.Resumed {
		msg = "run resumed"
	}
	log.Record("info", "core", msg, map[string]any{"run_id": current.ID, "versions": p.Versions, "config": c.Redacted()})
	baseURL := scheme + "://" + listener.Addr().String()
	var debugURL any
	if debugPath != "" {
		debugURL = baseURL + debugPath
	}
	if err = json.NewEncoder(os.Stdout).Encode(map[string]any{"url": baseURL, "run_id": current.ID, "debug_url": debugURL}); err != nil {
		return err
	}
	var stopRequest <-chan struct{}
	if host != nil {
		stopRequest = host.Stopping()
	}
	select {
	case <-stopRequest:
	case err = <-done:
		return err
	case <-signals.Done():
	}
	stopReload()
	core.BeginStop()
	if host != nil {
		<-host.Grace()
	} else {
		<-source.At(source.Now().Add(5 * time.Second)).C
	}
	core.CommitsClosed.Store(true)
	if err = server.Close(); err != nil {
		return err
	}
	if err = <-done; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	core.Wait()
	endFollow()
	<-finished
	if err = fusion.Drain(ctx, core.Run, core.Fusion); err != nil {
		return err
	}
	log.Record("info", "reset", "run stopped", map[string]any{"run_id": current.ID})
	log.Flush()
	zip, err := exporter.Stop(ctx, current, log.Gaps())
	if err != nil {
		log.Record("error", "reset", "Reset ZIP failed", map[string]any{"explanation": err.Error()})
	}
	if host != nil {
		if err != nil {
			json.NewEncoder(os.Stdout).Encode(map[string]any{"archived": false, "explanation": err.Error()})
		} else {
			json.NewEncoder(os.Stdout).Encode(map[string]any{"archived": true, "zip": zip})
		}
	}
	return err
}
