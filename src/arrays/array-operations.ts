export function compact<T>(values:readonly(T|null|undefined)[]):T[]{return values.filter((value):value is T=>value!=null);}
export function unique<T>(values:readonly T[]):T[]{return [...new Set(values)];}
export function chunk<T>(values:readonly T[],size:number):T[][]{if(!Number.isInteger(size)||size<=0)throw new RangeError("size must be a positive integer");const result:T[][]=[];for(let i=0;i<values.length;i+=size)result.push(values.slice(i,i+size));return result;}
export function flatten<T>(values:readonly(T|readonly T[])[]):T[]{return values.flatMap(value=>Array.isArray(value)?value:[value]);}
export function last<T>(values:readonly T[]):T|undefined{return values.at(-1);}