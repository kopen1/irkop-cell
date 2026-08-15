-- RATE LIMIT / BRUTE-FORCE LOGIN PROTECTION (R5)
-- Bucket keyed counter dengan fixed window.
-- Hanya menyimpan bucket (IP atau username) + hitungan; TIDAK ada password/credential.
CREATE TABLE login_attempt (
  bucket       TEXT PRIMARY KEY,      -- 'ip:<ip>' | 'user:<username>'
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,         -- ISO timestamp awal window saat ini
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_login_attempt_window ON login_attempt(window_start);