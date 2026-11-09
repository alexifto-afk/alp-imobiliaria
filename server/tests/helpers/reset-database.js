export function resetDatabase(now) {
 let state={user:{id:'usuario-teste',cpf:'00000000000',active:true,passwordHash:'hash-antigo',mustChangePassword:true,client:{email:'cliente@example.com'}},resets:[]};
 let queue=Promise.resolve();
 function matches(row,where={}){
  return Object.entries(where).every(([key,value])=>{
   const actual=row[key];
   if(value!==null&&typeof value==='object'&&!(value instanceof Date)){
    if('gte' in value&&!(actual>=value.gte))return false;
    if('gt' in value&&!(actual>value.gt))return false;
    if('lt' in value&&!(actual<value.lt))return false;
    if('not' in value&&actual===value.not)return false;
    return true;
   }
   return actual===value;
  });
 }
 function client(read){
  return {
   $queryRaw:async()=>[],
   user:{
    findUnique:async({where})=>{const user=read().user;return user&&matches(user,where)?structuredClone(user):null},
    update:async({data})=>{Object.assign(read().user,data);return structuredClone(read().user)}
   },
   passwordReset:{
    findFirst:async({where})=>structuredClone(read().resets.filter(r=>matches(r,where)).sort((a,b)=>b.createdAt-a.createdAt)[0]||null),
    create:async({data})=>{const row={id:'reset-'+(read().resets.length+1),createdAt:new Date(now()),usedAt:null,attempts:0,...data};read().resets.push(row);return structuredClone(row)},
    updateMany:async({where,data})=>{let count=0;for(const r of read().resets)if(matches(r,where)){for(const [k,v]of Object.entries(data))r[k]=v&&typeof v==='object'&&'increment'in v?r[k]+v.increment:v;count++}return {count}},
    delete:async({where})=>{read().resets=read().resets.filter(r=>!matches(r,where))}
   }
  };
 }
 const db=client(()=>state);
 db.$transaction=fn=>{
  const run=queue.then(async()=>{
   const draft=structuredClone(state);
   const result=await fn(client(()=>draft));
   state=draft;return result;
  });
  queue=run.catch(()=>{});
  return run;
 };
 return {db,get state(){return state}};
}
