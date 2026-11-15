// Canonical Ed25519 packet verification. Authentication is not physical truth.
const units={flow_lps:'L/s',water_level_m:'m',pressure_kpa:'kPa',rain_mm:'mm',temperature_c:'C',power_kw:'kW',vibration_mms:'mm/s',tds_ppm:'ppm'};
const fields=['version','device_id','key_id','node_id','metric','unit','sequence','measured_at','value','nonce'];
export function canonicalReading(p){
 const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
 if(!p||Object.keys(p).length!==fields.length||Object.keys(p).some(k=>!fields.includes(k))||p.version!==1||!['device_id','key_id','node_id'].every(k=>uuid(p[k]))||!Object.hasOwn(units,p.metric)||units[p.metric]!==p.unit||!Number.isSafeInteger(p.sequence)||p.sequence<1||!Number.isFinite(p.value)||Math.abs(p.value)>1e12||typeof p.measured_at!=='string'||!Number.isFinite(Date.parse(p.measured_at))||new Date(p.measured_at).toISOString()!==p.measured_at||typeof p.nonce!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(p.nonce))throw new TypeError('Invalid sensor packet');
 return JSON.stringify(fields.map(k=>p[k]));
}
export async function verifyReading(payload,signature,device,now=Date.now()){
 const canonical=canonicalReading(payload);
 if(!device||device.active!==true||device.revoked||['device_id','key_id','node_id','metric','unit'].some(k=>payload[k]!==device[k==='device_id'?'id':k]))throw new Error('Device binding rejected');
 const age=now-Date.parse(payload.measured_at);if(age< -120000||age>86400000)throw new Error('Packet time rejected');
 const decode=(s,n)=>{if(typeof s!=='string'||s.length>100)throw new TypeError('Invalid key/signature');const bytes=Uint8Array.from(atob(s),c=>c.charCodeAt(0));if(bytes.length!==n)throw new TypeError('Invalid key/signature length');return bytes;};
 const key=await crypto.subtle.importKey('raw',decode(device.public_key,32),{name:'Ed25519'},false,['verify']);
 const bytes=new TextEncoder().encode(canonical);
 if(!await crypto.subtle.verify('Ed25519',key,decode(signature,64),bytes))throw new Error('Signature rejected');
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return {signatureVerified:true,physicalTruthVerified:false,payloadHash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
}
