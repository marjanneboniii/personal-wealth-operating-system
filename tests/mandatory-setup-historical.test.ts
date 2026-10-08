import assert from "node:assert/strict";
import {test, mock} from "node:test";
import crypto from "node:crypto";
import {createReadySession} from "./support/ready-session";
import {eq, and} from "drizzle-orm";
import {db} from "../src/db";
import {createSchemaIfNotExists} from "../src/db/init-schema";
import {accounts,assets,users,lots,journalEntries,setupSessions,userFxSettings,userSetupState,deposits} from "../src/db/schema";
import {finishSetup,loadSetupDraft,saveSetupDraft,validateSetupSelection,type SetupAnswers} from "../src/features/setup/workflow";
import type {SetupInput} from "../src/features/setup/service";
import {getSetupState} from "../src/features/setup/service";
import {isSetupRequired} from "../src/lib/setupGate";
import {resolveAutomaticPurchaseRate} from "../src/features/rwa/vehicle/fx";
import {D} from "../src/domain/decimal";
import {getCurrentNetWorth} from "../src/features/portfolio/service";
import {csvTextCell} from "../src/lib/csv";
import {normalizeBankIdentifier} from "../src/features/accounts/bankDetails";
import {estimateLoan} from "../src/features/planning/loanEstimate";
let cookie="";
mock.module("next/headers",{namedExports:{cookies:async()=>({get:()=>cookie?{value:cookie}:undefined,set(){},delete(){}}),headers:async()=>new Headers()}});
mock.module("next/cache",{namedExports:{revalidatePath(){}}});
const none:SetupAnswers={holdings:"no",instruments:"no",properties:"no",vehicles:"no",debts:"no"};
const base:SetupInput={userName:"ثبت تاریخی",baseCurrency:"USD",displayCurrency:"IRT",dateCalendar:"jalali",digitStyle:"fa",fxRate:"100000",bankAccountName:"ملت اصلی",bankName:"ملت",bankOpeningBalance:"1000000",bankAssetSymbol:"IRT"};
async function owner(){await createSchemaIfNotExists();return (await db.insert(users).values({name:"آزمون",username:crypto.randomUUID(),role:"user"}).returning())[0];}

