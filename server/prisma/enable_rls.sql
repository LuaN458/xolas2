-- Ativação do Row Level Security (RLS) nas tabelas do schema public
-- Previne acesso público não autorizado via API PostgREST do Supabase
ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Server" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Channel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Message" ENABLE ROW LEVEL SECURITY;

-- Índices cobridores para as chaves estrangeiras (otimização de consultas e joins)
CREATE INDEX IF NOT EXISTS "Channel_serverId_idx" ON "public"."Channel"("serverId");
CREATE INDEX IF NOT EXISTS "Member_serverId_idx" ON "public"."Member"("serverId");
CREATE INDEX IF NOT EXISTS "Message_channelId_idx" ON "public"."Message"("channelId");
CREATE INDEX IF NOT EXISTS "Message_userId_idx" ON "public"."Message"("userId");
CREATE INDEX IF NOT EXISTS "Server_ownerId_idx" ON "public"."Server"("ownerId");
