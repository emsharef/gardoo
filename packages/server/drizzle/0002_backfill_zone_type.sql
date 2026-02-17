-- Backfill zone_type from notes field
UPDATE zones SET zone_type = regexp_replace(notes, '.*Type: ([^;]+).*', '\1')
  WHERE notes LIKE '%Type: %' AND zone_type IS NULL;

-- Clean up the Type: entry from notes
UPDATE zones SET notes = regexp_replace(notes, '(; )?Type: [^;]+', '')
  WHERE notes LIKE '%Type: %';

-- Null out empty notes
UPDATE zones SET notes = NULL WHERE notes = '';
