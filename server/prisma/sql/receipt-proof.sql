-- Executar no mesmo banco/branch Neon de DATABASE_URL, antes de publicar a API.
BEGIN;
ALTER TABLE public."Receipt" ADD COLUMN IF NOT EXISTS "fileData" BYTEA;
ALTER TABLE public."Receipt" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE public."Installment" ADD COLUMN IF NOT EXISTS "manualReceiptEnabled" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
