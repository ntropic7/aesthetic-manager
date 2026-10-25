import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingConflict,validateSlot,remainingVisits,revenueTotal} from '../web/domain.js';
const a={id:'A',date:'2026-10-25',time:'10:00',minutes:90,staff:'관리사1',room:'A',status:'CONFIRMED'};
test('same staff or same room cannot overlap',()=>{
 assert.equal(bookingConflict([a],{...a,id:'B',time:'11:00',room:'B'},'B')?.id,'A');
 assert.equal(bookingConflict([a],{...a,id:'B',time:'11:00',staff:'관리사2'},'B')?.id,'A');
 assert.equal(bookingConflict([a],{...a,id:'B',time:'11:30'},'B'),null);
 assert.equal(bookingConflict([{...a,status:'NO_SHOW'}],{...a,id:'B'},'B'),null);
 assert.equal(bookingConflict([a],{...a,id:'B',status:'CANCELLED'},'B'),null);
});
test('appointment boundaries and visits',()=>{
 assert.equal(validateSlot({...a,time:'08:45'}),false);
 assert.equal(validateSlot({...a,time:'20:30',minutes:90}),false);
 assert.equal(validateSlot(a),true);
 assert.equal(remainingVisits({total:10,used:4}),6);
});
test('cancelled payments must not count toward revenue',()=>{
 assert.equal(revenueTotal([{amount:200000,voided:false},{amount:100000,voided:true}]),200000);
});
