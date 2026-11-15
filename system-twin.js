/* Exploratory 0-D models. No operational controls or calibrated forecasts. */
(function(root){'use strict';
function values(input,keys){for(const k of keys)if(typeof input[k]!=='number'||!Number.isFinite(input[k])||input[k]<0)throw new TypeError('Missing or invalid '+k);}
function waterBalance(input){
 values(input,['inflowLps','outflowLps','storageLitres','capacityLitres','durationMinutes']);if(!input.capacityLitres||input.storageLitres>input.capacityLitres||input.durationMinutes>1440)throw new TypeError('Check capacity, initial storage and duration (maximum one day)');
 const change=(input.inflowLps-input.outflowLps)*input.durationMinutes*60,raw=input.storageLitres+change;
 return {model:'water-balance-0d-v1',classification:'exploratory',storageLitres:Math.min(input.capacityLitres,Math.max(0,raw)),overflowLitres:Math.max(0,raw-input.capacityLitres),unservedLitres:Math.max(0,-raw),assumptions:'Constant flows; no pressure, pipe topology, leakage location, contamination or control-system model.',operationalAdvice:false};
}
function rainfallStorage(input){
 values(input,['rainMm','catchmentM2','runoffCoefficient','drainLps','storageLitres','durationMinutes','blockedFraction']);
 if(input.runoffCoefficient>1||input.blockedFraction>1||!input.durationMinutes||input.durationMinutes>1440)throw new TypeError('Use fractions 0–1 and a duration up to one day');
 const incoming=input.rainMm*input.catchmentM2*input.runoffCoefficient,drained=input.drainLps*(1-input.blockedFraction)*input.durationMinutes*60,excess=Math.max(0,incoming-drained-input.storageLitres);
 return {model:'storm-storage-0d-v1',classification:'exploratory',incomingLitres:incoming,drainCapacityLitres:drained,excessLitres:excess,assumptions:'Uniform event rainfall and runoff; constant drainage. Not a calibrated flood, street-depth, evacuation or reservoir-release forecast.',operationalAdvice:false};
}
function readingState(reading,device,now=Date.now()){
 if(!reading||!device)return {usable:false,state:'No connected reading'};
 if(device.active===false)return {usable:false,state:'Device inactive'};
 if(device.revoked)return {usable:false,state:'Key revoked'};
 if(reading.signature_verified!==true)return {usable:false,state:'Signature not verified'};
 if(!device.calibration_until||Date.parse(device.calibration_until)<=now)return {usable:false,state:'Calibration expired or unknown'};
 const age=now-Date.parse(reading.measured_at);if(!Number.isFinite(age)||age< -120000)return {usable:false,state:'Invalid observation time'};
 if(age>Math.min(3600,device.max_age_seconds||300)*1000)return {usable:false,state:'Stale reading'};
 if(reading.quality&&reading.quality!=='in_range')return {usable:false,state:'Reading requires review: '+reading.quality};
 return {usable:true,state:'Authenticated reading; physical correctness still requires calibration and independent checks'};
}
const api={waterBalance,rainfallStorage,readingState};if(typeof module==='object'&&module.exports)module.exports=api;else root.ParishkarTwin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
