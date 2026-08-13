-- Catalog sync: widen providers/models for models.dev full ingest + gated layers
-- Providers now hold 184 catalog rows; popular enabled=1, rest enabled=0 (faded in admin).
-- Models store every modality/cost field models.dev exposes.

-- Providers: add source so live vs catalog is auditable; protocol already covers all
ALTER TABLE providers ADD COLUMN catalog_source TEXT DEFAULT 'manual';
ALTER TABLE providers ADD COLUMN doc_url TEXT;

-- Models: already has category/modalities/pricing/reasoning; add lab/family/open_weights for catalog tags
ALTER TABLE models ADD COLUMN family TEXT;
ALTER TABLE models ADD COLUMN lab TEXT;
ALTER TABLE models ADD COLUMN open_weights INTEGER DEFAULT 0;
ALTER TABLE models ADD COLUMN knowledge_cutoff TEXT;
ALTER TABLE models ADD COLUMN catalog_source TEXT DEFAULT 'catalog';
