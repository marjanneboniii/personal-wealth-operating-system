// Regression tests for the security audit remediations.
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
let cookie: string | null = null;
mock.module('next/headers', { namedExports: {
  cookies: async () => ({ get: () => cookie ? {value: cookie} : undefined, set: () => {} }),
  headers: async () => new Headers(),
}});
mock.module('next/cache', { namedExports: { revalidatePath: () => {} } });

test('Audit remediations in disposable memory database', async (t) => {
  const {db} = await import('../src/db');
  const {createSchemaIfNotExists} = await import('../src/db/init-schema');
  const s = await import('../src/db/schema');
  const {eq} = await import('drizzle-orm');
  const auth = await import('../src/lib/auth');
  await createSchemaIfNotExists();
  const [a,b] = await db.insert(s.users).values([
    {name:'Audit A',username:'audit_a',role:'user'},
    {name:'Audit B',username:'audit_b',role:'user'},
  ]).returning();
  const sa = await auth.createSession(a.id);
  cookie = sa.token;
  await t.test('Stored session hash cannot authenticate as the victim', async () => {
    const sb = await auth.createSession(b.id);
    const stolenDatabaseHash = auth.hashSessionToken(sb.token);
    const impersonated = await auth.getSessionUser(stolenDatabaseHash);
    assert.equal(impersonated,null);
  });
  await t.test('Integrity results do not disclose another tenant description', async () => {
    await db.insert(s.journalEntries).values({userId:b.id,entryDate:'2026-09-08',type:'income',description:'AUDIT_B_PRIVATE_DESCRIPTION'});
    const {runIntegrityChecks} = await import('../src/features/integrity/service');
    const results = await runIntegrityChecks(a.id);
    assert.ok(!results.flatMap(r=>r.samples).some(r=>r.includes('AUDIT_B_PRIVATE_DESCRIPTION')));
  });
  await t.test('Regular user cannot overwrite a global inflation item', async () => {
    const [item] = await db.insert(s.commodityItems).values({name:'AUDIT_SHARED_ITEM',userId:null}).returning();
    const {updateInflationItemAction} = await import('../src/app/actions/inflation');
    const fd = new FormData(); fd.set('id',item.id);fd.set('name','AUDIT_CHANGED_BY_A');fd.set('unit','piece');
    const result = await updateInflationItemAction(null,fd);
    assert.equal(result.ok,false);
    const [stored] = await db.select().from(s.commodityItems).where(eq(s.commodityItems.id,item.id));
    assert.equal(stored.name,'AUDIT_SHARED_ITEM');
  });
  await t.test('RLS migration protects tenant tables', async () => {
    const {readFile} = await import('node:fs/promises');
    const migration = await readFile(new URL('../drizzle/0016_tenant_rls.sql', import.meta.url),'utf8');
    assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
    assert.match(migration,/CREATE POLICY tenant_update/);
  });
  await t.test('Restore preserves authenticated identity rows', async () => {
    await db.delete(s.journalEntries);
    const [owner] = await db.insert(s.users).values({name:'Audit Owner',username:'audit_owner',role:'owner'}).returning();
    cookie = (await auth.createSession(owner.id)).token;
    const {POST} = await import('../src/app/api/restore/route');
    const response = await POST(new Request('http://localhost/api/restore',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({app:'PWOS',schemaVersion:'1.0',confirmToken:'RESTORE_DATABASE_OVERWRITE',data:{users:[{id:owner.id,name:owner.name,username:owner.username,role:owner.role}]}}),
    }));
    const body = await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.ok((await db.select().from(s.users)).some((u) => u.id === owner.id));
  });
});
