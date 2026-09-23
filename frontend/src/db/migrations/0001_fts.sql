-- Full-text search over sources (PRD §37). External-content FTS5 table kept in sync by triggers.
CREATE VIRTUAL TABLE `sources_fts` USING fts5(
  title, creator_name, platform, original_url, description,
  content='media_sources', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `media_sources_ai` AFTER INSERT ON `media_sources` BEGIN
  INSERT INTO sources_fts(rowid, title, creator_name, platform, original_url, description)
  VALUES (new.rowid, new.title, new.creator_name, new.platform, new.original_url, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `media_sources_ad` AFTER DELETE ON `media_sources` BEGIN
  INSERT INTO sources_fts(sources_fts, rowid, title, creator_name, platform, original_url, description)
  VALUES ('delete', old.rowid, old.title, old.creator_name, old.platform, old.original_url, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER `media_sources_au` AFTER UPDATE OF title, creator_name, platform, original_url, description ON `media_sources` BEGIN
  INSERT INTO sources_fts(sources_fts, rowid, title, creator_name, platform, original_url, description)
  VALUES ('delete', old.rowid, old.title, old.creator_name, old.platform, old.original_url, old.description);
  INSERT INTO sources_fts(rowid, title, creator_name, platform, original_url, description)
  VALUES (new.rowid, new.title, new.creator_name, new.platform, new.original_url, new.description);
END;
