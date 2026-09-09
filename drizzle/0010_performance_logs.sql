CREATE TABLE performance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  request_id TEXT,
  record TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX performance_logs_request_id ON performance_logs(request_id);
--> statement-breakpoint
CREATE TRIGGER performance_logs_cap AFTER INSERT ON performance_logs
BEGIN
  DELETE FROM performance_logs WHERE id <= NEW.id - 5000;
END;
