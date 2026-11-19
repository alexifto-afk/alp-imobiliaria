import sharp from 'sharp';
export const DEFAULT_COMPANY_NAME='A.L.P Imobiliária';
const invalid=message=>Object.assign(new Error(message),{status:400});
export async function getCompany(db){
 if(!db.companySetting)return {name:DEFAULT_COMPANY_NAME,logo:null,configured:false};
 try{
  const row=await db.companySetting.findUnique({where:{id:'main'}});
  return {name:row?.name||DEFAULT_COMPANY_NAME,logo:row?.logo||null,configured:true};
 }catch(error){
  if(error.code==='P2021')return {name:DEFAULT_COMPANY_NAME,logo:null,configured:false};
  throw error;
 }
}
export async function normalizeCompany(body){
 const name=typeof body?.name==='string'?body.name.trim().replace(/\s+/g,' '):'';
 if(name.length<2||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw invalid('Informe um nome de empresa entre 2 e 80 caracteres.');
 if(!Object.hasOwn(body,'logo'))return {name};
 if(body.logo===null)return {name,logo:null};
 if(typeof body.logo!=='string'||body.logo.length>2800000)throw invalid('Envie uma imagem PNG, JPEG ou WebP de até 2 MB.');
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.logo);
 if(!match)throw invalid('Envie uma imagem PNG, JPEG ou WebP.');
 const buffer=Buffer.from(match[2],'base64');
 if(buffer.length>2*1024*1024)throw invalid('A logomarca deve ter até 2 MB.');
 const signatures={png:buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg:buffer[0]===255&&buffer[1]===216&&buffer[2]===255,webp:buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'};
 if(!signatures[match[1]])throw invalid('O conteúdo da imagem não corresponde ao formato informado.');
 try{
  const image=sharp(buffer,{limitInputPixels:16000000,failOn:'warning'}),meta=await image.metadata();
  if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)throw Error('Formato inválido');
  // JPEG estático, sem metadados; dimensões fixas também servem ao PDF do navegador.
  const output=await image.rotate().resize(330,220,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();
  return {name,logo:'data:image/jpeg;base64,'+output.toString('base64')};
 }catch{throw invalid('Imagem inválida. Escolha uma imagem estática PNG, JPEG ou WebP.');}
}
export function registerCompanyRoutes(app,{db,auth,current,admin}){
 const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(error=>{
  if(error.status===400)return res.status(400).json({error:error.message});
  res.status(503).json({error:error.code==='P2021'?'Execute o SQL das configurações da empresa no Neon antes de salvar.':'Não foi possível acessar as configurações da empresa. Tente novamente.'});
 });
 app.get('/api/company',wrap(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.json(await getCompany(db));
 }));
 app.put('/api/company',auth,current,admin,wrap(async(req,res)=>{
  const data=await normalizeCompany(req.body);
  const row=await db.companySetting.upsert({where:{id:'main'},create:{id:'main',...data},update:data});
  res.setHeader('Cache-Control','no-store');res.json({name:row.name,logo:row.logo,configured:true});
 }));
}
