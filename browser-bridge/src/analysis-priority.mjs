// Publication, first observation and origin are separate clocks. Unknown age
// stays unknown; a recent observation does not make an old post newly published.
export function publicationAgeDays(row, now = Date.now()) {
 const published = typeof row.published === 'number' ? row.published : Date.parse(row.published);
 return Number.isFinite(published) && published > 0 ? Math.max(0,(now-published)/86400000) : null;
}
export function prioritizeAnalysis(rows, now = Date.now()) {
 const terms = row => [...new Set(String(row.content || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])].filter(t=>!['this','that','with','have','your','from','tiktok','foryou','viral','video','like','just'].includes(t));
 const creators = new Map();
 for(const row of rows) for(const term of terms(row)) {const set=creators.get(term)||new Set();set.add(String(row.author||'').toLowerCase());creators.set(term,set);}
 const score = row => {const age=publicationAgeDays(row,now);return (age===null?5:age<=3?40:age<=7?25:age<=14?5:-50)+Math.min(20,terms(row).reduce((n,t)=>n+(creators.get(t).size>1?3:0),0))+Math.min(10,Math.log10(1+Number(row.views||0))*2);};
 return [...rows].sort((a,b)=>score(b)-score(a));
}
export const newEvidenceRows = (before, after) => {const ids=new Set(before.map(row=>row.id));return after.filter(row=>!ids.has(row.id));};
