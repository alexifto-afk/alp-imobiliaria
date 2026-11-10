import {isValidCpf} from './cpf.js';

const badRequest=message=>Object.assign(new Error(message),{status:400});
export function clientIdentity(body={}) {
  const name=String(body.name??'').trim();
  if(!name)throw badRequest('Informe o nome do cliente.');
  if(!isValidCpf(body.cpf))throw badRequest('CPF inválido. Confira os dígitos informados.');
  const spouse=String(body.spouseCpf??'').trim();
  if(spouse&&!isValidCpf(spouse))throw badRequest('CPF do cônjuge inválido. Confira os dígitos informados.');
  return {name,cpf:String(body.cpf).replace(/\D/g,''),spouseCpf:spouse?spouse.replace(/\D/g,''):null};
}

export function registerClientWriteRoutes(app,{db,hashPassword,clientFields,auth,current,admin}) {
  const duplicate=res=>res.status(409).json({error:'CPF já cadastrado. Confira o cliente existente.'});
  const wrap=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(error=>{
    const target=error.meta?.target;
    if(error.code==='P2002'&&(Array.isArray(target)?target.includes('cpf'):String(target||'').includes('cpf')))return duplicate(res);
    next(error);
  });
  app.post('/api/clients',auth,current,admin,wrap(async(req,res)=>{
    const body=req.body||{},identity=clientIdentity(body),password=String(body.password||'');
    if(password.length<8)throw badRequest('Senha precisa ter ao menos 8 caracteres.');
    if(await db.user.findUnique({where:{cpf:identity.cpf}}))return duplicate(res);
    const out=await db.user.create({data:{
      name:identity.name,cpf:identity.cpf,passwordHash:await hashPassword(password),
      role:'CLIENT',mustChangePassword:true,
      client:{create:{...clientFields(body),spouseCpf:identity.spouseCpf}}
    },include:{client:true}});
    res.status(201).json({id:out.client.id});
  }));
  app.put('/api/clients/:id',auth,current,admin,wrap(async(req,res)=>{
    const client=await db.client.findUnique({where:{id:req.params.id}});
    if(!client)return res.status(404).json({error:'Cliente não encontrado'});
    const body=req.body||{},identity=clientIdentity(body);
    const owner=await db.user.findUnique({where:{cpf:identity.cpf}});
    if(owner&&owner.id!==client.userId)return duplicate(res);
    await db.$transaction(async tx=>{
      await tx.user.update({where:{id:client.userId},data:{name:identity.name,cpf:identity.cpf}});
      await tx.client.update({where:{id:client.id},data:{...clientFields(body),spouseCpf:identity.spouseCpf}});
    });
    res.json({ok:true});
  }));
}
