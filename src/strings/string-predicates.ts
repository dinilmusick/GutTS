export function isBlank(value:string):boolean{return value.trim().length===0;}
export function isNonBlank(value:string):boolean{return !isBlank(value);}
export function isEmail(value:string):boolean{return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
export function startsWithAny(value:string,prefixes:readonly string[]):boolean{return prefixes.some(prefix=>value.startsWith(prefix));}
export function endsWithAny(value:string,suffixes:readonly string[]):boolean{return suffixes.some(suffix=>value.endsWith(suffix));}