test("explicit ownership answers reject omissions, missing dates and contradictions",()=>{
 assert.throws(()=>validateSetupSelection(base,{} as SetupAnswers,[]),/همه بخش/);
 assert.throws(()=>validateSetupSelection(base,{...none,vehicles:"yes"},[]),/یکسان/);
 assert.throws(()=>validateSetupSelection({...base,cryptoHoldings:[{symbol:"ETH",quantity:"1",unitPrice:"100",priceCurrency:"IRT",walletName:"نوبیتکس"}]},{...none,holdings:"yes"},[]),/تاریخ/);
});
test("a bank account alone never unlocks the application",async()=>{
 const u=await owner();await db.insert(accounts).values({userId:u.id,name:"فقط نام",code:"1010",type:"asset"});
 assert.equal(await isSetupRequired(u.id),true);
});
test("historical purchase resolver refuses invalid, future and uncovered dates",async()=>{
 const u=await owner();
 for(const date of ["2023-02-31","2099-01-01","1800-01-01"]) await assert.rejects(()=>resolveAutomaticPurchaseRate(date,u.id));
 const r=await resolveAutomaticPurchaseRate("2023-08-11",u.id);assert.ok(Number(r.rate)>0);assert.ok(r.effectiveDate<="2023-08-11");assert.notEqual(r.source,"current");
});
test("encrypted draft is scoped to its owner and never posts financial entries",async()=>{
 const u=await owner(),other=await owner();process.env.FIELD_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");
 const draft={version:1,step:5,secret:"اطلاعات خصوصی",answers:{holdings:"no"}};await saveSetupDraft(u.id,draft);
 const [row]=await db.select().from(setupSessions).where(eq(setupSessions.userId,u.id));assert.ok(row.draftEncrypted?.startsWith("enc:v1:"));assert.ok(!row.draftEncrypted?.includes("اطلاعات خصوصی"));
 assert.deepEqual(await loadSetupDraft(u.id),draft);assert.equal(await loadSetupDraft(other.id),null);
 assert.equal((await db.select().from(journalEntries).where(eq(journalEntries.userId,u.id))).length,0);
});
test("setup freezes historical crypto and online gold cost/date; retry never duplicates",async()=>{
 const u=await owner();const date="2023-08-11";const rate=(await resolveAutomaticPurchaseRate(date,u.id)).rate;
 const input:SetupInput={...base,cryptoHoldings:[{symbol:"ETH",quantity:"2",unitPrice:"100000000",priceCurrency:"IRT",walletName:"نوبیتکس",purchaseDate:date}],goldOpeningQty:"3",goldUnitPrice:"3000000",goldPriceCurrency:"IRT",goldPurchaseDate:date,goldHoldingPlace:"میلی"};
 assert.equal((await finishSetup(u.id,input,{...none,holdings:"yes"},[])).ok,true);
 const records=await db.select().from(lots).where(eq(lots.userId,u.id));assert.equal(records.length,2);
 for(const lot of records){assert.equal(lot.openedAt,date);assert.ok(D(lot.purchaseFxRate!).sub(rate).abs().lt("0.000001"));}
 const costs=records.map(l=>D(l.unitCostBase).mul(l.qtyOpened));assert.ok(costs.some(c=>c.sub(D("200000000").div(rate)).abs().lt("0.000001")));assert.ok(costs.some(c=>c.sub(D("9000000").div(rate)).abs().lt("0.000001")));
 const count=(await db.select().from(journalEntries).where(eq(journalEntries.userId,u.id))).length;
 await finishSetup(u.id,input,{...none,holdings:"yes"},[]);assert.equal((await db.select().from(journalEntries).where(eq(journalEntries.userId,u.id))).length,count);
 await db.update(userFxSettings).set({currentRate:"300000"}).where(eq(userFxSettings.userId,u.id));assert.deepEqual((await db.select().from(lots).where(eq(lots.userId,u.id))).map(l=>l.unitCostBase),records.map(l=>l.unitCostBase));assert.equal(await isSetupRequired(u.id),false);
});
test("failed property registration keeps setup locked and the core retry posts only once",async()=>{
 const u=await owner();const bad={cityId:crypto.randomUUID(),neighborhoodId:crypto.randomUUID(),propertyTypeId:crypto.randomUUID(),acquisitionDate:"2023-08-11",purchasePriceToman:"1000000000"};
 const input={...base,properties:[bad]};
 await assert.rejects(()=>finishSetup(u.id,input,{...none,properties:"yes"},[]));
 assert.equal((await getSetupState(u.id)).completed,false);assert.equal(await isSetupRequired(u.id),true);
 const count=(await db.select().from(journalEntries).where(eq(journalEntries.userId,u.id))).length;assert.equal(count,1);
 await assert.rejects(()=>finishSetup(u.id,input,{...none,properties:"yes"},[]));assert.equal((await db.select().from(journalEntries).where(eq(journalEntries.userId,u.id))).length,count);
 // Correct a not-yet-registered section to explicit no, without rebooking the core.
 assert.equal((await finishSetup(u.id,{...base,properties:[]},none,[])).ok,true);
 assert.equal((await db.select().from(journalEntries).where(eq(journalEntries.userId,u.id))).length,count);
});
test("spendable cash subtracts only explicitly restricted deposits and floors at zero",async()=>{
 const u=await owner();await finishSetup(u.id,base,none,[]);const [bank]=await db.select().from(accounts).where(and(eq(accounts.userId,u.id),eq(accounts.code,"1010")));
 const deposit={userId:u.id,kind:"bank",title:"سپرده",accountId:bank.id,payoutAccountId:bank.id,principalToman:"300000",annualRate:"20",startDate:"2023-01-01"};
 await db.insert(deposits).values(deposit);assert.equal((await getCurrentNetWorth(u.id)).availableCashToman,"1000000");
 await db.insert(deposits).values({...deposit,restrictsAccountBalance:true});assert.equal((await getCurrentNetWorth(u.id)).availableCashToman,"700000");
 await db.insert(deposits).values({...deposit,principalToman:"3000000",restrictsAccountBalance:true});assert.equal((await getCurrentNetWorth(u.id)).availableCashToman,"0");
});
test("CSV human text is quoted and spreadsheet formula prefixes are escaped",()=>{for(const v of ["=1+1"," +SUM(A1)","\t@cmd","-1+1"]) assert.ok(csvTextCell(v).startsWith('"\''));assert.equal(csvTextCell('سلام, "دوست"'),'"سلام, ""دوست"""');});
test("bank identifiers validate locally; loan estimates distinguish net receipt and fees",()=>{
 assert.throws(()=>normalizeBankIdentifier("card","1111111111111111"));assert.throws(()=>normalizeBankIdentifier("iban","IR000000000000000000000000"));assert.equal(normalizeBankIdentifier("account","۱۲۳۴۵۶۷۸"),"12345678");
 assert.deepEqual(estimateLoan("12000000","0",12,"200000"),{monthly:"1000000",total:"12000000",netReceived:"11800000",cost:"200000"});assert.throws(()=>estimateLoan("100","10",0));
});

