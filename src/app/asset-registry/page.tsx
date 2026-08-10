import { desc, eq } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { commodityCategories, commodityItems, commodityPriceRecords } from "@/db/schema";
import { listRealEstateProperties } from "@/features/rwa/realEstate/service";
import { listVehicleAssets } from "@/features/rwa/vehicle/service";
import { listOwnershipRecords } from "@/features/rwa/ownership/service";
import { Card, PageHeader } from "@/components/ui/Card";
import RegistryWorkspace from "@/components/registry/RegistryWorkspace";
export const dynamic = "force-dynamic";
export default async function AssetRegistryPage(){
 await ensureAuth();
 const [properties, vehicles, ownerships, categories, items, prices] = await Promise.all([
  listRealEstateProperties(),listVehicleAssets(),listOwnershipRecords(),db.select().from(commodityCategories),
  db.select({id:commodityItems.id,name:commodityItems.name,unit:commodityItems.defaultUnit,category:commodityCategories.name}).from(commodityItems).leftJoin(commodityCategories,eq(commodityItems.categoryId,commodityCategories.id)),
  db.select({id:commodityPriceRecords.id,commodityId:commodityPriceRecords.commodityId,item:commodityItems.name,unitPrice:commodityPriceRecords.unitPrice,quantity:commodityPriceRecords.quantity,total:commodityPriceRecords.totalAmount,unit:commodityPriceRecords.unit,merchant:commodityPriceRecords.merchantName,notes:commodityPriceRecords.notes,purchasedAt:commodityPriceRecords.purchasedAt}).from(commodityPriceRecords).innerJoin(commodityItems,eq(commodityPriceRecords.commodityId,commodityItems.id)).orderBy(desc(commodityPriceRecords.purchasedAt)).limit(30)
 ]);
 return <div className="space-y-6"><PageHeader title="دارایی واقعی و کالا" subtitle="ثبت مرحله‌ای، پیش‌نمایش شفاف و تأیید نهایی برای دارایی‌های واقعی، ارزش‌گذاری و سبد کالای شخصی."/><RegistryWorkspace properties={properties} vehicles={vehicles} ownerships={ownerships} categories={categories} items={items} prices={prices.map(p=>({...p,unitPrice:String(p.unitPrice),quantity:String(p.quantity),total:String(p.total),purchasedAt:p.purchasedAt.toISOString()}))}/></div>
}
