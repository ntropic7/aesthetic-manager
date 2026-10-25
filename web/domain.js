/** Pure domain rules. UI and backend should ultimately share these contracts. */
export const asMins = text => {const [h,m]=String(text).split(':').map(Number);return h*60+m;};
export const blocksTime = item => !item.archived && !['CANCELLED','NO_SHOW'].includes(item.status);
export function bookingConflict(appointments,candidate,ignoreId){
  if(!blocksTime(candidate))return null;
  const start=asMins(candidate.time),end=start+Number(candidate.minutes);
  return appointments.find(r=>r.id!==ignoreId&&r.date===candidate.date&&blocksTime(r)&&
    start<asMins(r.time)+Number(r.minutes)&&end>asMins(r.time)&&
    (r.staff===candidate.staff||r.room===candidate.room))||null;
}
export function validateSlot(candidate,open=540,close=1260){
  const mins=asMins(candidate.time),duration=Number(candidate.minutes);
  return Number.isFinite(mins)&&Number.isFinite(duration)&&duration>=15&&mins%15===0&&mins>=open&&mins+duration<=close;
}
export const remainingVisits = membership => membership?Math.max(0,membership.total-membership.used):0;
export const revenueTotal = payments => payments.filter(x=>!x.voided).reduce((sum,x)=>sum+Number(x.amount||0),0);
