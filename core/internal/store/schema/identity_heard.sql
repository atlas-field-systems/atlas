CREATE TABLE IF NOT EXISTS identity_heard (
      run_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      time INTEGER NOT NULL, PRIMARY KEY(run_id,kind,id)
    );
