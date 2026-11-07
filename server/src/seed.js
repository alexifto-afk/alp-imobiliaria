import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const cpf = (process.env.ADMIN_CPF || '').replace(/\D/g,'');
if (!/^\d{11}$/.test(cpf) || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10) {
  console.error('Configure ADMIN_CPF (11 dígitos) e ADMIN_PASSWORD (mínimo 10 caracteres).'); process.exit(1);
}
const existing = await db.user.findUnique({where:{cpf}});
if (existing && existing.role !== 'ADMIN') { console.error('CPF já pertence a um usuário cliente.'); process.exit(1); }
await db.user.upsert({where:{cpf},update:{name:process.env.ADMIN_NAME||'Administrador',role:'ADMIN',active:true},create:{cpf,name:process.env.ADMIN_NAME||'Administrador',role:'ADMIN',mustChangePassword:false,passwordHash:await bcrypt.hash(process.env.ADMIN_PASSWORD,12)}});
console.log('Administrador disponível. Senha de conta existente não foi alterada.');
await db.$disconnect();