test("explicit no bank creates no fictitious bank account",async()=>{
 const u=await owner();await finishSetup(u.id,{...base,bankPresence:"no",bankAccounts:[],bankOpeningBalance:"0"},none,[]);
 assert.equal((await db.select().from(accounts).where(and(eq(accounts.userId,u.id),eq(accounts.code,"1010")))).length,0);
});
test("multiple dated acquisitions share the holding account but freeze separate USD costs",async()=>{
 const u=await owner();const rows=["2023-08-11","2023-11-12"].map(purchaseDate=>({symbol:"ETH",walletName:"نوبیتکس",quantity:"1",unitPrice:"1000000",priceCurrency:"IRT" as const,purchaseDate}));
 await finishSetup(u.id,{...base,cryptoHoldings:rows},{...none,holdings:"yes"},[]);
 const records=await db.select().from(lots).where(eq(lots.userId,u.id));assert.equal(records.length,2);assert.equal(new Set(records.map(l=>l.accountId)).size,1);assert.equal(new Set(records.map(l=>l.openedAt)).size,2);
});
test("expanded crypto selections post dated purchases with their own identities and frozen USD costs", async () => {
 const u = await owner(), purchaseDate = "2026-09-10";
 const rate = (await resolveAutomaticPurchaseRate(purchaseDate, u.id)).rate;
 const symbols = ["CIRBTC", "ADA", "DAI"];
 await finishSetup(u.id, {...base, cryptoHoldings: symbols.map(symbol => ({symbol, walletName:"نوبیتکس", quantity:"2", unitPrice:"1000000", priceCurrency:"IRT" as const, purchaseDate}))}, {...none, holdings:"yes"}, []);
 const owned = await db.select({symbol:assets.symbol, identity:assets.coingeckoId, name:assets.name, accountId:accounts.id}).from(accounts).innerJoin(assets, eq(accounts.assetId,assets.id)).where(eq(accounts.userId,u.id));
 const records = await db.select().from(lots).where(eq(lots.userId,u.id));
 for (const [symbol, identity] of Object.entries({CIRBTC:"circle-wrapped-btc", ADA:"cardano", DAI:"dai"})) {
  const coin = owned.find(row => row.symbol === symbol)!;
  assert.ok(coin, `${symbol} must not be silently omitted`);
  assert.equal(coin.identity, identity);
  const lot = records.find(row => row.accountId === coin.accountId)!;
  assert.ok(lot, `${symbol} must have its own purchase lot`);
  assert.equal(D(lot.qtyOpened).toString(), "2");
  assert.ok(D(lot.unitCostBase).sub(D("1000000").div(rate)).abs().lt("0.000001"));
 }
 assert.equal(owned.find(row=>row.symbol==="CIRBTC")?.name, "بیت‌کوین رپ‌شدهٔ سیرکل");
 assert.equal((await getSetupState(u.id)).completed, true);
});
test("dated crypto trade uses historical USD automatically and ignores client dollar override",async()=>{
 const u=await owner(),date="2023-08-11";const rate=(await resolveAutomaticPurchaseRate(date,u.id)).rate;
 await finishSetup(u.id,{...base,tomanPlaces:[{walletName:"نوبیتکس",balance:"100000000"}],cryptoHoldings:[{symbol:"ETH",walletName:"نوبیتکس",quantity:"1",unitPrice:"1000000",priceCurrency:"IRT",purchaseDate:date}]},{...none,holdings:"yes"},[]);
 cookie=(await createReadySession(u.id)).token;
 const owned=await db.select().from(accounts).where(eq(accounts.userId,u.id));const coin=owned.find(a=>a.code==="1200")!;const money=owned.find(a=>a.name==="تومان - نوبیتکس")!;
 const fd=new FormData();for(const [k,v] of Object.entries({type:"buy",entryDate:date,description:"خرید تاریخی",primaryAccountId:coin.id,counterAccountId:money.id,irtAmount:"1000000",quantity:"1",unitPrice:"1000000",priceMode:"limit",settleQuantity:"1000000",fxRate:"1",idempotencyKey:crypto.randomUUID()}))fd.set(k,v);
 const result=await (await import("../src/app/actions")).createTransactionAction(null,fd);assert.equal(result.ok,true,result.message);
 const records=await db.select().from(lots).where(eq(lots.userId,u.id));assert.equal(records.length,2);for(const l of records)assert.ok(D(l.unitCostBase).sub(D("1000000").div(rate)).abs().lt("0.000001"));
});

test("bank profile works without SMS activation, encrypts full numbers, masks and isolates",async()=>{
 const u=await owner(),other=await owner();await finishSetup(u.id,base,none,[]);await finishSetup(other.id,base,none,[]);cookie=(await createReadySession(u.id)).token;
 const [bank]=await db.select().from(accounts).where(and(eq(accounts.userId,u.id),eq(accounts.code,"1010")));const [foreign]=await db.select().from(accounts).where(and(eq(accounts.userId,other.id),eq(accounts.code,"1010")));
 const {addBankIdentifierAction,removeBankIdentifierAction}=await import("../src/app/actions/bankIdentifiers");const {listBankIdentifiers}=await import("../src/features/bankImport/identifiers");
 const value={accountId:bank.id,bankName:"ملت",kind:"account",number:"۱۲۳۴۵۶۷۸۹"};assert.equal((await addBankIdentifierAction(value)).ok,true);
 const [stored]=await db.select().from(accounts).where(eq(accounts.id,bank.id));assert.ok(stored.bankDetailsEncrypted?.startsWith("enc:v1:"));assert.ok(!stored.bankDetailsEncrypted?.includes("123456789"));const mapping=(await listBankIdentifiers(u.id))[0];assert.equal(mapping.suffix,"6789");assert.equal("number" in mapping,false);
 assert.equal((await addBankIdentifierAction({...value,accountId:foreign.id})).ok,false);
 assert.equal((await removeBankIdentifierAction(mapping.id)).ok,true);assert.equal((await db.select().from(accounts).where(eq(accounts.id,bank.id)))[0].bankDetailsEncrypted,null);
});
