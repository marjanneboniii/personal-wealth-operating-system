/**
 * Asset Registry Extension — Identity-Focused
 * Defines the asset-class hierarchy used to categorize assets.
 */

export type AssetClassNode = {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  parentId: string | null;
  level: number;
  attributesSchema: string | null;
  children?: AssetClassNode[];
};



export type CreateAssetClassInput = {
  code: string;
  name: string;
  color?: string;
  sortOrder?: number;
  parentId?: string | null;
  level?: number;
  attributesSchema?: string;
};
