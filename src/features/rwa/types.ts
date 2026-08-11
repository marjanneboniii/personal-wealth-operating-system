/**
 * RWA Domain — Identity, Ownership, Valuation Separation
 * RWA must contain Identity (asset_id, type, location), Ownership (ownership_records), Valuation (valuation_events)
 * Example Apartment Purchase 50B, 2027 Appraisal 80B, 2028 Market Estimate 110B are valuation events not single price field
 */

export type PropertyType = "apartment" | "house" | "land" | "commercial";
export type AreaAhvaz = "Kianpars" | "Golestan" | "Shahrak Daneshgah" | "Padad" | "Kianabad" | "Zeytoon";
export type OwnershipType = "full" | "partial" | "partnership" | "inherited" | "mortgaged";
export type ValuationSource = "manual" | "appraisal" | "market_estimate" | "spot" | "book_value";

export type RealEstateProperty = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  userId: string | null;
  propertyType: PropertyType;
  city: string;
  area: string | null;
  address: string | null;
  sizeSqm: string | null;
  floor: number | null;
  yearBuilt: number | null;
  deedNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type VehicleAsset = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  userId: string | null;
  brand: string;
  model: string;
  year: number;
  licensePlate: string | null;
  chassisNumber: string | null;
  mileage: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type RWAOwnershipRecord = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  userId: string | null;
  ownershipPercentage: string;
  ownershipType: OwnershipType;
  acquisitionDate: string;
  acquisitionPriceIRR: string | null;
  acquisitionPriceUSD: string | null;
  acquisitionCurrencyId: string | null;
  debtId: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type RWAValuationEvent = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  userId: string | null;
  valuationDate: string;
  priceIRR: string | null;
  priceUSD: string | null;
  priceBase: string | null;
  currencyId: string | null;
  valuationSource: ValuationSource;
  appraiser: string | null;
  note: string | null;
  createdAt: string;
};

export type CreateRealEstateInput = {
  assetId: string;
  userId?: string;
  propertyType?: PropertyType;
  city?: string;
  area?: string;
  address?: string;
  sizeSqm?: string;
  floor?: number;
  yearBuilt?: number;
  deedNumber?: string;
  notes?: string;
};

export type CreateVehicleInput = {
  assetId: string;
  userId?: string;
  brand: string;
  model: string;
  year: number;
  licensePlate?: string;
  chassisNumber?: string;
  mileage?: number;
  notes?: string;
};

export type CreateOwnershipInput = {
  assetId: string;
  userId?: string;
  ownershipPercentage?: string;
  ownershipType?: OwnershipType;
  acquisitionDate: string;
  acquisitionPriceIRR?: string;
  acquisitionPriceUSD?: string;
  acquisitionCurrencyId?: string;
  debtId?: string;
  notes?: string;
};

export type CreateValuationEventInput = {
  assetId: string;
  userId?: string;
  valuationDate: string;
  priceIRR?: string;
  priceUSD?: string;
  priceBase?: string;
  currencyId?: string;
  valuationSource?: ValuationSource;
  appraiser?: string;
  note?: string;
};
