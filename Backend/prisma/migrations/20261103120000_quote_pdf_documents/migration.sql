BEGIN;

-- Referencia recuperable independiente del contenido comercial inmutable.
CREATE TABLE public.quote_pdf_documents (
  quote_version_id bigint PRIMARY KEY REFERENCES public.quote_versions(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE,
  file_name varchar(100) NOT NULL,
  mime_type varchar(50) NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  document_model jsonb NOT NULL,
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  time_zone varchar(64) NOT NULL,
  layout_revision integer NOT NULL CHECK (layout_revision > 0),
  bucket text,
  content_hash char(64) CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  size_bytes integer CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'error')),
  generated_at timestamptz,
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  error_code varchar(64),
  CONSTRAINT chk_quote_pdf_lease CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CONSTRAINT chk_quote_pdf_available CHECK (status <> 'available' OR
    (bucket IS NOT NULL AND content_hash IS NOT NULL AND size_bytes IS NOT NULL
      AND generated_at IS NOT NULL AND stored_at IS NOT NULL AND lease_token IS NULL AND error_code IS NULL))
);

-- No cambia quote_versions ni hace transferencias/backfill contra Storage.
CREATE FUNCTION public.protect_quote_pdf_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'El documento reservado debe conservarse para recuperación.' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.quote_version_id, NEW.object_key, NEW.file_name, NEW.mime_type, NEW.document_model,
         NEW.source_hash, NEW.time_zone, NEW.layout_revision, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.quote_version_id, OLD.object_key, OLD.file_name, OLD.mime_type, OLD.document_model,
         OLD.source_hash, OLD.time_zone, OLD.layout_revision, OLD.created_at)
     OR (OLD.bucket IS NOT NULL AND NEW.bucket IS DISTINCT FROM OLD.bucket)
     OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)
     OR (OLD.size_bytes IS NOT NULL AND NEW.size_bytes IS DISTINCT FROM OLD.size_bytes) THEN
    RAISE EXCEPTION 'La identidad y la instantánea del PDF son inmutables.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.protect_quote_pdf_identity() FROM PUBLIC;
CREATE TRIGGER quote_pdf_identity_immutable BEFORE UPDATE OR DELETE ON public.quote_pdf_documents
  FOR EACH ROW EXECUTE FUNCTION public.protect_quote_pdf_identity();

ALTER TABLE public.quote_pdf_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quote_pdf_documents FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.quote_pdf_documents FROM anon, authenticated, service_role';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.quote_pdf_documents FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
