export function clamp(value:number,min:number,max:number):number{if(min>max)throw new RangeError("min must not exceed max");return Math.min(Math.max(value,min),max);}
export function inRange(value:number,min:number,max:number):boolean{if(min>max)throw new RangeError("min must not exceed max");return value>=min&&value<=max;}
export function roundTo(value:number,decimals=0):number{if(!Number.isInteger(decimals)||decimals<0)throw new RangeError("decimals must be a non-negative integer");const factor=10**decimals;return Math.round((value+Number.EPSILON)*factor)/factor;}
export function isFiniteNumber(value:unknown):value is number{return typeof value==="number"&&Number.isFinite(value);}
export function sum(values:readonly number[]):number{return values.reduce((total,value)=>total+value,0);}