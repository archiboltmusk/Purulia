import { verifyReading } from '../_shared/system-sensor.mjs';
const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!secret)return json(503,{error:'Ingestion unavailable'});
 try{
  if(Number(req.headers.get('content-length'))>8192)return json(413,{error:'Envelope too large'});
  const reader=req.body?.getReader();if(!reader)return json(400,{error:'Envelope required'});
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();return json(413,{error:'Envelope too large'});}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=new TextDecoder().decode(bytes);
  const envelope=JSON.parse(body);if(Object.keys(envelope).some(k=>!['payload','signature'].includes(k)))return json(400,{error:'Invalid envelope'});
  const payload=envelope.payload;if(!payload||typeof envelope.signature!=='string')return json(400,{error:'Invalid envelope'});
  const rpc=async(name:string,args:unknown)=>{
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
   try{const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:secret,authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(args),signal:controller.signal});if(!response.ok)throw new Error('RPC rejected');return await response.json();}finally{clearTimeout(timeout);}
  };
  const device=await rpc('kasa_system_device_key',{p_device:payload.device_id});
  const verified=await verifyReading(payload,envelope.signature,device);
  const result=await rpc('kasa_system_ingest_verified',{p_device:payload.device_id,p_sequence:payload.sequence,p_measured_at:payload.measured_at,p_value:payload.value,p_hash:verified.payloadHash});
  return json(200,{...result,physicalTruthVerified:false});
 }catch{return json(400,{error:'Reading not accepted. Check signing key, binding, sequence and timestamps.'});}
});
