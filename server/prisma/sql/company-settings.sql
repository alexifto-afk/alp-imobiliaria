-- Executar no mesmo banco/branch Neon usado por DATABASE_URL da API.
BEGIN;
CREATE TABLE IF NOT EXISTS public."CompanySetting" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "name" TEXT NOT NULL,
  "logo" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("id")
);
COMMIT;
