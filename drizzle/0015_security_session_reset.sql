-- Raw legacy session compatibility made database hashes replayable. All
-- existing sessions must be invalidated when the fixed lookup ships.
DELETE FROM sessions;
