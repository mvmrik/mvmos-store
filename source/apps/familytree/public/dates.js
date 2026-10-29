/* Calendar-based family ages. Partial years remain explicitly approximate. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FamilyTreeDates=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function validYear(value){return Number.isInteger(value)&&value>=1&&value<=9999}
  function calendar(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [year,month,day]=value.split('-').map(Number);
    const leap=year%4===0&&(year%100!==0||year%400===0);
    if(!validYear(year)||month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1])return null;
    return {year,month,day};
  }
  function dateInfo(person,event){
    const exact=calendar(person?.[event+'_date']);
    if(exact)return exact;
    return validYear(person?.[event+'_year'])?{year:person[event+'_year']}:null;
  }
  function order(a,b){return a.year-b.year||a.month-b.month||a.day-b.day}
  function stamp(day){const value=new Date(0);value.setUTCFullYear(day.year,day.month-1,day.day);value.setUTCHours(0,0,0,0);return value.getTime()}
  function duration(start,end){
    if(!start||!end||start.year>end.year)return null;
    if(!start.month||!end.month)return {value:end.year-start.year,unit:'year',approximate:true};
    if(order(start,end)>0)return null;
    const years=end.year-start.year-(end.month<start.month||end.month===start.month&&end.day<start.day?1:0);
    if(years)return {value:years,unit:'year',approximate:false};
    const months=(end.year-start.year)*12+end.month-start.month-(end.day<start.day?1:0);
    if(months)return {value:months,unit:'month',approximate:false};
    return {value:Math.round((stamp(end)-stamp(start))/86400000),unit:'day',approximate:false};
  }
  function age(person,today=new Date()){
    const start=dateInfo(person,'birth');
    if(person?.deceased||person?.death_date||person?.death_year)return duration(start,dateInfo(person,'death'));
    if(!(today instanceof Date)||!Number.isFinite(today.getTime()))return null;
    return duration(start,{year:today.getFullYear(),month:today.getMonth()+1,day:today.getDate()});
  }
  function compare(subject,other){
    const a=dateInfo(subject,'birth'),b=dateInfo(other,'birth');
    if(!a||!b)return null;
    const exact=Boolean(a.month&&b.month);
    const difference=exact?order(a,b):a.year-b.year;
    if(!difference)return {direction:exact?'sameDate':'sameYear',approximate:!exact};
    return {direction:difference<0?'younger':'older',...duration(difference<0?a:b,difference<0?b:a)};
  }
  return Object.freeze({age,compare});
});
