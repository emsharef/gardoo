-- Backfill dimensions from notes field
UPDATE zones SET dimensions = regexp_replace(notes, '.*Dimensions: ([^;]+).*', '\1')
  WHERE notes LIKE '%Dimensions: %' AND dimensions IS NULL;

-- Clean up the Dimensions: entry from notes
UPDATE zones SET notes = regexp_replace(notes, '(; )?Dimensions: [^;]+', '')
  WHERE notes LIKE '%Dimensions: %';

-- Null out empty notes
UPDATE zones SET notes = NULL WHERE notes = '';
