import test from 'node:test';
import assert from 'node:assert/strict';
import {withAccountRoles} from '../web/sync.js';

test('linked staff inherits actual account membership: owner > profile default', () => {
  const profiles=[
    {id:'a',auth_user_id:'user-owner',access_role:'therapist',name:'창업자'},
    {id:'b',auth_user_id:'user-manager',access_role:'therapist',name:'매니저'},
    {id:'c',auth_user_id:'user-staff',access_role:'manager',name:'직원'},
    {id:'d',auth_user_id:null,access_role:'therapist',name:'미연결 직원'}
  ];
  const members=[
    {user_id:'user-owner',role:'owner'},
    {user_id:'user-manager',role:'manager'},
    {user_id:'user-staff',role:'therapist'}
  ];
  const actual=withAccountRoles(profiles,members);
  assert.deepEqual(actual.map(x=>x.linked_role),['owner','manager','therapist',null]);
  assert.equal(actual[0].access_role,'therapist','original default persists; actual access is owner');
  assert.equal(actual[1].access_role,'therapist');
  assert.equal(actual[2].access_role,'manager');
});

test('a linked profile without membership never receives phantom access rights', () => {
  const actual=withAccountRoles([{id:'x',auth_user_id:'missing',access_role:'manager'}],[]);
  assert.equal(actual[0].linked_role,null);
});
