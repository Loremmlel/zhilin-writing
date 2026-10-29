"""Restore a downloaded Zhilin backup locally; Python 3 standard library only."""
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path


def restore(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != "zhilin-backup-v1":
        raise ValueError("Unsupported or incomplete backup")
    with (folder / "database.sql").open("rb") as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != manifest["sqlSha256"]:
        raise ValueError("SQL checksum mismatch")
    for item in manifest["files"]:
        path = folder / item["path"]
        if path.parent != folder / "files" or not path.is_file() or path.stat().st_size != item["size"]:
            raise ValueError("Missing, unsafe or incomplete attachment")
        with path.open("rb") as source:
            digest = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != item["sha256"]:
            raise ValueError("Attachment checksum mismatch")
    target = folder / "zhilin.db"
    # Exclusive creation prevents overwriting a user's existing database.
    with target.open("xb"):
        pass
    try:
        with closing(sqlite3.connect(target)) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("BEGIN")
            with (folder / "database.sql").open(encoding="utf-8") as source:
                statement = ""
                for line in source:
                    statement += line
                    if sqlite3.complete_statement(statement):
                        db.execute(statement)
                        statement = ""
                if statement.strip():
                    raise ValueError("Incomplete SQL statement")
            db.commit()
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("SQLite integrity check failed")
            if db.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("Foreign key check failed")
            for table, count in manifest["rowCounts"].items():
                name = '"' + table.replace('"', '""') + '"'
                if db.execute("SELECT count(*) FROM " + name).fetchone()[0] != count:
                    raise ValueError("Row count mismatch: " + table)
            for table in ("member_passwords", "member_sessions", "login_attempts"):
                if db.execute('SELECT count(*) FROM "' + table + '"').fetchone()[0]:
                    raise ValueError("Unexpected authentication records")
        print("Verified SQLite backup: zhilin.db. Restore attachments using manifest.json; reset local passwords before reopening the site.")
    except BaseException:
        target.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    restore(Path(__file__).resolve().parent)
